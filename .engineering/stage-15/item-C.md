# Stage 15 — Batch C record

**Role:** developer (Batch C)
**Branch:** `feature/stage15-list-pages`
**Items:** L2, PL1 (Created By half), L3, U1, U2
**Final commit SHA:** see git log
**Preview URL:** `https://quotation-system-4i3d61ayi-vistra-indias-projects.vercel.app`
**Status:** DONE

---

## What changed (per item)

### L2 — Created By column on inquiries list

`app/[orgSlug]/inquiries/page.tsx`:
- Added `<th>Created By</th>` header after "Submission Date" (same class as other headers)
- Added `<td title={inquiry.createdBy.name}>{inquiry.createdBy.username}</td>` as last cell in each row — username shown, full name on hover via `title` attribute

### PL1 (Created By half) — Created By column on projects list

`app/[orgSlug]/projects/page.tsx`:
- Identical change — `<th>Created By</th>` and `<td title={project.createdBy.name}>{project.createdBy.username}</td>`
- Batch A already handled the `pageSize` half of PL1.

### L3 — Loading feedback on My/All toggle

`components/list-page-controls.tsx`:
- Added `useTransition` to React imports
- Added `const [isPending, startTransition] = useTransition();` near top of component
- Wrapped `router.push(...)` in `startTransition(() => { ... })` inside the `navigate` callback
- Changed outer `<div>` to include `transition-opacity` and conditional `opacity-50` on `isPending`, plus `aria-busy={isPending}`
- **No `useTranslations` added** — constraint respected (shared across layouts with different `clientMessages` sets)

`loading.tsx` stubs for both `/inquiries` and `/projects` already existed (Stage 12 Batch 7c/7d) — no new files needed.

### U1/U2 — Row action icons in bordered boxes (Users + External Companies lists)

`app/[orgSlug]/admin/users/page.tsx`:
- Pencil edit `<Link>` className: `flex items-center justify-center text-primary-dark hover:text-primary` → `flex h-7 w-7 items-center justify-center rounded-sm border border-border text-primary-dark hover:bg-primary-softer hover:text-primary`

`app/[orgSlug]/admin/users/delete-user-button.tsx`:
- Trash `<button>` className: `flex items-center justify-center text-red-600 hover:text-red-700 disabled:opacity-50` → `flex h-7 w-7 items-center justify-center rounded-sm border border-border text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50`

`app/[orgSlug]/admin/external-companies/page.tsx`:
- Same pencil link restyle as Users page

`app/[orgSlug]/admin/external-companies/delete-company-button.tsx`:
- Same trash button restyle as delete-user-button.tsx

---

## What was reused

- Column header / cell class pattern from existing columns in inquiries/page.tsx (same `px-3 py-[10px]` and `text-text-muted` classes)
- `h-7 w-7 rounded-sm border border-border` pattern — matches pagination button sizing in `list-page-controls.tsx`, the canonical "icon-in-a-box" in this codebase
- `useTransition` — standard React hook, already available; pattern consistent with how `delete-user-button.tsx` uses it for the delete action

---

## Manual checks observed (against preview URL)

All verified via Playwright against `https://quotation-system-4i3d61ayi-vistra-indias-projects.vercel.app` (deployment `dffbfbd`):

| Item | Check | Observed |
|---|---|---|
| **L2** | "Created By" column header visible on inquiries list | ✓ — `getByRole("columnheader", { name: /created by/i })` found |
| **L2** | Cell shows username | ✓ — `"admin"` (cell text) |
| **L2** | Hovering shows full name | ✓ — `title="acme-glass admin"` (name field from DB) |
| **PL1/L2** | "Created By" column header visible on projects list | ✓ |
| **PL1/L2** | Cell shows username / full name on hover | ✓ — same `"admin"` / `"acme-glass admin"` |
| **U1/U2** | Users list edit link has border box | ✓ — `class` contains `rounded-sm border border-border h-7 w-7` |
| **U1/U2** | Users list delete button has border box | ✓ — same classes confirmed |
| **U2** | External Companies list edit link has border box | ✓ |
| **U2** | External Companies list delete button has border box | ✓ |
| **L3** | `aria-busy="false"` present on controls div when idle | ✓ |
| **L3** | My Inquiries toggle button visible inside controls | ✓ |

Existing `stage15.spec.ts` (3 tests from Batch A) re-run: `3 passed (38.3s)` — no regression.

---

## SQL mirror conclusion

`createdBy { id, name, username }` was already selected in both list queries:
- `lib/data/inquiries.ts:175`: `createdBy: { select: { id: true, name: true, username: true } }`
- `lib/data/projects.ts:151`: `createdBy: { select: { id: true, name: true, username: true } }`

The column was always fetched; the table simply never rendered it. **No `prisma.<model>.<method>` call shape changed → no `by-page.sql` update required.**

---

## Files changed (full set)

| File | Item | Change |
|---|---|---|
| `app/[orgSlug]/inquiries/page.tsx` | L2 | Add Created By `<th>` + `<td title={name}>{username}</td>` |
| `app/[orgSlug]/projects/page.tsx` | PL1/L2 | Same |
| `components/list-page-controls.tsx` | L3 | `useTransition` + `startTransition` wrapping `router.push` + `opacity-50`/`aria-busy` on container |
| `app/[orgSlug]/admin/users/page.tsx` | U1/U2 | Pencil link → bordered box |
| `app/[orgSlug]/admin/users/delete-user-button.tsx` | U1/U2 | Trash button → bordered box |
| `app/[orgSlug]/admin/external-companies/page.tsx` | U2 | Pencil link → bordered box |
| `app/[orgSlug]/admin/external-companies/delete-company-button.tsx` | U2 | Trash button → bordered box |

---

## Verify commands

```bash
# Static checks (ran locally, both clean):
npm run lint       # 0 errors, 4 pre-existing warnings in test files
npx tsc --noEmit   # no output = clean

# Against preview URL:
PLAYWRIGHT_BASE_URL=https://quotation-system-4i3d61ayi-vistra-indias-projects.vercel.app \
  npx playwright test tests/e2e/stage15.spec.ts --reporter=line
# Result: 3 passed (38.3s)
```

---

## Deliberately untouched

- `lib/data/inquiries.ts`, `lib/data/projects.ts` — query shape unchanged (no new selects needed)
- `messages/en.json` — "Created By" header is hardcoded in English, consistent with other hardcoded headers in these RSC pages ("Project Name", "Location", "Status", "Created On")
- All files owned by Batch G (`admin/users/[userId]/**`, `admin/users/new/**`, Prisma schema, seed, roles API)
- D, E, F batch items (form labels, inquiry view, currency formatting)
