# Data Mutation Standards

## Rule: Client Components call Next.js API routes, which proxy to FastAPI

**All data mutations go through Next.js API route handlers that call FastAPI via `apiFetch()`. No direct database access from Next.js.**

Next.js never writes to the database. Client Components call Next.js API routes with `fetch`. Those route handlers validate input with Zod, then call the appropriate FastAPI endpoint. FastAPI owns all database writes.

## What This Means in Practice

- **Do not** call the database from Next.js for any mutation.
- **Do not** call FastAPI directly from Client Components — the JWT signing lives server-side in `apiFetch()`.
- **Do** create an API route handler for every mutation under `src/app/api/`.
- **Do** validate inputs with Zod inside the route handler before calling `apiFetch()`.
- **Do** return proper HTTP error responses (400, 500) with a JSON `{ error: string }` body.
- **Do** define the corresponding POST/PUT/PATCH/DELETE endpoint in the FastAPI backend.

## File Structure

```
src/
  app/
    api/
      auth/
        [...nextauth]/
          route.ts          ← Auth.js OAuth handler (do not modify)
      analyze/
        url/route.ts        ← POST /api/analyze/url
        file/route.ts       ← POST /api/analyze/file
      responses/
        [id]/route.ts       ← PATCH /api/responses/[id]
    dashboard/
      page.tsx
      _components/
        some-form.tsx       ← "use client", calls fetch("/api/...")
backend/
  main.py                   ← FastAPI endpoints (or split into routers/)
```

## API Route Handlers

Every route handler must:
1. Parse the request body with `req.json()` or `req.formData()`.
2. Validate with Zod — return `{ error }` with status 400 on failure.
3. Call `apiFetch()` to forward to FastAPI.
4. Wrap everything in try/catch and return `{ error }` with status 500 on unexpected errors.

```ts
// src/app/api/items/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiFetch } from "@/lib/api";

const schema = z.object({ name: z.string().min(1).max(255) });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const result = await apiFetch("/items", {
      method: "POST",
      body: JSON.stringify(parsed.data),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

## FastAPI: Mutation Endpoints

Every mutation endpoint must:
1. Use `get_current_user_id` as a dependency.
2. Scope all writes to that `user_id` — never write based on a caller-supplied user ID.
3. Use Pydantic models to validate the request body.

```python
# backend/main.py
from pydantic import BaseModel
from auth import get_current_user_id
from fastapi import Depends
from db import get_db

class CreateItemRequest(BaseModel):
    name: str

@app.post("/items")
def create_item(
    body: CreateItemRequest,
    user_id: str = Depends(get_current_user_id),
):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO items (user_id, name) VALUES (%s, %s) RETURNING *",
                (user_id, body.name),
            )
            return cur.fetchone()
```

For updates and deletes, always include `AND user_id = %s` in the WHERE clause.

## Calling API Routes from Client Components

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function CreateItemForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    startTransition(async () => {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Example" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/dashboard");
    });
  }

  return <button onClick={handleSubmit} disabled={isPending}>Create</button>;
}
```

## File Uploads

For `multipart/form-data` (file uploads), pass `FormData` directly as the body — do not set `Content-Type`. The browser sets the boundary automatically.

```tsx
// Client Component
const fd = new FormData(formElement);
const res = await fetch("/api/analyze/file", { method: "POST", body: fd });
```

```ts
// API route handler
const formData = await req.formData();
const file = formData.get("file");
// validate and forward to FastAPI
```

## Zod Validation Rules

- Every input field must be covered by the schema — no unchecked fields.
- Use `safeParse` and return 400 on failure.
- Define the schema directly above the handler in the same file.

## Security

Next.js validates shape (Zod). FastAPI enforces ownership (`user_id` from the JWT, never from the request body). Both layers are required — Zod alone does not prevent a user from mutating another user's data.

## Rationale

API routes are explicit HTTP endpoints that live at predictable URLs, making the mutation surface easy to audit. They work naturally with `fetch` from Client Components and correctly handle both JSON and multipart bodies. The JWT signing needed to talk to FastAPI happens inside `apiFetch()`, which is server-only — API route handlers run on the server, so they can call `apiFetch()` safely.
