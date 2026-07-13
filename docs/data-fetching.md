# Data Fetching Standards

## Rule: Server Components call FastAPI via `apiFetch()`

**All data fetching must happen in Server Components using `apiFetch()` from `src/lib/api.ts`. No client-side fetching. No direct database access from Next.js.**

The database is owned by the FastAPI backend. Next.js never touches the database directly — it calls FastAPI endpoints, which return data.

## What This Means in Practice

- **Do not** query the database from Next.js — no Drizzle, no psycopg2, no raw SQL.
- **Do not** create `app/api/` route handlers for data fetching.
- **Do not** call `apiFetch()` from a Client Component — it uses `auth()` which is server-only.
- **Do** fetch data in `async` Server Components by calling `apiFetch()`.
- **Do** define the corresponding GET endpoint in `backend/main.py` (or a FastAPI router).

## `apiFetch()`

`src/lib/api.ts` is the single entry point for all Next.js → FastAPI communication. It automatically reads the Auth.js session and signs a short-lived JWT for FastAPI.

```ts
// src/lib/api.ts
import { auth } from "@/auth";
import { SignJWT } from "jose";

const API_URL = process.env.API_URL ?? "http://localhost:8000";
const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);

export async function apiFetch(path: string, init?: RequestInit) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const token = await new SignJWT({ sub: session.user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1m")
    .sign(secret);

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}
```

## Fetching in a Server Component

```tsx
// src/app/dashboard/page.tsx
import { apiFetch } from "@/lib/api";

export default async function DashboardPage() {
  const items = await apiFetch("/items");
  return <div>{/* render items */}</div>;
}
```

## FastAPI: Defining a GET Endpoint

All GET endpoints must use `get_current_user_id` as a dependency to enforce auth and scope results to the current user.

```python
# backend/main.py
from auth import get_current_user_id
from fastapi import Depends
from db import get_db

@app.get("/items")
def get_items(user_id: str = Depends(get_current_user_id)):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM items WHERE user_id = %s", (user_id,))
            return cur.fetchall()
```

**Never omit the `user_id` filter.** Returning rows without filtering by `user_id` is a critical security bug.

## Security: Users Must Only See Their Own Data

Every FastAPI GET endpoint that returns user-owned data must:

1. Accept `user_id` via `Depends(get_current_user_id)` — never trust a user-supplied ID.
2. Filter all queries by that `user_id`.
3. Return 404 (not 403) if the requested resource doesn't belong to the user — don't confirm the resource exists.

## Rationale

Keeping all database access in FastAPI gives one place to audit data access and enforce row-level security. Server Components calling `apiFetch()` keeps the data flow simple: one round trip per page, no client-side loading states, no exposed API surface callable outside the app.
