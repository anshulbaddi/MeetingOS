# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Coding Standards — Read Docs First

**Before generating any code, Claude Code must read the relevant file(s) in the `/docs` directory.**

The `/docs` directory contains authoritative coding standards for this project. Every doc file governs a specific domain. If there is a doc that covers what you are about to write, read it first and follow it exactly — no exceptions.

Current docs:
- `docs/ui.md` — UI standards (applies to every component, page, and any code that renders UI)
- `docs/data-fetching.md` — data fetching standards (applies to every database query, Server Component, and any code that reads or writes data)
- `docs/auth.md` — auth standards (applies to every route, middleware, Server Component, and data helper that touches authentication or user identity)
- `docs/data-mutations.md` — data mutation standards (applies to every insert, update, or delete operation, all Server Actions, and any code that writes to the database)

## Commands

```bash
npm run dev      # start dev server at localhost:3000
npm run build    # production build
npm run lint     # ESLint (eslint-config-next/core-web-vitals + typescript)
```

No test runner is configured yet.

## Architecture

This is a **Next.js 16 App Router** project (React 19, TypeScript, Tailwind CSS v4). It was bootstrapped from `create-next-app` and is a blank slate — only the default scaffold exists.

- `src/app/` — App Router root. `layout.tsx` is the root layout (Geist font variables, `min-h-full flex flex-col` body). `page.tsx` is the home route.
- `@/*` path alias maps to `src/*`.
- Tailwind is configured via PostCSS (`@tailwindcss/postcss`); no `tailwind.config.*` file — config is done in CSS or via PostCSS options.

**Next.js version note:** This project runs Next.js 16, which has breaking API changes from the versions in Claude's training data. Before writing any Next.js-specific code, read the relevant guide in `node_modules/next/dist/docs/`. Key gotcha from the bundled docs: for instant client-side navigations, `Suspense` alone is insufficient — you must also export `unstable_instant` from the route (see `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`).
