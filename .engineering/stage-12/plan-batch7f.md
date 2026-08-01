# Plan — Batch 7f: Admin Section Padding

## Canonical padding pattern (non-admin reference)

Non-admin section sub-layouts (inquiries, projects, orders) each wrap their children with:
```tsx
<div className="mx-auto w-full max-w-5xl px-6 py-8">{children}</div>
```
No extra background override, no `flex min-h-screen`, no nested `<main>`. The org-shell layout
(`[orgSlug]/layout.tsx`) provides `<main className="flex-1 overflow-auto">` as the scroll host.

## What's wrong with the admin layout today

`app/[orgSlug]/admin/layout.tsx` wraps its children in:
```tsx
<div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
  <header>...</header>
  <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
</div>
```

Two problems:
1. The outer div has `flex min-h-screen flex-col bg-zinc-50` — creates a new full-height stacking
   context inside the org shell's scroll host AND overrides the app background color (`bg-zinc-50`
   vs the shell's `bg-bg-page` design token). This is why admin pages look visually different.
2. The inner element is `<main>` nested inside the org shell's outer `<main>` — semantically invalid
   HTML (only one `<main>` per document is valid); should be a `<div>`.

## Secondary finding: permissions/new missing mx-auto

`app/[orgSlug]/admin/permissions/new/page.tsx` uses `<div className="max-w-lg">` (no `mx-auto`),
while every other narrow-form admin page (`users/new`, `external-companies/new`, `users/[userId]`)
uses `<div className="mx-auto max-w-lg">`. Without `mx-auto` the form is left-aligned instead of
centered within the padded container.

## Files changed

| File | Change |
|---|---|
| `app/[orgSlug]/admin/layout.tsx` | Remove `flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950` from outer div; change `<main className="mx-auto w-full max-w-5xl px-6 py-8">` → `<div className="mx-auto w-full max-w-5xl px-6 py-8">` |
| `app/[orgSlug]/admin/permissions/new/page.tsx` | Change `<div className="max-w-lg">` → `<div className="mx-auto max-w-lg">` |

## Admin pages checked and requiring NO change

All list pages (`users`, `external-companies`, `components`, `roles`, `permissions`) — bare root
`<div>`, rely on layout padding — consistent.

Form/detail pages: `users/new` (`mx-auto max-w-lg`), `external-companies/new` (`mx-auto max-w-lg`),
`users/[userId]` (`mx-auto max-w-lg`), `components/new` (bare `<div>`), `components/[typeId]`
(bare `<div>`), `roles/new` (bare `<div>`), `roles/[roleId]` (bare `<div>`) — all consistent.

## What I will NOT change

- Secondary admin nav header content/links — kept intact (content, not padding)
- `admin/components/*` JSON toggle logic — untouched per constraint
- Any data-fetching, actions, or business logic — untouched

## Verification

1. `npm run lint` — should be clean
2. `npx tsc --noEmit` — should be clean
3. Commit + push `feature/batch7f-admin-padding` → poll Vercel preview to READY
4. Hit `/api/health` on preview — expect `database: "connected"`
5. Visually compare an admin list page (e.g. `/admin/users`) against `/inquiries`:
   - Same background color (app shell's `bg-bg-page`)
   - Same left-margin/content-width (both `max-w-5xl`)
   - Same top padding (both `py-8` from their respective wrappers, ignoring admin's secondary nav header which is content)
