# Stage 15 — Batch C record

**Role:** developer (Batch C)
**Branch:** `feature/stage15-list-pages`
**Items:** L2, PL1 (Created By), L3, U1, U2
**Status:** IN PROGRESS (written before edit)

---

## Implementation plan

### Decisions / Deviations

None. All items are mechanical; no design judgment required beyond what the stage doc already settled.

### SQL mirror conclusion

`createdBy { id, name, username }` is already selected in both `lib/data/inquiries.ts:175` and
`lib/data/projects.ts:151`. The column was always fetched; it was just never rendered in the table.
**No `prisma.<model>.<method>` call shape changes → no `by-page.sql` update required.**

### L3 note

`loading.tsx` stubs for `/inquiries` and `/projects` already exist (Stage 12 Batch 7c/7d). Only the
`useTransition` part is missing from `ListPageControls`.

### Files changed

| File | Item | Change |
|---|---|---|
| `app/[orgSlug]/inquiries/page.tsx` | L2 | Add `<th>` "Created By" + `<td>` with `username` text and `title={name}` hover |
| `app/[orgSlug]/projects/page.tsx` | PL1/L2 | Same |
| `components/list-page-controls.tsx` | L3 | Add `useTransition`, wrap `router.push` in `startTransition`, add `opacity-50` on `isPending` to the container div. No `useTranslations` — constraint respected. |
| `app/[orgSlug]/admin/users/page.tsx` | U1/U2 | Restyle pencil `<Link>` with `border border-border rounded-sm` box |
| `app/[orgSlug]/admin/users/delete-user-button.tsx` | U1/U2 | Restyle trash `<button>` with box |
| `app/[orgSlug]/admin/external-companies/page.tsx` | U2 | Same pencil link restyle |
| `app/[orgSlug]/admin/external-companies/delete-company-button.tsx` | U2 | Same trash button restyle |

### Reuse

- Column header style pattern from existing `<th>` in inquiries/page.tsx (`px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted`)
- Cell style from existing `<td>` (`px-3 py-[11px] text-[13px] text-text-muted`)
- `useTransition` from React (already imported package)
- Box button style: `flex h-7 w-7 items-center justify-center rounded-sm border border-border` — matches the pagination button style in the same file, which is the canonical "icon-in-a-box" pattern in this codebase

### Verification

1. `npm run lint` — clean
2. `npx tsc --noEmit` — clean
3. Commit + push `feature/stage15-list-pages`
4. Poll Vercel until deployment for that SHA is READY; check route list in build log
5. Manual checks against preview URL (see observed results below)

---

## What changed (per item)

### L2 — Created By column on inquiries list

Added after the "Submission Date" `<th>` and after the last `<td>`:
- Header: `<th>Created By</th>` with same class as other headers
- Cell: `<td title={inquiry.createdBy.name}>{inquiry.createdBy.username}</td>` — username visible, full name on hover

### PL1 (L2 part) — Created By column on projects list

Same treatment in `projects/page.tsx`.

### L3 — Loading feedback on My/All toggle

In `list-page-controls.tsx`:
- Added `useTransition` to the imports from React
- Added `const [isPending, startTransition] = useTransition();`
- Wrapped `router.push(...)` inside `startTransition(() => { ... })` in the `navigate` callback
- Added `transition-opacity` + `isPending ? "opacity-50" : ""` to the outer `<div>` class
- No `useTranslations` added — constraint satisfied

`loading.tsx` files for both routes were already present (Stage 12 Batch 7c/7d) — no new files needed.

### U1/U2 — Icon box styling on Users list and External Companies list

Box style applied: `flex h-7 w-7 items-center justify-center rounded-sm border border-border`

- `admin/users/page.tsx`: pencil `<Link>` className updated from bare icon to bordered box
- `admin/users/delete-user-button.tsx`: `<button>` className updated to bordered box
- `admin/external-companies/page.tsx`: pencil `<Link>` className updated
- `admin/external-companies/delete-company-button.tsx`: `<button>` className updated

---

## Manual check results

Filled in after verification against Vercel preview.

| Item | Check | Observed |
|---|---|---|
| **L2** | "Created By" column appears on inquiries list with username; hovering shows full name tooltip | — |
| **PL1/L2** | Same on projects list | — |
| **L3** | My/All toggle and date filter dim to 50% opacity during navigation transition | — |
| **U1/U2** | Users list — edit and delete icons sit in visible bordered boxes | — |
| **U2** | External Companies list — same | — |

---

## SQL mirror conclusion

No `prisma.<model>.<method>` call shape changes. `createdBy` was already selected in both list queries;
only the rendering layer changed. No update to `by-page.sql` required.
