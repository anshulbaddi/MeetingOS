# Routing Standards

## Rule: All App Routes Live Under `/dashboard`

**Every authenticated feature route must be nested under `/dashboard`. No feature pages at the root level.**

Only the landing page (`/`) and Auth.js OAuth routes (`/api/auth/*`) are public. Everything else belongs under `/dashboard`.

## File Structure

```
src/
  app/
    page.tsx                        ← public landing page
    api/
      auth/
        [...nextauth]/
          route.ts                  ← Auth.js OAuth handler (do not modify)
      analyze/
        url/route.ts                ← POST /api/analyze/url
        file/route.ts               ← POST /api/analyze/file
      responses/
        [id]/route.ts               ← PATCH /api/responses/[id]
    dashboard/
      page.tsx                      ← main dashboard (protected)
      layout.tsx                    ← shared dashboard layout (optional)
      some-feature/
        page.tsx                    ← /dashboard/some-feature
        [id]/
          page.tsx                  ← /dashboard/some-feature/:id
```

## Route Protection via Middleware

All protection lives in `src/proxy.ts`. Do not add auth guards inside page components or layouts.

```ts
// src/proxy.ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublicRoute = pathname === "/" || pathname.startsWith("/api/auth");

  if (req.auth && pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (!req.auth && !isPublicRoute) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});
```

Key rules:
- `/api/auth/*` must always be public — these are the Auth.js callback routes and must never be blocked.
- Signed-in users hitting `/` are redirected to `/dashboard`.
- Unauthenticated users hitting any non-public route are redirected to `/`.
- API route handlers at `/api/*` (other than `/api/auth`) are additionally protected server-side by `apiFetch()`, which calls `auth()` and throws if no session exists.

## Navigation

All internal links must use the `/dashboard` prefix.

```tsx
// correct
<Link href="/dashboard">Dashboard</Link>
<Link href="/dashboard/some-feature">Feature</Link>

// wrong — feature pages don't exist at the root
<Link href="/some-feature">Feature</Link>
```

## API Routes

`app/api/` route handlers are used for two purposes only:

1. **Auth.js** — `app/api/auth/[...nextauth]/route.ts` (do not modify)
2. **Mutation proxies** — route handlers that receive a `fetch` call from a Client Component, validate with Zod, and forward to FastAPI via `apiFetch()`

Do not create `app/api/` route handlers for data fetching — those go directly through `apiFetch()` in Server Components.

## Rationale

Grouping all authenticated pages under `/dashboard` creates a single predictable subtree that middleware can protect without enumerating individual routes. Keeping `/api/auth/*` explicitly public ensures the OAuth flow is never accidentally blocked. Mutation API routes live under `/api/` so Client Components can call them with plain `fetch`.
