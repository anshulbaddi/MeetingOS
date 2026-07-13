# Auth Standards

## Rule: Auth.js (NextAuth v5) with Google OAuth

**This app uses Auth.js v5 for authentication. Do not implement any custom auth logic.**

Session management and sign-in flow are handled by Auth.js with the Google OAuth provider. Do not reach for custom JWTs, raw cookies, or any other auth mechanism.

## How It Works

```
Browser → Google OAuth → Auth.js callback → session cookie (Next.js)
                                                    ↓
                              apiFetch() signs short-lived HS256 JWT
                                                    ↓
                                     FastAPI verifies JWT with NEXTAUTH_SECRET
```

The session lives in a cookie managed by Auth.js. When calling FastAPI, `apiFetch()` in `src/lib/api.ts` reads the session server-side and signs a short-lived HS256 JWT using `NEXTAUTH_SECRET`. FastAPI verifies that same JWT using the shared secret.

## Auth Config

All Auth.js configuration lives in `src/auth.ts`.

```ts
// src/auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    jwt({ token, profile }) {
      if (profile?.sub) token.sub = profile.sub;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
```

## Middleware: Route Protection

All route protection lives in `src/proxy.ts`. Auth.js middleware is the single enforcement point — do not add auth guards inside page components or layouts.

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

`/api/auth/*` must always be public — these are the Auth.js callback routes.

## Reading the Session in Server Components

Use `auth()` from `@/auth` in Server Components to get the current session.

```ts
import { auth } from "@/auth";

const session = await auth();
if (!session?.user?.id) throw new Error("Unauthorized");
const userId = session.user.id; // Google's sub identifier
```

Do not read the session in Client Components for data access — only the server can be trusted.

## Sign In / Sign Out

Sign-in and sign-out use Server Actions with Auth.js functions. Both are already wired in `src/app/layout.tsx`.

```ts
import { signIn, signOut } from "@/auth";

// sign in
await signIn("google");

// sign out
await signOut({ redirectTo: "/" });
```

## FastAPI Auth

FastAPI verifies the JWT passed by `apiFetch()` using `backend/auth.py`. The token is HS256-signed with `NEXTAUTH_SECRET` and expires in 1 minute.

```python
# backend/auth.py
payload = jwt.decode(token, NEXTAUTH_SECRET, algorithms=["HS256"])
user_id = payload["sub"]  # Google sub, matches session.user.id
```

Use `get_current_user_id` as a FastAPI dependency on any protected endpoint:

```python
from auth import get_current_user_id
from fastapi import Depends

@app.get("/items")
async def get_items(user_id: str = Depends(get_current_user_id)):
    ...
```

## Environment Variables

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_SECRET=...        # shared with FastAPI backend
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=...            # same value as NEXTAUTH_SECRET (Auth.js v5 alias)
AUTH_URL=http://localhost:3000
```

The same `NEXTAUTH_SECRET` must be set in `backend/.env`.

## Rationale

Auth.js handles the OAuth dance and session cookie; FastAPI gets a short-lived signed token per request. No session state is shared between the two services — only the secret. This keeps the FastAPI backend stateless and independently verifiable.
