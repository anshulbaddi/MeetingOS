# Auth Standards

## Rule: Clerk for All Authentication

**This app uses Clerk for authentication. Do not implement any custom auth logic.**

This is a hard rule with no exceptions. Session management, sign-in/sign-up flows, user identity, and access control are all handled by Clerk. Do not reach for next-auth, custom JWTs, cookies, or any other auth mechanism.

## What This Means in Practice

- **Do not** build custom sign-in or sign-up pages from scratch — use Clerk's hosted pages or the `<SignIn />` / `<SignUp />` components.
- **Do not** write your own session or token logic — Clerk manages the session cookie automatically.
- **Do not** pass `userId` as a prop or URL parameter into components or data helpers — always read it from the Clerk session on the server (see Data Fetching standards).
- **Do** protect routes via Clerk middleware — it is the single enforcement point for access control.
- **Do** use `auth()` from `@clerk/nextjs/server` in Server Components and `/data` helpers to read the current user.
- **Do** use `useAuth()` or `useUser()` from `@clerk/nextjs` in Client Components only when the user identity is needed for UI rendering (not for data fetching).

## Middleware: Route Protection

All route protection lives in `src/middleware.ts`. Use Clerk's `clerkMiddleware` with `createRouteMatcher` to define public routes. Every route not explicitly marked public is protected by default.

```ts
// src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
```

## Reading the Current User on the Server

Use `auth()` when you only need the `userId` (e.g., in `/data` helpers). Use `currentUser()` when you need the full user object (name, email, etc.) for display purposes.

```ts
// userId only — use in /data helpers
import { auth } from "@clerk/nextjs/server";

const { userId } = await auth();
if (!userId) throw new Error("Unauthorized");
```

```ts
// full user object — use in Server Components for display
import { currentUser } from "@clerk/nextjs/server";

const user = await currentUser();
```

Never call `currentUser()` inside `/data` helpers — they only need `userId`. `currentUser()` makes an extra network call; reserve it for when you actually need the user's profile fields.

## Reading Auth State on the Client

Use Clerk's React hooks only for UI-driven decisions (showing a user's name, toggling a logged-in state, etc.). Never use client-side auth state to gate data access — that must be enforced on the server.

```tsx
"use client";
import { useUser } from "@clerk/nextjs";

export function UserGreeting() {
  const { user } = useUser();
  return <p>Hello, {user?.firstName}</p>;
}
```

## Sign-In / Sign-Up Pages

Create thin route files that render Clerk's components centered on the page. Do not build custom forms.

```tsx
// src/app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}
```

The catch-all segment (`[[...sign-in]]`) is required — Clerk uses sub-paths for its multi-step flow.

## Environment Variables

Clerk requires two environment variables. These must be present in `.env.local` and must never be committed to the repository.

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

Optionally configure redirect URLs:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

## Rationale

Centralizing all auth in Clerk eliminates the risk of home-grown session bugs, keeps user credential handling off this codebase entirely, and provides a consistent, audited auth layer across every route. The middleware-first approach means a missing auth check on a new route is a visible omission, not a silent gap.
