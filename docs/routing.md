# Routing Standards

## Rule: All App Routes Live Under `/dashboard`

**Every feature route in this app must be nested under `/dashboard`. No feature pages exist at the root level.**

This is a hard rule with no exceptions. Any page that requires authentication or renders app content belongs under `/dashboard` (e.g., `/dashboard`, `/dashboard/workouts`, `/dashboard/settings`). Only marketing, sign-in, and sign-up pages are allowed at the root level.

## What This Means in Practice

- **Do not** create feature pages at the root (`/workouts`, `/profile`, `/settings`, etc.) — they must live under `/dashboard/`.
- **Do** nest all authenticated pages in `src/app/dashboard/` using the App Router file structure.
- **Do not** implement route protection inside page components or layouts — protection is handled exclusively by middleware (see below).
- **Do** use Next.js nested routing: create subdirectories under `src/app/dashboard/` for each feature area.

## File Structure

```
src/
  app/
    page.tsx                          ← public landing/home page
    sign-in/[[...sign-in]]/page.tsx   ← public Clerk sign-in page
    sign-up/[[...sign-up]]/page.tsx   ← public Clerk sign-up page
    dashboard/
      page.tsx                        ← main dashboard (protected)
      layout.tsx                      ← shared dashboard layout (optional)
      workouts/
        page.tsx                      ← /dashboard/workouts
        [workoutId]/
          page.tsx                    ← /dashboard/workouts/:workoutId
      settings/
        page.tsx                      ← /dashboard/settings
```

## Route Protection via Middleware

All `/dashboard` routes are protected by Clerk middleware in `src/proxy.ts`. The proxy is the **single enforcement point** — do not add `auth()` guard checks in layouts or pages for the purpose of redirecting unauthenticated users.

The public route matcher must explicitly allow the root page and Clerk auth routes. Everything else — including all `/dashboard` routes — is protected by default:

```ts
// src/proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

`auth.protect()` automatically redirects unauthenticated users to the sign-in page — no manual redirect logic needed.

## Navigation

All internal links to app pages must use the `/dashboard` prefix. Never link directly to a feature page at the root level.

```tsx
// correct
<Link href="/dashboard">Dashboard</Link>
<Link href="/dashboard/workouts">Workouts</Link>

// wrong — feature pages don't exist at the root
<Link href="/workouts">Workouts</Link>
```

## Rationale

Grouping all authenticated pages under `/dashboard` creates a single, predictable subtree that the middleware can protect without enumerating individual routes. It also makes it immediately obvious where new feature pages belong, and prevents accidental public exposure of pages that should require a login.
