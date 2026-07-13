# UI Coding Standards

## Rule: shadcn/ui Only

**All UI components must come from shadcn/ui. No custom-built UI primitives.**

Every button, input, card, badge, dialog, dropdown, form element, or other UI primitive must be a shadcn/ui component installed via `npx shadcn@latest add <component>` and sourced from `src/components/ui/`.

## What This Means in Practice

- **Do not** create custom React components that render raw HTML elements for UI purposes (`<button>`, `<input>`, `<div>` styled as a card, etc.).
- **Do not** use any third-party component library other than shadcn/ui.
- **Do not** write inline Tailwind classes to build a UI primitive shadcn/ui already provides.
- **Do** compose pages entirely from `src/components/ui/` components.
- **Do** install new shadcn/ui components as needed: `npx shadcn@latest add <component>`.

## Installing Components

```bash
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add card
```

Installed components live in `src/components/ui/` and are owned by this project. Do not modify their internals — use the exposed `className` and `variant` props instead.

## Allowed Use of Tailwind

Tailwind utility classes are allowed **only** for layout and spacing between shadcn/ui components (e.g., `flex`, `gap-4`, `mt-8`, `grid`). Do not use Tailwind to build or style a UI primitive that shadcn/ui covers.

## Theme

The app supports dark and light mode toggled via `src/components/theme-toggle.tsx`. Theme is stored in `localStorage` and applied via a `dark` class on `<html>`. Use Tailwind's `dark:` variant for any theme-sensitive styles.

## File Structure

```
src/
  components/
    ui/               ← shadcn/ui components only (installed, not hand-written)
    theme-toggle.tsx  ← dark/light mode toggle (client component)
  app/                ← pages that compose ui/ components
```

Do not create a `components/custom/` directory or any file that exports a hand-rolled UI primitive.

## Rationale

A single component library keeps the visual language coherent, reduces decision fatigue, and makes accessibility and theming predictable across every screen.
