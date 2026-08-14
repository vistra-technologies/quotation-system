# Stage 15 Batch B — item record

**Role:** developer (claude-sonnet-4-6)
**Branch:** `feature/stage15-dashboard-topnav`
**Final commit (app):** `e2470f7` (test fix) / `c2eaa8c` (main changes)
**Commit (docs repo):** `8612309`
**Preview URL:** `https://quotation-system-ef62nqerx-vistra-indias-projects.vercel.app`

---

## What changed per item

### D1 — Dashboard greeting shows full name
**File:** `app/[orgSlug]/dashboard/page.tsx:73`
**Change:** Removed `.split(" ")[0]`. The welcome now renders `me.name ?? me.username` directly as `displayName`. One line removed.
**Manual result:** Admin user (name = "acme-glass admin") → H1 showed "Welcome, acme-glass admin". Before fix would have shown "Welcome, acme-glass". ✓

### D2 — Profile dropdown shows username bold, role beneath
**Files:** `app/[orgSlug]/top-bar-actions.tsx`, `app/[orgSlug]/layout.tsx`
**Change:** Added `username: string` to `TopBarActionsProps`. Layout passes `me.username`. Dropdown header now renders `{username}` bold instead of `{name}`.
**Manual result:** Admin dropdown showed "admin / Admin". Distributor dropdown showed "distributor / Distributor". Previously showed display name "acme-glass admin". ✓

### D3 — KPI cards scoped by external company for external users
**File:** `lib/data/stats.ts`
**Change:** `getDashboardStats()` now checks `session.externalCompanyId`. If non-null, adds `externalCompanyId` filter to all four COUNT queries. The tenancy `organizationId` filter is always applied. Route handler unchanged — already passes the full session.
**Filter is `externalCompanyId = session.externalCompanyId`** (decision 1 in stage-15.md — not `createdByUserId`, so counts match the list pages).
**SQL mirror updated:** `quotation-system-docs/design-docs/sql-queries/by-page.sql` — stats section extended with `[internal]` / `[external]` variant comments.
**Automated test result:** `stage15-b.spec.ts` — 2 tests passed. Admin: 101 projects / 231 inquiries. Distributor: 9 / 9. Scoping confirmed working. ✓

### D4 — Org/company chips moved to right corner
**Files:** `app/[orgSlug]/layout.tsx`, `app/[orgSlug]/top-bar-actions.tsx`
**Change:** Removed the left `<div>` with chips from layout.tsx; changed `header` to `justify-end`. Added `orgName: string` and `externalCompanyName: string | null` props to `TopBarActionsProps` and to the interface. Layout passes `me.orgName` and `me.externalCompanyName`. `TopBarActions` renders the org chip and (conditionally) the external-company chip inline before the Home and Profile buttons.
**Manual result:** Header shows "Acme Glass Co." chip in right corner alongside Home and Profile buttons. Distributor user also shows the external company chip. No chips on left side. Header has `justify-end` class. ✓

---

## clientMessages trap confirmation

`top-bar-actions.tsx` is a client component. Grepped layout for `clientMessages` — none found. Grepped `top-bar-actions.tsx` for `useTranslations` — none found. The component uses no i18n. Trap does not apply.

---

## What was reused

- `session.externalCompanyId` null-check pattern — matches the existing discriminator used across list routes and API route handlers (`lib/api-auth.ts` pattern).
- Chip markup (SVGs, CSS classes) in `top-bar-actions.tsx` — copied directly from the original chips in `layout.tsx` (no new design tokens).
- `signIn` helper from `tests/e2e/helpers.ts` — called with `clearCookies()` guard before each call (residual session cookies would redirect away from the login page).

---

## Verification commands and results

```
npm run lint                → exit 0 (no output)
npx tsc --noEmit            → exit 0 (no output)

D3 spec:
  PLAYWRIGHT_BASE_URL=https://quotation-system-ef62nqerx-vistra-indias-projects.vercel.app \
  npx playwright test tests/e2e/stage15-b.spec.ts --reporter=line
  → 2 passed (30.4s)

Health check:
  GET https://quotation-system-ef62nqerx-vistra-indias-projects.vercel.app/api/health
  → 200 {"status":"ok","database":"connected",...}

Stats API routes (auth guard):
  GET /api/v1/orgs/vistra/stats → 401 ✓ (route exists, requires auth)
  GET /vistra/dashboard        → 200 ✓

Manual D3 counts (live preview):
  Admin (org-wide):      projectsTotal=101, inquiriesTotal=231
  Distributor (scoped):  projectsTotal=9,   inquiriesTotal=9
```

---

## Manual verification — D1, D2, D4 (observed results)

Verified against `https://quotation-system-ef62nqerx-vistra-indias-projects.vercel.app` as `acme-glass/admin` and `acme-glass/distributor`.

| Item | What I expected | What I observed |
|---|---|---|
| **D1** | Full name "acme-glass admin" in H1, not just "acme-glass" | "Welcome, acme-glass admin" ✓ |
| **D2 (admin)** | Username "admin" bold, role "Admin" below in dropdown | Dropdown showed "admin" bold / "Admin" muted ✓ |
| **D2 (distributor)** | Username "distributor" bold, role "Distributor" below | Dropdown showed "distributor" / "Distributor" ✓ |
| **D4 (admin)** | Org chip in right corner beside Home/Profile; nothing on left | Header `justify-end`, "Acme Glass Co." chip right-aligned ✓ |
| **D4 (distributor)** | Both org chip and company chip in right corner | Both chips present in header, right-aligned ✓ |

---

## Decisions taken

- **D3 filter**: `externalCompanyId = session.externalCompanyId` per decision 1 (stage-15.md) — not `createdByUserId`.
- **D4 layout**: chips moved inside `TopBarActions` as props; `header` changed to `justify-end` (removing `justify-between` and the empty left `<div>`). This is the cleanest approach — no extra wrapper component needed.
- **Test fix**: Added `context.clearCookies()` before each `signIn()` call in the D3 spec. The Playwright browser retained a session cookie from a prior run, causing the login page to redirect immediately to the dashboard. This is defensive practice for any spec that switches users.

---

## What was deliberately left alone

- No changes to `app/api/v1/orgs/[orgSlug]/stats/route.ts` — it already passes the full `session` to `getDashboardStats()`; no route-level change needed.
- No changes to `app/[orgSlug]/dashboard/page.tsx`'s `MeResponse` interface — it already includes `username`; the dashboard page doesn't use it (only the layout uses it for `TopBarActions`).
- The `ordersTotal: 0` hardcode in the route handler — untouched (no Order model exists).
