# Data Mutation Standards

## Rule: Server Actions via `/data` Helpers

**All data mutations must go through Server Actions that call helper functions in `src/data/`. No direct database calls outside of `src/data/`.**

This is a hard rule with no exceptions. Pages, components, and Server Actions must never import from `src/db` directly — all Drizzle ORM calls live in `src/data/` helpers. Server Actions are the only way to trigger mutations from the client.

## What This Means in Practice

- **Do not** call Drizzle ORM methods (`db.insert`, `db.update`, `db.delete`) anywhere outside of `src/data/`.
- **Do not** create `app/api/` route handlers to handle mutations.
- **Do not** accept `FormData` as a Server Action parameter — use typed plain objects instead.
- **Do not** trust caller-supplied `userId` — always read it from the Clerk session inside the `/data` helper.
- **Do** write a mutation helper in `src/data/` for every insert, update, or delete operation.
- **Do** call those helpers from a Server Action defined in a colocated `actions.ts` file.
- **Do** validate every Server Action's arguments with Zod before passing them to a `/data` helper.

## File Structure

Server Actions live in `actions.ts` files colocated with the route that uses them. The corresponding database logic lives in `src/data/`.

```
src/
  data/
    workouts.ts     ← getWorkouts(), createWorkout(), deleteWorkout(), etc.
    sets.ts         ← createSet(), updateSet(), deleteSet(), etc.
  app/
    dashboard/
      page.tsx
      actions.ts    ← Server Actions for the dashboard route
    workouts/
      [id]/
        page.tsx
        actions.ts  ← Server Actions for the workout detail route
```

## `/data` Mutation Helpers

Each helper performs a single mutation, scopes it to the authenticated user, and returns a plain object or `void`.

```ts
// src/data/workouts.ts
import { db } from "@/db";
import { workouts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";

export async function createWorkout(name: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const [workout] = await db.insert(workouts).values({ name, userId }).returning();
  return workout;
}

export async function deleteWorkout(workoutId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  await db.delete(workouts).where(
    and(eq(workouts.id, workoutId), eq(workouts.userId, userId))
  );
}
```

Always include the `userId` guard in the `where` clause for updates and deletes — never delete or update based on `id` alone.

## Server Actions

Server Actions are defined in colocated `actions.ts` files. Every action must:

1. Be marked with `"use server"` at the top of the file.
2. Accept typed parameters — never `FormData`.
3. Validate all inputs with Zod before calling any `/data` helper.
4. Call the appropriate `/data` helper to perform the mutation.

```ts
// src/app/dashboard/actions.ts
"use server";

import { z } from "zod";
import { createWorkout } from "@/data/workouts";

const createWorkoutSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function createWorkoutAction(params: { name: string }) {
  const parsed = createWorkoutSchema.safeParse(params);
  if (!parsed.success) throw new Error("Invalid input");

  return createWorkout(parsed.data.name);
}
```

```ts
// src/app/dashboard/actions.ts (delete example)
"use server";

import { z } from "zod";
import { deleteWorkout } from "@/data/workouts";

const deleteWorkoutSchema = z.object({
  workoutId: z.string().uuid(),
});

export async function deleteWorkoutAction(params: { workoutId: string }) {
  const parsed = deleteWorkoutSchema.safeParse(params);
  if (!parsed.success) throw new Error("Invalid input");

  await deleteWorkout(parsed.data.workoutId);
}
```

## Calling Server Actions from Client Components

Import the Server Action directly and call it with a typed object. Do not construct a `FormData` object.

```tsx
"use client";

import { createWorkoutAction } from "./actions";

export function CreateWorkoutButton() {
  async function handleClick() {
    await createWorkoutAction({ name: "Leg Day" });
  }

  return <Button onClick={handleClick}>New Workout</Button>;
}
```

## Rule: No `redirect()` Inside Server Actions

**Never call `redirect()` from `next/navigation` inside a Server Action. Navigation after a mutation is the client's responsibility.**

Calling `redirect()` inside a Server Action throws an internal exception that Next.js intercepts to perform the redirect. This mechanism bypasses normal error handling — a `try/catch` in the calling Client Component will catch the redirect throw and treat it as an error, making it impossible to distinguish a successful mutation from a real failure.

- **Do not** import or call `redirect()` in any `actions.ts` file.
- **Do** return from the Server Action normally (return the created record or `void`).
- **Do** perform navigation in the Client Component after the `await` resolves, using `useRouter`.

```ts
// actions.ts — just mutate and return
export async function createWorkoutAction(params: CreateWorkoutParams) {
  const parsed = createWorkoutSchema.safeParse(params);
  if (!parsed.success) throw new Error("Invalid input");

  return createWorkout(parsed.data);
}
```

```tsx
// page.tsx or component — navigate after the action settles
"use client";
import { useRouter } from "next/navigation";
import { createWorkoutAction } from "./actions";

export function CreateWorkoutForm() {
  const router = useRouter();

  async function handleSubmit() {
    await createWorkoutAction({ ... });
    router.push("/dashboard");
  }
}
```

## Zod Validation Rules

- Every parameter the action receives must be covered by the Zod schema — no unchecked fields.
- Use `safeParse` and throw on failure so the error surfaces clearly rather than propagating corrupt data.
- Define the schema in the same file as the action, directly above it.
- Do not reuse schemas between actions unless they are genuinely identical — copy and adjust instead.

## Security: Ownership Checks in `/data` Helpers

The Server Action validates shape; the `/data` helper enforces ownership. Both layers are required.

- The `/data` helper always calls `auth()` and adds a `userId` condition to every write query.
- A missing `userId` guard on an update or delete is a critical security bug — a user could modify another user's rows by supplying a foreign `id`.

## Rationale

Keeping all Drizzle calls inside `src/data/` gives one place to audit database access. Colocating `actions.ts` with the route that triggers mutations makes the data flow obvious without a separate API layer. Typed parameters (not `FormData`) and Zod validation eliminate an entire class of malformed-input bugs before they reach the database.
