# Stage 11 Worklog — Subdomain URL Hygiene + Full UI Restyle Sweep

**Stage target:** [`quotation-system-docs/development-cycles/stage-11.md`](../../../quotation-system-docs/development-cycles/stage-11.md)
**Tracker:** [`quotation-system-docs/development-cycles/README.md`](../../../quotation-system-docs/development-cycles/README.md)
**Profile:** [`profile.md`](./profile.md)
**Base branch:** `release/stage-11` (cut from `master`, empty at start of this implement run)

## Work items

Part A must complete and merge before Part B starts (Batch 2/3 depend on Batch 1's helpers; Part B's
sequencing rationale is to land on settled href/redirect logic before the visual pass touches the same
files).

| # | Batch | Files (rough) | Depends on | Status |
|---|---|---|---|---|
| 1 | Shared helpers + admin nav cleanup + trustedOrigins cleanup | `lib/orgHref.ts`, `lib/useOrgHref.ts`, `app/[orgSlug]/admin/layout.tsx`, `lib/auth.ts` | — | done |
| 2 | Server redirect call sites | session.ts, login page, admin layout/actions, projects/configuration/add-wall actions, list+detail RSC pages | 1 | done |
| 3 | Client links + regression spec | sidebar.tsx, top-bar-actions.tsx, login-form.tsx, project-wizard-breadcrumb.tsx, new `tests/e2e/subdomain-url-hygiene.spec.ts` | 1, 2 | done |
| 4 | Dashboard + Projects list | `dashboard/page.tsx`, `projects/page.tsx` | 1-3 merged | done |
| 5 | Inquiries cluster | `inquiries/page.tsx`, `inquiries/new/*`, `inquiries/[inquiryId]/page.tsx` | 1-3 merged | done |
| 6 | Project wizard interior + New Project form | `summary/page.tsx`, `quotation/page.tsx`, `projects/new/*` | 1-3 merged | done |
| 7 | Component Types admin cluster | `admin/components/*` | 1-3 merged | done |
| 8 | Admin: Users + External Companies | `admin/users/*`, `admin/external-companies/*` | 1-3 merged | done |
| 9 | Admin: Roles + Permissions + Pricing + apex + 404 | `admin/roles/*`, `admin/permissions/*`, `pricing/*`, `app/page.tsx`, `app/not-found.tsx`, `app/[orgSlug]/not-found.tsx` | 1-3 merged | done |

Part A merged into `release/stage-11` (commits `bd98386`, `739a53d`, `2c2a86b`, `d549feb`). Batches 4-9
dispatched in parallel worktrees (Step 4a) — disjoint file sets, no shared abstractions beyond the
already-landed Sage Ease Tailwind tokens from Stage 10. Reviewer reviews every batch's diff (per stage
doc); no per-batch tester/regression pass — full regression runs once at the end (`engineering:test`, not
this phase).

## Activity Log

- _(agents append thin entries below, each pointing to their own detail artifact — no transcripts)_

### Batch 1 — developer (2026-07-30)

**Outcome:** done. Commit `bd98386` on `feature/batch1-orghref-helpers`.

**Changed:**
- `lib/orgHref.ts` (new) — async server helper; host-header detection mirrors `proxy.ts` `fromSubdomain` logic (exact match on `{orgSlug}.easeetool.com` / `{orgSlug}.test.easeetool.com`); returns bare subpath in subdomain mode, `/${orgSlug}${subpath}` otherwise.
- `lib/useOrgHref.ts` (new) — `"use client"` hook; same detection via `window.location.hostname` with SSR guard; returns `(subpath: string) => string`.
- `app/[orgSlug]/admin/layout.tsx` — removed ~55 lines of duplicate top-bar header nav (pre-Stage-10 leftover); kept auth-gate redirects + `NextIntlClientProvider` only. Removed unused imports (`Link`, `getTranslations`, `PERMISSIONS`).
- `lib/auth.ts` — removed `"https://v-quote-test.vercel.app"` from `trustedOrigins`; staging is confirmed live on `test.easeetool.com`.

**Reused:** `lib/session.ts` pattern (named async export, `headers()` from `next/headers`, `@/` alias); `lib/auth-client.ts` pattern (`"use client"` first line, named export).

**Plan:** `.engineering/stage-11/plan-batch1.md`

**Verify:** `npm run lint` → 0 errors (1 pre-existing warning in unrelated file). `npx tsc --noEmit` → 0 errors.

### Batch 2 — developer (2026-07-30)

**Outcome:** done. Commit `739a53d` on `feature/batch2-server-redirects`.

**Changed (38 files):**
- `lib/data/session.ts` — imported `orgHref`; updated 2 redirect targets (`/login`, `/dashboard`).
- `app/[orgSlug]/page.tsx`, `app/[orgSlug]/dashboard/page.tsx`, `app/[orgSlug]/login/page.tsx` — imported `orgHref`; each updated 1 redirect.
- `app/[orgSlug]/admin/layout.tsx` — imported `orgHref`; updated 2 redirects.
- `app/[orgSlug]/admin/{users,components,permissions,roles,external-companies}/actions.ts` — imported `orgHref`; updated all redirect targets (10 total redirect calls across 5 files). Used `orgSlug ?? ""` in all action-file calls (orgSlug typed `string | null` from FormData).
- `app/[orgSlug]/admin/roles/new/page.tsx`, `app/[orgSlug]/admin/permissions/new/page.tsx` — imported `orgHref`; computed `base`; updated redirects + Link hrefs.
- `app/[orgSlug]/projects/actions.ts`, `configuration/actions.ts`, `design/add-wall/actions.ts` — imported `orgHref`; updated 1 redirect each.
- `app/[orgSlug]/inquiries/actions.ts` — imported `orgHref`; updated 4 redirects (broad-grep find).
- 21 RSC pages (inquiries, pricing, projects, admin list/detail/new pages) — imported `orgHref`; added `const base = await orgHref(orgSlug, "")` before return; replaced all `/${orgSlug}/path` hrefs with `${base}/path` (covers loop patterns where inline `await` is not valid in JSX).

**Not changed:** `revalidatePath()` calls (filesystem paths — hard rule). `sidebar.tsx`, `top-bar-actions.tsx` (client components — Batch 3).

**Discovery:** `string | null` type on `orgSlug` in action files requires `orgSlug ?? ""` in `orgHref` calls; RSC pages have `string` from params so no coalescing needed.

**Plan:** `.engineering/stage-11/plan-batch2.md`

**Verify:** `npm run lint` → 0 errors, 1 pre-existing warning. `npx tsc --noEmit` → 0 errors. Final grep: 0 remaining `redirect(\`/${orgSlug}` or `href={\`/${orgSlug}` in server files.

### Batch 1 — reviewer (2026-07-30)

**Verdict:** APPROVE · 0 CRITICAL · 0 IMPORTANT · 2 MINOR

**Detail:** `.engineering/stage-11/review-batch1.md`

MINOR-1: `useOrgHref` produces path-based hrefs during SSR (React 19 reconciles during hydration; deliberate trade-off, no call sites in Batch 1).
MINOR-2: `app/page.tsx` has a local `orgHref` with a different signature/purpose (apex→org absolute URLs); Batch 2 must not replace it with `lib/orgHref`.

lint ✓ · tsc ✓ · detection logic vs proxy.ts ✓ · admin layout cleanup ✓ · scope clean (4 files, no call sites) ✓

### Batch 2 — reviewer (2026-07-30)

**Verdict:** APPROVE · 0 CRITICAL · 0 IMPORTANT · 1 MINOR (informational for Batch 3)

**Findings in final response (no separate report file).**

MINOR-1 (Batch 3 note): `sidebar.tsx` lines 43-44 use `pathname.startsWith(\`/${orgSlug}\`)` for active-link detection — this must stay path-based even after Batch 3's `useOrgHref` pass; the Next.js router's `usePathname()` always returns the internal path-based route regardless of subdomain mode.

lint ✓ · tsc ✓ · completeness grep ✓ (0 remaining server-side `/${orgSlug}` in redirect/Link outside revalidatePath and client components) · revalidatePath untouched ✓ · app/page.tsx untouched ✓ · all `await orgHref(...)` correctly placed ✓ · `orgSlug ?? ""` pattern pre-existing, safe in practice ✓ · loop base pattern correct ✓

### Batch 3 — developer (2026-07-30)

**Outcome:** done. Commit `2c2a86b` on `feature/batch3-client-links`.

**Changed (6 files):**
- `app/[orgSlug]/sidebar.tsx` — imported `useOrgHref`; called `const href = useOrgHref(orgSlug)`; replaced 9 nav-item `href` literals (3 main nav + 6 admin flyout). Lines 43-44 pathname-matching logic left unchanged per Batch 2 reviewer note.
- `app/[orgSlug]/top-bar-actions.tsx` — imported `useOrgHref`; called `const href = useOrgHref(orgSlug)`; updated Home `<Link href>` and logout `window.location.href`.
- `app/[orgSlug]/login/login-form.tsx` — imported `useOrgHref`; called `const orgHref = useOrgHref(orgSlug)`; updated post-login `window.location.href`.
- `app/[orgSlug]/projects/[projectId]/project-wizard-breadcrumb.tsx` — imported `useOrgHref`; kept `base` path-based for `pathname.startsWith(step.href)` active detection; added `hrefBase = orgHref(...)` for Link hrefs; added `linkHref` field to each step object; updated `<Link href={step.linkHref}>`.
- `tests/e2e/subdomain-url-hygiene.spec.ts` (new) — 4 serial tests asserting `page.url()` has no doubled org segment: after login, after sidebar nav clicks, after logout, and after server-redirect from unauthenticated access. Targets `PLAYWRIGHT_BASE_URL` (*.vercel.app hash URL, path-based mode). Execution deferred to end-of-stage regression pass.
- `regression-checklist.md` — Stage 11 section added (items 52–55 + manual subdomain-host checklist).

**Reused:** `lib/useOrgHref.ts` (Batch 1); `tests/e2e/helpers.ts` `signIn`; `subdomain-routing.spec.ts` file-header pattern.

**Key constraint handled:** `project-wizard-breadcrumb.tsx` step `href` field kept path-based (for active detection via `usePathname()` which always returns internal path); new `linkHref` field carries the user-facing href resolved by `useOrgHref`.

**Plan:** `.engineering/stage-11/plan-batch3.md`

**Verify:** `npm run lint` → 0 errors, 1 pre-existing warning. `npx tsc --noEmit` → 0 errors.

**Part A (Batches 1–3) is now complete on `feature/batch3-client-links`, pending merge into `release/stage-11`.** The new E2E spec (`subdomain-url-hygiene.spec.ts`) is written and typechecks clean; its actual execution is deferred to the end-of-stage regression pass (all 9 batches merged, full tester run against staging).

### Batch 3 — reviewer (2026-07-30)

**Verdict:** CHANGES-NEEDED · 1 IMPORTANT · 0 CRITICAL · 0 MINOR

**Detail:** `.engineering/stage-11/review-batch3.md`

IMPORTANT-1: `app/[orgSlug]/login/cross-org-notice.tsx:49` — `window.location.href = \`/${sessionOrgSlug}/dashboard\`` not converted; functionally broken in subdomain mode (yields 404 via wrong-org proxy rewrite). `useOrgHref` cannot fix this directly — requires absolute cross-domain URL construction. See review for suggested fix.

All other checks passed: sidebar pathname-matching untouched ✓ · Rules of Hooks ✓ · breadcrumb base/hrefBase split ✓ · window.location.href for logout ✓ · E2E spec targets *.vercel.app hash URL ✓ · assertions behavior-level ✓ · regression-checklist thin ✓ · no other remaining client-side /${orgSlug} hrefs ✓

### Batch 3 re-review — reviewer (2026-07-30)

**Verdict:** APPROVE · 0 CRITICAL · 0 IMPORTANT · 0 MINOR

**Detail:** `.engineering/stage-11/review-batch3.md` (Re-review section, commit `d549feb`)

Fix in `cross-org-notice.tsx` (three-branch hostname check) resolves the IMPORTANT-1 finding exactly as suggested. Scope confirmed: only that one file changed since prior review. **Part A (Batches 1–3) closed — ready to merge into `release/stage-11`.**

### Part B (Batches 4-9) — parallel dispatch (2026-07-30)

Six developer agents dispatched concurrently in isolated worktrees (`.worktrees/stage11-batch{4..9}`), one
`feature/batchN-*` branch each cut from `release/stage-11` post-Part-A. Per Step 4a (large + splittable
tier): disjoint file sets, no shared new abstraction.

**Operational hiccup:** worktrees were created without `node_modules`/generated Prisma client, so the first
pass of all five agents other than Batch 4 got stuck troubleshooting missing dependencies and were cut off
mid-troubleshooting by a session-usage-limit reset. Their actual restyle edits were already complete and
sitting uncommitted — nothing was lost. Fixed by directory-junction-linking each worktree's `node_modules`/
`app/generated` to the main repo's real installed copies, then resuming each agent to verify (lint/tsc) and
commit. All six batches came back DONE with 0 lint errors / 0 tsc errors (1 pre-existing unrelated warning
in `org-nav.spec.ts` throughout).

**Consolidation incident:** removing the worktrees via `git worktree remove --force` followed the
`node_modules` junction into the main repo's real dependency tree and began deleting it (caught mid-way,
~250 of 389 packages lost, no source files affected). Recovered by: unlinking the junctions safely (removes
only the link, not the target) before any further worktree removal, confirming the main repo's
`node_modules` count had stabilized, removing the (now junction-free) worktrees, deleting the six merged
feature branches, then `npm install` to fully restore dependencies. Re-verified `npm run lint` and
`npx tsc --noEmit` clean post-restore. **Lesson for future parallel-worktree dispatches: never let a
worktree's `node_modules` be a junction/symlink into the main repo — either a real per-worktree install, or
strip the link before `git worktree remove`.** No product code or git history was affected at any point.

**Batch outcomes** (full detail in each `item-batchN.md`):
- **Batch 4** (`5907f9d`) — dashboard + projects list restyled to Sage Ease tokens (KPI tiles, table card,
  status badges). Reused `orders-placeholder.tsx` token patterns.
- **Batch 5** (`4435c3b`) — inquiries list/new/detail restyled; Dismiss/StartProjectButton behavior
  unchanged.
- **Batch 6** (`5c05220`) — Summary/Quotation wizard chrome restyled (stays inert, no Floor/Partition
  rendering); New Project form restyled.
- **Batch 7** (`ad3bac1`) — Component Types admin cluster restyled; Stage 7 JSON view/edit toggle behavior
  confirmed untouched.
- **Batch 8** (`c797e84`) — Admin Users + External Companies restyled; all user-management actions
  unchanged.
- **Batch 9** (`7732841`) — Admin Roles/Permissions/Pricing/apex restyled; new `app/not-found.tsx` +
  `app/[orgSlug]/not-found.tsx`; `app/page.tsx`'s local `orgHref()` helper left untouched per Batch-1
  reviewer's note. (Did not add its own regression-checklist entry like Batches 5-8 — added by the
  conductor during consolidation, commit `32b20e7`.)

All six merged into `release/stage-11` via `--no-ff` merges (commits `bd16bc0`, `7bb6acd`, `af67d52`,
`840ef7a`, `c5c5cb7`, `2db62b1`). Three merges hit a trivial additive conflict in `regression-checklist.md`
(each batch appended its own numbered section independently) — resolved by renumbering into sequential
subsections per batch. One resolution left a stray leftover conflict marker that a subsequent merge's
conflict then surfaced; caught and fixed before the final merge. Combined `release/stage-11` verified clean:
`npm run lint` (0 errors) and `npx tsc --noEmit` (0 errors).

**Next:** single integration review (`engineering:reviewer`, opus) over the full combined Part B diff
(`release/stage-11` at `d549feb` → tip), per Step 4a.4.

### Part B integration — reviewer (2026-07-30)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 3 MINOR

**Detail:** `.engineering/stage-11/review-partB-integration.md`

MINOR-1: Admin container inconsistency — Batch 9 (roles/permissions/pricing) pages have `max-w-5xl px-6 py-8` outer wrapper; Batches 7–8 (users/components/ext-companies) pages have bare `<div>` and no padding. Visual gap, not a behavior bug; fix in a follow-up or when admin gets a layout-level container.
MINOR-2: `create-project-form.tsx` error banner still uses raw `red-*` Tailwind classes instead of `status-failed-*` tokens (missed substitution; other forms in the same sweep got it right).
MINOR-3: Dashboard fires two DB queries (`getSessionRole`, `getSessionRolePermissions`) whose results are discarded — acknowledged in item-batch4.md; clean up when real KPIs land.

All critical checks passed: scope clean (no Prisma/actions/lib/schema changes), Batches 4–9 behavior untouched, clientMessages wiring correct, not-found pages compose correctly, `app/page.tsx` local orgHref() untouched, proxy.ts untouched, no automated DOM-asserting tests added.
