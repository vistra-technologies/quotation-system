# Stage 12 Worklog — UI/API Layer Separation

**Stage target:** [`quotation-system-docs/development-cycles/stage-12.md`](../../../quotation-system-docs/development-cycles/stage-12.md)
**Tracker:** [`quotation-system-docs/development-cycles/README.md`](../../../quotation-system-docs/development-cycles/README.md)
**Profile:** [`profile.md`](./profile.md)
**Base branch:** `release/stage-12` (cut from `master`, empty at start of this implement run)

## Work items

Six batches, strictly serial — each later batch's route handlers build on Batch 1's `lib/api-auth.ts` /
`lib/api-error.ts` / `lib/internal-fetch.ts` infrastructure, and the stage doc's own Batch 1 "go/no-go gate"
means Batch 2 must not start until Batch 1 is pushed, previewed, and verified. Not treated as
large+splittable/parallel — batches touch shared conventions (RBAC mapping, error shapes) as they're
discovered, and this is the single highest tenancy/auth-risk stage to date, so serial dev↔reviewer discipline
applies throughout, no exceptions.

| # | Batch | Files (rough) | Depends on | Status |
|---|---|---|---|---|
| 1 | Infrastructure + Projects (proof of concept) + perf diagnosis fixes | `lib/api-auth.ts`, `lib/api-error.ts`, `lib/internal-fetch.ts`, `app/api/v1/orgs/[orgSlug]/projects/**`, `projects/page.tsx`/`actions.ts`/`[projectId]/page.tsx`/`layout.tsx`, `proxy.ts` (TTL cache only) | — | **merged** (`ec30092` on `release/stage-12`) |
| 2 | Inquiries + External Companies | `app/api/v1/orgs/[orgSlug]/inquiries/**`, `external-companies/**`, corresponding pages/actions | 1 | **merged** (`149c4e6` on `release/stage-12`) |
| 3 | Selections + Component Types | `app/api/v1/orgs/[orgSlug]/selections/**`, `component-types/**`, `component-categories/**`, `configuration/page.tsx`/`actions.ts` | 1 | **merged** (`75a1e6b` on `release/stage-12`) |
| 4 | Catalog + Pricing | `app/api/v1/orgs/[orgSlug]/catalog/**`, `pricing/*` pages/actions | 1 | **merged** (`f483674` on `release/stage-12`) |
| 5 | Admin: Users | `app/api/v1/orgs/[orgSlug]/users/**`, `roles/route.ts` (GET only), `admin/users/*` | 1 | **merged** (`dbe6c83` on `release/stage-12`) |
| 6 | Admin: Roles/Permissions/Components/Me + shell layouts (capstone) | `roles/[roleId]/**`, `app/api/v1/permissions/route.ts`, `orgs/[orgSlug]/me/route.ts`, `app/api/v1/orgs/route.ts`, remaining admin pages, both shell layouts, `app/page.tsx`, `eslint.config.mjs` DB-access rule | 1-5 merged | **merged** (`d8481a9` on `release/stage-12`) |

Batch 1 is a hard go/no-go gate per the stage doc: push → preview → verify list/create/detail/login-redirect
before Batch 2 starts.

## Activity Log

- _(agents append thin entries below, each pointing to their own detail artifact — no transcripts)_

### Batch 1 — developer (2026-07-30)

**Outcome:** DONE. Commit `1d33094` on `feature/batch1-api-infra-projects`.

**Preview URL:** `https://quotation-system-nfnl80dzg-vistra-indias-projects.vercel.app`

**Changed:**
- `lib/api-auth.ts` (new) — `ApiAuthError` + `getApiSession()`. Cross-tenant guard at step 5:
  `user.organizationId !== org.id → ApiAuthError(403)`.
- `lib/api-error.ts` (new) — canonical error-response factories (401/403/404/400/409/500).
- `lib/internal-fetch.ts` (new) — cookie-forwarding fetch helper; builds absolute URL from `host` header.
- `lib/orgHref.ts` (new) — ported from Stage 11 (Stage 11 in `staging` but not `master` when Stage 12
  branched from master; implementation fully specified in stage-11 worklog Batch 1 entry).
- `app/api/v1/orgs/[orgSlug]/projects/route.ts` (new) — GET list + POST create.
- `app/api/v1/orgs/[orgSlug]/projects/[projectId]/route.ts` (new) — GET detail.
- `app/[orgSlug]/projects/[projectId]/_project-fetch.ts` (new) — `React.cache()`-wrapped shared fetcher;
  layout + page share one HTTP call per render pass.
- `app/[orgSlug]/projects/loading.tsx` (new) — loading skeleton for projects list route.
- `app/[orgSlug]/projects/[projectId]/loading.tsx` (new) — loading skeleton for project detail route.
- `lib/session.ts` — wrapped `getSession` in `React.cache()`; drop-in replacement for all callers.
- `proxy.ts` — added in-process TTL Map cache (60 s) for org-slug lookups; `invalidateOrgCache(slug)`
  exported for future callers. No other proxy.ts changes.
- `app/[orgSlug]/projects/page.tsx` — switched to `internalFetch` against new API route.
- `app/[orgSlug]/projects/actions.ts` — thin marshaler: FormData → internalFetch → redirect.
- `app/[orgSlug]/projects/[projectId]/page.tsx` — switched to `fetchProjectDetail` cached fetcher.
- `app/[orgSlug]/projects/[projectId]/layout.tsx` — switched to `fetchProjectDetail` cached fetcher.
- `quotation-system-docs/design-docs/sql-queries/by-page.sql` — added Stage 12 API route sections.

**Reused:** `lib/data/projects.ts` (listProjects, createProject, getProjectById — untouched DAL),
`lib/prisma.ts` (singleton), `lib/auth.ts` (auth.api.getSession), `lib/rbac.ts` (unchanged).

**Key deviation flagged in plan.md:** `lib/orgHref.ts` ported from Stage 11 spec (not in master yet).

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts).
- `npx tsc --noEmit` → 0 errors.
- Preview `READY` in 48 s (`https://quotation-system-nfnl80dzg-vistra-indias-projects.vercel.app`).
- `/api/health` → `{ database: "connected" }`.
- `GET /api/v1/orgs/vistra/projects` (unauthenticated) → 401 `{"error":"Not authenticated"}`.
- `GET /api/v1/orgs/vistra/projects` (vistra admin session) → 200 `{"projects":[...]}`.
- `GET /api/v1/orgs/vistra/projects/[id]` (vistra admin session) → 200 with project data.
- `POST /api/v1/orgs/vistra/projects` (vistra admin session) → 201, created project ID confirmed.
- `GET /api/v1/orgs/acme-glass/projects` (vistra session) → 403 `{"error":"Access denied"}` ✓.
- `GET /api/v1/orgs/vistra/projects` with `Authorization: Bearer xxx` → 401 ✓.
- `/vistra/projects` (no cookie, following redirects) → 200 (login page) ✓.
- `/vistra/projects` (vistra session) → 200 ✓.
- `/vistra/projects/[newProjectId]` (vistra session) → 200, page shows "Stage12 Test Project" ✓.

**Go/no-go gate: PASS.** Batch 2 may proceed.

### Batch 1 — reviewer (2026-07-30)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 3 MINOR

**Findings in reviewer final response** (no separate report file).

MINOR-1: All three migrated files — `projects/page.tsx`, `[projectId]/layout.tsx`, `[projectId]/page.tsx` — surface backend 5xx errors as `notFound()` (404 page) rather than propagating to the error boundary. Errors still logged server-side. Low-priority UX issue.

MINOR-2: `lib/orgHref.ts` port confirmed faithful to Stage 11 Batch 1 spec. When Stage 11 merges to `master`, there will be a trivial merge conflict on this file. Human should plan for reconciliation; no action in Batch 1.

MINOR-3 (informational): `projects/page.tsx` retains three hardcoded `/${orgSlug}/...` `<Link>` hrefs from the pre-Stage-11 master baseline. Functionally correct (proxy's `alreadyPrefixed` guard prevents double-rewrite) but produces double-prefixed URLs in subdomain mode browser bar. URL hygiene gap that Stage 11 already fixes in `staging`; will be resolved on rebase/reconciliation when Stage 11 reaches `master`.

All critical security checks passed: cross-tenant guard ✓ · React.cache() request-scoped ✓ · proxy TTL cache purely additive ✓ · orgHref port faithful ✓ · RBAC (auth-only for projects) ✓ · internalFetch cookie forwarding ✓

### Batch 2 — developer (2026-07-30)

**Outcome:** DONE. Commit `6e352c6` on `feature/batch2-inquiries-external-companies`.

**Preview URL:** `https://quotation-system-jtju7yeyk-vistra-indias-projects.vercel.app`

**Changed:**
- `app/api/v1/orgs/[orgSlug]/inquiries/route.ts` (new) — GET list + POST create.
- `app/api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/route.ts` (new) — GET detail + PATCH dismiss.
- `app/api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert/route.ts` (new) — POST "Start Project" conversion.
- `app/api/v1/orgs/[orgSlug]/external-companies/route.ts` (new) — GET list (no perm gate) + POST create (MANAGE_USERS).
- `app/api/v1/orgs/[orgSlug]/external-companies/[companyId]/route.ts` (new) — GET single company.
- `app/[orgSlug]/inquiries/loading.tsx` (new) — loading skeleton for inquiries list route.
- `app/[orgSlug]/inquiries/[inquiryId]/loading.tsx` (new) — loading skeleton for inquiry detail route.
- `app/[orgSlug]/inquiries/page.tsx` — removed requireSession; switched to internalFetch.
- `app/[orgSlug]/inquiries/actions.ts` — all 3 actions (createInquiry, dismissInquiry, convertInquiryToProject) converted to thin marshalers.
- `app/[orgSlug]/inquiries/new/page.tsx` — kept requireSession (needs externalCompanyId); switched DAL reads to internalFetch.
- `app/[orgSlug]/inquiries/[inquiryId]/page.tsx` — removed requireSession + getInquiryById; switched to internalFetch.
- `app/[orgSlug]/projects/new/page.tsx` — kept requireSession (needs externalCompanyId); switched lib/data/admin.listExternalCompanies + lib/data/external-companies.getExternalCompanyById to internalFetch.
- `quotation-system-docs/design-docs/sql-queries/by-page.sql` — added Stage 12 Batch 2 API route sections; updated inquiries + external-companies section headers.

**Reused:** `lib/api-auth.ts` (getApiSession, ApiAuthError), `lib/api-error.ts` (all factories), `lib/internal-fetch.ts` (internalFetch), `lib/orgHref.ts`, `lib/data/inquiries.ts` (all functions untouched), `lib/data/external-companies.ts` (all functions untouched), `lib/rbac.ts` (requirePermission/ForbiddenError for external-companies POST).

**Key design note:** No React.cache() wrapper needed — `inquiries/layout.tsx` only provides NextIntlClientProvider (no DB calls), so there is no layout+page duplicate-fetch scenario for inquiries unlike projects.

`requireSession` kept in `inquiries/new/page.tsx` and `projects/new/page.tsx` for `session.externalCompanyId` UI branching — the external-companies DAL reads are the ones switched to the API. Consistent with stage doc's phased approach; Batch 6 `/me` route will complete the session migration for these pages.

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts).
- `npx tsc --noEmit` → 0 errors.
- Preview `READY` in 48 s.
- `/api/health` → `{ database: "connected" }`.
- All 8 new routes (GET/POST /inquiries, GET/PATCH /inquiries/[id], POST /inquiries/[id]/convert, GET/POST /external-companies, GET /external-companies/[id]) → 401 unauthenticated ✓.
- Bearer token → 401 "Bearer token authentication not yet supported" ✓.
- Cross-tenant guard: uses same `getApiSession()` infrastructure verified in Batch 1 ✓ (identical code path).
- Full functional verification (list/create/detail/dismiss/convert, cross-tenant 403) requires authenticated session — to be covered by end-of-stage tester pass per stage doc.

### Batch 2 — reviewer (2026-07-31)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 1 MINOR

**Report:** [`.engineering/stage-12/review-batch2.md`](./review-batch2.md)

MINOR-1: `dismissInquiry` action (actions.ts:102–114) swallows all non-auth errors and redirects unconditionally — old code threw on unexpected errors (error boundary); new code silently redirects for 404/500. Consistent with Batch 1 MINOR-1 pattern; acceptable for a plain form action without useActionState. Not a blocker.

All security checks passed: infrastructure files byte-for-byte unchanged ✓ · all 5 route handlers call `getApiSession()` ✓ · RBAC exactly matches spec (inquiries auth-only, external-companies GET auth-only, POST MANAGE_USERS) ✓ · convert route tenant isolation correct (double-guard: session cross-tenant + DAL findFirst on organizationId) ✓ · inquiries layout confirmed NextIntlClientProvider-only (no React.cache() needed) ✓ · requireSession kept only for externalCompanyId in new/* pages, DAL reads switched ✓ · by-page.sql updated ✓

### Batch 3 — developer (2026-07-31)

**Outcome:** DONE. Commit `a3d7477` on `feature/batch3-selections-component-types`.

**Preview URL:** `https://quotation-system-oe134x4w5-vistra-indias-projects.vercel.app`

**Changed (app repo):**
- `app/api/v1/orgs/[orgSlug]/selections/route.ts` (new) — GET `?projectId=` (auth-only) + POST (auth-only).
- `app/api/v1/orgs/[orgSlug]/component-types/route.ts` (new) — GET (auth-only, serves configuration palette) + POST (MANAGE_FEATURES).
- `app/api/v1/orgs/[orgSlug]/component-types/[typeId]/route.ts` (new) — GET (MANAGE_FEATURES) + PATCH (MANAGE_FEATURES).
- `app/api/v1/orgs/[orgSlug]/component-categories/route.ts` (new) — GET (auth-only).
- `app/[orgSlug]/projects/[projectId]/configuration/loading.tsx` (new) — loading skeleton.
- `app/[orgSlug]/projects/[projectId]/configuration/page.tsx` — removed `requireSession`/`getProjectById`/`listSelections`/`listComponentTypes` DAL calls; uses `fetchProjectDetail` (React.cache() dedup with layout) + `internalFetch` for selections and component-types.
- `app/[orgSlug]/projects/[projectId]/configuration/actions.ts` — thin marshaler: FormData → `internalFetch POST /api/v1/.../selections` → 401/403 redirect → non-2xx error return → success redirect.

**Changed (docs repo):**
- `design-docs/sql-queries/by-page.sql` — updated "Project Configuration / Selections" comment; added Stage 12 Batch 3 SQL sections for all 4 new route groups.

**Reused:** `lib/api-auth.ts` (getApiSession, ApiAuthError), `lib/api-error.ts` (all factories), `lib/internal-fetch.ts` (internalFetch), `lib/orgHref.ts`, `lib/data/selections.ts` (listSelections, createSelection — untouched), `lib/data/components.ts` (listComponentTypes, getComponentTypeById, createComponentType, updateComponentType, listComponentCategories — untouched), `lib/rbac.ts` (requirePermission/PERMISSIONS/ForbiddenError), `app/[orgSlug]/projects/[projectId]/_project-fetch.ts` (fetchProjectDetail React.cache() dedup).

**RBAC decision documented in plan-batch3.md:** `GET /component-types` is auth-only (not MANAGE_FEATURES). The configuration page reads component types with auth-only today; making the API endpoint require MANAGE_FEATURES would lock non-admin users out of the project configurator. The stage instructions explicitly say to preserve this distinction. When Batch 6 migrates admin/components pages, those pages will add MANAGE_FEATURES enforcement at the page level (same pattern as today's `requirePermissionFor`).

**React.cache() applied:** configuration page switched to `fetchProjectDetail` (already React.cache()-wrapped from Batch 1) — deduplicates the project fetch between layout and configuration page.

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts).
- `npx tsc --noEmit` → 0 errors.
- Preview `READY` in 50s (`https://quotation-system-oe134x4w5-vistra-indias-projects.vercel.app`).
- `/api/health` → `{ database: "connected" }` ✓.
- All 5 new routes (GET/POST /selections, GET/POST /component-types, GET/PATCH /component-types/[typeId], GET /component-categories) → 401 unauthenticated ✓.
- Bearer token → 401 "Bearer token authentication not yet supported" ✓.
- Cross-tenant guard: uses same `getApiSession()` infrastructure verified in Batch 1 ✓ (identical code path).
- Full functional verification (configuration page loads, palette visible, add selection works) requires authenticated session — to be covered by end-of-stage tester pass per stage doc.

### Batch 3 — reviewer (2026-07-31)

**Verdict:** APPROVE · 0 CRITICAL · 0 IMPORTANT · 0 MINOR

**Findings in reviewer final response** (no separate report file).

All security checks passed: infrastructure files byte-for-byte identical to Batch 1 (MD5 confirmed) ✓ · RBAC judgment call verified against actual pre-batch-3 source (configuration/page.tsx used requireSession-only + listComponentTypes; admin/components/page.tsx enforces MANAGE_FEATURES at page level with requirePermissionFor — both confirmed by git show 149c4e6) ✓ · GET /component-types auth-only is correct behavior preservation, no privilege escalation ✓ · admin/components/page.tsx still uses DAL directly with MANAGE_FEATURES gate intact (unmigrated) ✓ · listSelections() verifies projectId belongs to session's org before returning rows (returns [] rather than leaking existence, consistent with pre-existing DAL behavior) ✓ · all four DAL functions scope every query to session.organizationId ✓ · createSelection/createComponentType/updateComponentType each verify FK inputs belong to the session's org ✓ · fetchProjectDetail React.cache() dedup correctly reused from _project-fetch.ts ✓ · by-page.sql updated in docs repo (commit 2a6f5ef) ✓ · pattern consistency with Batches 1-2 throughout ✓

### Batch 4 — developer (2026-07-31)

**Outcome:** DONE. Commit `0976894` on `feature/batch4-catalog-pricing`.

**Preview URL:** `https://quotation-system-r2lpddvvm-vistra-indias-projects.vercel.app`

**Changed (app repo):**
- `app/api/v1/orgs/[orgSlug]/catalog/route.ts` (new) — GET list, MANAGE_PRICING gate.
- `app/api/v1/orgs/[orgSlug]/catalog/[itemId]/route.ts` (new) — GET detail, MANAGE_PRICING gate.
- `app/api/v1/orgs/[orgSlug]/catalog/[itemId]/prices/route.ts` (new) — POST upsert + DELETE (body: `{ priceId }`), both MANAGE_PRICING.
- `app/[orgSlug]/pricing/loading.tsx` (new) — pulse skeleton.
- `app/[orgSlug]/pricing/[itemId]/loading.tsx` (new) — pulse skeleton.
- `app/[orgSlug]/pricing/page.tsx` — removed `requireSession`/`requirePermissionFor`/`listCatalogItems` DAL; replaced with `internalFetch GET /catalog`; redirect 401/403 to login.
- `app/[orgSlug]/pricing/[itemId]/page.tsx` — removed DAL calls; replaced with `internalFetch GET /catalog/[itemId]`; 401/403 redirect to login; 404 → `notFound()`; deleteItemPrice closure updated to pass `item.id`.
- `app/[orgSlug]/pricing/actions.ts` — both actions converted to thin marshalers via `internalFetch`; `deleteItemPrice` signature extended to `(itemPriceId, itemId, orgSlug)` to enable building the DELETE URL.

**Changed (docs repo):**
- `design-docs/sql-queries/by-page.sql` — added Stage 12 Batch 4 sections for all three new route groups (commit `0e24577` on `main`).

**Reused:** `lib/api-auth.ts` (getApiSession, ApiAuthError — frozen), `lib/api-error.ts` (all factories — frozen), `lib/internal-fetch.ts` (internalFetch — frozen), `lib/orgHref.ts`, `lib/data/catalog.ts` (listCatalogItems, getCatalogItemById, upsertItemPrice, deleteItemPrice — DAL untouched), `lib/rbac.ts` (requirePermission/PERMISSIONS.MANAGE_PRICING/ForbiddenError).

**RBAC:** MANAGE_PRICING on all verbs (GET list, GET detail, POST upsert, DELETE) as specified in stage-12.md table for `catalog/**`. No auth-only gap left.

**Signature deviation (minor, documented in plan-batch4.md):** `deleteItemPrice` action now takes `(itemPriceId, itemId, orgSlug)` — `itemId` added to build the `catalog/[itemId]/prices` URL. The closure in the page passes `item.id`.

**React.cache():** Not needed — no layout+page duplicate-fetch pattern in pricing routes (no `pricing/layout.tsx`).

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts).
- `npx tsc --noEmit` → 0 errors.
- Preview `READY` in ~60s.
- `/api/health` → `{ database: "connected" }` ✓
- `GET /api/v1/orgs/vistra/catalog` (unauthenticated) → 401 `{"error":"Not authenticated"}` ✓
- `GET /api/v1/orgs/vistra/catalog/[id]` (unauthenticated) → 401 ✓
- `POST /api/v1/orgs/vistra/catalog/[id]/prices` (unauthenticated) → 401 ✓
- `DELETE /api/v1/orgs/vistra/catalog/[id]/prices` (unauthenticated) → 401 ✓
- `GET /api/v1/orgs/vistra/catalog` with `Authorization: Bearer xxx` → 401 "Bearer token authentication not yet supported" ✓
- `/vistra/pricing` (no auth) → streams `loading.tsx` skeleton + RSC payload contains `NEXT_REDIRECT;replace;/vistra/login;307;` ✓ (same behavior as all other migrated pages)
- Full functional verification (MANAGE_PRICING user: list loads, item detail loads, upsert/delete prices works, cross-tenant 403) requires authenticated session — covered by end-of-stage tester pass per stage doc.

### Batch 4 — reviewer (2026-07-31)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 3 MINOR

**Findings returned in reviewer final response** (no separate report file).

### Batch 5 — developer (2026-07-31)

**Outcome:** DONE. Commit `8857ea3` on `feature/batch5-admin-users`.

**Preview URL:** `https://quotation-system-1uej6fhi2-vistra-indias-projects.vercel.app`

**Changed (app repo):**
- `app/api/v1/orgs/[orgSlug]/users/route.ts` (new) — GET list + POST create, both MANAGE_USERS. Username-taken → 409, FK violations → 400.
- `app/api/v1/orgs/[orgSlug]/users/[userId]/route.ts` (new) — GET detail, MANAGE_USERS. Returns `{ user, isSelf }` — isSelf computed in route so page needs no session call.
- `app/api/v1/orgs/[orgSlug]/users/[userId]/activate/route.ts` (new) — POST, MANAGE_USERS.
- `app/api/v1/orgs/[orgSlug]/users/[userId]/deactivate/route.ts` (new) — POST, MANAGE_USERS. Self-deactivation guard: DAL throws "cannot deactivate your own account" → handler catches → `apiBadRequest()` (400), not 500.
- `app/api/v1/orgs/[orgSlug]/users/[userId]/password/route.ts` (new) — POST, MANAGE_USERS.
- `app/api/v1/orgs/[orgSlug]/users/[userId]/role/route.ts` (new) — PATCH, MANAGE_USERS.
- `app/api/v1/orgs/[orgSlug]/roles/route.ts` (new) — GET only, MANAGE_USERS. POST (create role) deliberately NOT implemented — Batch 6 scope.
- `app/[orgSlug]/admin/users/loading.tsx` (new) — pulse skeleton.
- `app/[orgSlug]/admin/users/[userId]/loading.tsx` (new) — pulse skeleton.
- `app/[orgSlug]/admin/users/page.tsx` — removed requireSession/requirePermissionFor/listUsers; uses internalFetch GET /users.
- `app/[orgSlug]/admin/users/[userId]/page.tsx` — removed requireSession/requirePermissionFor/getUserById/listRolesForDropdown; uses parallel internalFetch for user detail + roles; isSelf comes from API response.
- `app/[orgSlug]/admin/users/new/page.tsx` — removed requireSession/requirePermissionFor/listRolesForDropdown/listExternalCompanies; uses parallel internalFetch GET /roles + GET /external-companies.
- `app/[orgSlug]/admin/users/actions.ts` — all 5 actions converted to thin marshalers; requireSession/requirePermission removed; createUser keeps useActionState signature.

**Changed (docs repo):**
- `design-docs/sql-queries/by-page.sql` — added Stage 12 Batch 5 SQL sections for all 7 new route groups (commit `38b6f70` on `main`).

**Reused:** `lib/api-auth.ts` (getApiSession, ApiAuthError — frozen), `lib/api-error.ts` (all factories — frozen), `lib/internal-fetch.ts` (internalFetch — frozen), `lib/orgHref.ts`, `lib/data/users.ts` (all functions — DAL untouched), `lib/data/admin.ts` (listRolesForDropdown — roles GET route), `lib/rbac.ts` (requirePermission/PERMISSIONS.MANAGE_USERS/ForbiddenError), `app/api/v1/orgs/[orgSlug]/external-companies/route.ts` (Batch 2, consumed by new/page.tsx for the dropdown).

**Self-deactivation guard:** Confirmed `lib/data/users.ts:deactivateUser` (line 138) throws `Error("You cannot deactivate your own account")` when `userId === session.userId`. The deactivate route handler catches this specific message and returns `apiBadRequest()` (400). Verified in plan-batch5.md.

**React.cache():** Not needed — no layout+page duplicate-fetch pattern for admin/users (admin layout doesn't fetch user-specific data).

**isSelf pattern:** GET /users/[userId] response includes `isSelf: boolean` computed from `session.userId === userId`. User detail page reads it from the response — no separate getSession() call needed in the page.

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts).
- `npx tsc --noEmit` → 0 errors.
- Preview `READY` in ~50s (`https://quotation-system-1uej6fhi2-vistra-indias-projects.vercel.app`).
- Build log confirms all 7 new routes: `/api/v1/orgs/[orgSlug]/users`, `/api/v1/orgs/[orgSlug]/users/[userId]`, `/api/v1/orgs/[orgSlug]/users/[userId]/activate`, `/api/v1/orgs/[orgSlug]/users/[userId]/deactivate`, `/api/v1/orgs/[orgSlug]/users/[userId]/password`, `/api/v1/orgs/[orgSlug]/users/[userId]/role`, `/api/v1/orgs/[orgSlug]/roles`.
- `/api/health` → `{ database: "connected" }` ✓
- `GET /api/v1/orgs/vistra/users` (unauthenticated) → 401 `{"error":"Not authenticated"}` ✓
- `GET /api/v1/orgs/vistra/roles` (unauthenticated) → 401 `{"error":"Not authenticated"}` ✓
- All 8 endpoints (GET/POST /users, GET /users/[id], POST activate/deactivate/password, PATCH role) → 401 unauthenticated ✓
- Bearer token → 401 "Bearer token authentication not yet supported" ✓
- Cross-tenant guard: uses same `getApiSession()` infrastructure verified in Batch 1 ✓ (identical code path).
- Full functional verification (MANAGE_USERS session: list/create/detail/activate/deactivate/role-change/password-set, self-deactivation 400, cross-tenant 403) requires authenticated session — to be covered by end-of-stage tester pass per stage doc.

### Batch 5 — reviewer (2026-07-31)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 3 MINOR

**Report:** [`.engineering/stage-12/review-batch5.md`](./review-batch5.md)

All priority checks passed: self-deactivation guard verified correct (DAL throws before DB write, route catches exact substring, no path to 200) · RBAC on all 7 routes confirmed MANAGE_USERS, roles GET-only (no POST) · tenant isolation confirmed at every DAL write path (assertUserInOrg before every mutation) · password hashed via better-auth Scrypt, not in User model, not echoed · isSelf server-computed from session · infrastructure files unchanged.

Minors: MINOR-1 role route returns 400 (not 404) for user-not-found (inconsistent with activate/deactivate — no functional impact on current UI). MINOR-2 getUserById returns full User row without explicit select (over-returns non-sensitive fields; pre-existing DAL shape; no password hash). MINOR-3 POST /users response returns username not id (no current caller needs it; leave until external consumer work).

### Batch 6 — developer (2026-07-31)

**Outcome:** DONE. Commit `652bc8a` on `feature/batch6-admin-capstone`.

**Preview URL:** `https://quotation-system-jbun4ltbc-vistra-indias-projects.vercel.app`

**Changed (app repo, 40 files):**

New API routes (6):
- `app/api/v1/orgs/route.ts` — GET, public, org selector list
- `app/api/v1/orgs/[orgSlug]/me/route.ts` — GET, auth-only, rich session response (org name, role name, all permission codes, adminPermissions subset, externalCompanyId)
- `app/api/v1/orgs/[orgSlug]/roles/[roleId]/route.ts` — GET, MANAGE_FEATURES
- `app/api/v1/orgs/[orgSlug]/roles/[roleId]/permissions/route.ts` — GET/POST/DELETE, MANAGE_FEATURES
- `app/api/v1/permissions/route.ts` — GET/POST, global (no orgSlug), auth via auth.api.getSession() directly (D1: no orgSlug for getApiSession)
- `app/api/v1/orgs/[orgSlug]/roles/route.ts` — POST added (MANAGE_FEATURES create-role); GET updated to MANAGE_USERS-or-MANAGE_FEATURES + full listRoles (D3)

New files (5):
- `lib/types/field-entry.ts` — FieldEntry type extracted from lib/data/components (D4)
- `app/[orgSlug]/admin/roles/loading.tsx`, `permissions/loading.tsx`, `components/loading.tsx`, `external-companies/loading.tsx` — pulse skeletons

Migrated to internalFetch (removed requireSession/requirePermissionFor/DAL):
- `admin/roles/*` (page, new/page, [roleId]/page, actions) — thin marshalers
- `admin/permissions/*` (page, new/page, actions)
- `admin/components/*` (page, new/page, [typeId]/page, actions) — FieldEntry import updated to lib/types/
- `admin/external-companies/*` (page, new/page, actions)
- `app/[orgSlug]/layout.tsx` — /me for shell chrome (name, username, adminPermissions)
- `app/[orgSlug]/admin/layout.tsx` — /me for admin gate + nav links
- `app/[orgSlug]/dashboard/page.tsx` — /me for org name, role name, permissionCodes (D2)
- `app/[orgSlug]/orders/page.tsx` — /me for auth gate only
- `app/[orgSlug]/projects/new/page.tsx` — /me replaces requireSession; externalCompanyId from /me (D7)
- `app/[orgSlug]/inquiries/new/page.tsx` — same pattern as projects/new (D7)
- `app/[orgSlug]/login/page.tsx` — internalFetch /api/v1/orgs replaces getOrgBySlug/getOrgById (D6)
- `app/page.tsx` — internalFetch /api/v1/orgs replaces listOrganizationsForSelector
- `app/[orgSlug]/projects/[projectId]/design/page.tsx` — eslint-disable (deferred per D5)
- `app/[orgSlug]/projects/[projectId]/design/add-wall/page.tsx` — eslint-disable (deferred)
- `app/[orgSlug]/projects/[projectId]/design/add-wall/actions.ts` — eslint-disable (deferred)

Other:
- `lib/data/components.ts` — re-export FieldEntry from lib/types/ (D4)
- `eslint.config.mjs` — lib/data/* ban for app/[orgSlug]/** (new rule)
- **`lib/data/session.ts`: NOT deleted** — 3 deferred design files still import requireSession (D5 confirmed)

**Changed (docs repo):** `design-docs/sql-queries/by-page.sql` — Batch 6 SQL sections (commit `346967d` on main)

**Reused:** `lib/api-auth.ts` (getApiSession, ApiAuthError — frozen), `lib/api-error.ts` (all factories — frozen), `lib/internal-fetch.ts` (internalFetch — frozen), `lib/orgHref.ts`, `lib/data/admin.ts` (getOrgById, getSessionRole, getSessionRolePermissions, listRoles, createRole, getRoleById, listRolePermissions, addRolePermission, removeRolePermission, listPermissions, createPermission, listOrganizationsForSelector), `lib/data/components.ts` (all fns — untouched), `lib/data/external-companies.ts` (untouched), `lib/rbac.ts` (requirePermission/PERMISSIONS/ForbiddenError), `lib/auth.ts` (auth.api.getSession — for /api/v1/permissions D1), `Batch 3` component-types/component-categories routes, `Batch 5` roles route.

**Deviations taken (all per plan-batch6.md):**
- D1: /api/v1/permissions uses auth.api.getSession() directly (no orgSlug for getApiSession); does NOT modify lib/api-auth.ts
- D2: /me returns extended fields (orgName, roleName, permissionCodes, externalCompanyId) beyond spec minimum
- D3: GET /roles gate broadened to MANAGE_USERS OR MANAGE_FEATURES; data upgraded to full listRoles
- D4: FieldEntry extracted to lib/types/field-entry.ts to avoid ban rule violation
- D5: lib/data/session.ts NOT deleted; deferred design files use eslint-disable
- D6: login/page.tsx migrated to public /api/v1/orgs (org lookup by slug + id)
- D7: orders/projects/new/inquiries/new migrated from requireSession to /me

**me/route.ts fix:** Initial implementation used prisma directly (banned by existing ESLint rule). Fixed before commit: refactored to use getOrgById/getSessionRole/getSessionRolePermissions from lib/data/admin.

**ESLint ban rule:** Scoped to `app/\[orgSlug\]/**` via escaped-bracket glob. Confirmed working: lint passes 0 errors; deferred files' eslint-disable comments suppress the 3 remaining violations.

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts) ✓
- `npx tsc --noEmit` → 0 errors ✓
- Preview READY in 50s (`https://quotation-system-jbun4ltbc-vistra-indias-projects.vercel.app`)
- `/api/health` → `{ database: "connected" }` ✓
- `GET /api/v1/orgs` (unauthenticated) → 200 with real orgs list ✓ (public endpoint confirmed)
- `GET /api/v1/orgs/vistra/me` (unauthenticated) → 401 `{"error":"Not authenticated"}` ✓
- `GET /api/v1/permissions` (unauthenticated) → 401 `{"error":"Not authenticated"}` ✓
- `GET /api/v1/orgs/vistra/roles/fake-id` (unauthenticated) → 401 ✓
- `GET /api/v1/orgs/vistra/roles/fake-id/permissions` (unauthenticated) → 401 ✓
- Bearer token on /me → `{"error":"Bearer token authentication not yet supported"}` ✓
- Bearer token on /permissions → `{"error":"Bearer token authentication not yet supported"}` ✓
- Full functional verification (authenticated session: shell renders, dashboard shows org/role/permissions, admin CRUD) to be covered by end-of-stage tester pass per stage doc.

### Batch 6 — reviewer (2026-07-31)

**Verdict:** CHANGES-NEEDED · 0 CRITICAL · 1 IMPORTANT · 2 MINOR

**Report:** `.engineering/stage-12/review-batch6.md` (findings returned in reviewer final response)

IMPORTANT-1: `GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions` (route.ts line 66) calls `listRolePermissions(roleId)` without verifying the role belongs to the session's org. `getApiSession()` confirms the user is in `orgSlug`'s org, but does not check whether `roleId` is in that org. A user with MANAGE_FEATURES in org A could call this endpoint with a UUID from org B's role and read org B's role-permission assignments. POST and DELETE on the same route ARE safe — `addRolePermission`/`removeRolePermission` call `assertRoleInOrg` in the DAL. Fix: add `const role = await getRoleById(session, roleId); if (!role) return apiNotFound("Role not found");` before the `listRolePermissions` call.

MINOR-1: ESLint ban rule (`eslint.config.mjs`) catches `@/lib/data/*` alias imports only — a relative import `../../lib/data/admin` would not be flagged. No current violations (the codebase universally uses the alias), so not a functional gap today. Fix: add a second pattern matching `**/lib/data/**` to catch relative paths, or accept the limitation given the alias convention.

MINOR-2: `app/[orgSlug]/admin/layout.tsx` line 40 handles only 401 (→ login redirect) and 403 (→ dashboard redirect). If `/me` returns 404 or 5xx, execution falls through to `(await meRes.json()) as { adminPermissions: string[] }`, leaving `me.adminPermissions === undefined` and throwing a TypeError on `.length`. Unreachable in production (proxy returns 404 before Next.js for unknown slugs), but inconsistent with the outer layout which uses `!meRes.ok` for full defensive coverage. Fix: add `if (!meRes.ok) redirect(await orgHref(orgSlug, "/login"));` after the 403 check (or reuse the `!meRes.ok` pattern).

All other priority checks passed: `lib/api-auth.ts` byte-for-byte unchanged (frozen contract held) ✓ · `/api/v1/permissions` auth: checks Bearer seam, checks active flag (`!u.active`), checks MANAGE_FEATURES from session's own org ✓ · `/me` route uses lib/data/admin DAL (no direct Prisma) ✓ · adminPermissions filter is server-side (never client-gated) ✓ · login-passthrough behavior preserved in outer layout (all `!meRes.ok` → render children) ✓ · admin nav links driven by server-side adminPermissions subset (MANAGE_USERS/MANAGE_FEATURES) — strings match PERMISSIONS constants ✓ · POST `/roles` MANAGE_FEATURES gated ✓ · GET `/roles/[roleId]` org-scoped via `getRoleById(session, roleId)` ✓ · POST/DELETE `/roles/[roleId]/permissions` org-scoped via `assertRoleInOrg` in DAL ✓ · 3 deferred design files have correct eslint-disable comments, no new exemptions in Batch 6 code ✓ · `lib/data/session.ts` correctly retained (3 deferred files still import it, ban rule would catch any new import) ✓ · `npm run lint` 0 errors (1 pre-existing warning) ✓ · `npx tsc --noEmit` 0 errors ✓

### Batch 6 — reviewer follow-up: fix verification (2026-07-31)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 2 MINOR (pre-existing, developer's discretion)

**Report:** `.engineering/stage-12/review-batch6.md` ("Follow-up: Fix Verification" section)

IMPORTANT-1 resolved: commit `de5447a` adds `const role = await getRoleById(session, roleId); if (!role) return apiNotFound("Role not found");` before `listRolePermissions` in the GET handler. `getRoleById` confirmed to scope by `session.organizationId` (lib/data/admin.ts lines 113–117). Guard is unconditional — no code path reaches `listRolePermissions` without passing it. POST/DELETE verbs unaffected. Response shape unchanged. `npm run lint` 0 errors · `npx tsc --noEmit` 0 errors. Batch 6 is clear to merge.

### Batch 7g — developer (2026-07-31)

**Outcome:** BLOCKED — schema fields required by the stage doc are missing from `prisma/schema.prisma`.

**Schema audit result:**
- `firstName` — NOT in schema (only a single `name` field exists, currently set to `username`)
- `lastName` — NOT in schema
- `mobile` — NOT in schema
- `profileEmail String?` — EXISTS (maps to the optional "Email" field)

The stage doc requires First Name and Last Name as **mandatory** create-user form fields, and Mobile as **optional**. All three map to columns that don't exist on the `User` model. Proceeding would require a `prisma migrate dev` against the Neon dev DB — an irreversible, higher-risk operation that also forces a design decision about the existing `name` field (a better-auth core field currently set to `username`).

**Per briefing instructions:** "If the schema is missing required fields (firstName/lastName/mobile), STOP and report BLOCKED — do not write a migration without explicit sign-off."

**No code changes made.** Worktree is clean at the starting commit.

**What CAN be done without schema changes (for reference):** password min-8 validation, delete-with-confirm row action (new route + action + DAL needed), detail page showing `profileEmail`. These are partial and wouldn't satisfy the full scope — not implemented, awaiting human decision.

**Plan:** `.engineering/stage-12/plan-batch7g.md` — full schema audit, options (add nullable fields / repurpose `name` / defer), and file change list for when unblocked.

### Batch 7g — developer (2026-07-31) — RESUMED after human decision

**Outcome:** DONE. Commit `597b35c` on `feature/batch7g-user-management`.

**Schema decision confirmed by human:** `firstName String`, `lastName String` (NOT NULL) + `mobile String?` added to User model. Migration ran against dev branch `ep-dark-term-ai0ufj4k` (confirmed, not production `ep-little-paper-aipm0o0i`).

**DB operations (dev DB only):** Cleanup script deleted all user-dependent rows (28 users, 69 projects, 67 inquiries, 17 selections, 4 floors, 4 partitions) in FK-safe order → `prisma migrate dev --name add_user_firstname_lastname_mobile` → `prisma db seed` (16 users re-created with firstName/lastName).

**Preview URL:** `https://quotation-system-5f0w1s4dp-vistra-indias-projects.vercel.app`

**Changed (app repo):**
- `prisma/schema.prisma` — `firstName String`, `lastName String`, `mobile String?` added to User model
- `prisma/migrations/20260731110524_add_user_firstname_lastname_mobile/migration.sql` — new migration
- `prisma/seed.ts` — firstName/lastName on all 4 user slots; user.create data updated
- `scripts/cleanup-users-dev.ts` — one-time migration prep script (kept for audit)
- `lib/data/users.ts` — `CreateUserInput` extended; `createUser()` writes new fields, sets `name = firstName + ' ' + lastName`; `deleteUser()` added (self-delete guard + FK proactive check)
- `app/api/v1/orgs/[orgSlug]/users/route.ts` — POST parses firstName/lastName/mobile/profileEmail; password min-8 validated server-side
- `app/api/v1/orgs/[orgSlug]/users/[userId]/route.ts` — DELETE handler added (MANAGE_USERS, 204 on success)
- `app/[orgSlug]/admin/users/new/create-user-form.tsx` — firstName/lastName (required), mobile/email (optional), password minLength=8 + hint text
- `app/[orgSlug]/admin/users/actions.ts` — createUser parses new fields + client-side password length check; deleteUser action added
- `app/[orgSlug]/admin/users/delete-user-button.tsx` — new Client Component with window.confirm() + useTransition pattern
- `app/[orgSlug]/admin/users/page.tsx` — Full Name column; Delete row action
- `app/[orgSlug]/admin/users/[userId]/page.tsx` — firstName, lastName, mobile, profileEmail in metadata block
- `messages/en.json` — colFullName, fieldFirstName/LastName/Mobile/Email, fieldPasswordHint, deleteAction, deleteConfirm, detailMobile/Email

**Changed (docs repo, commit `bb7aece` on `main`):**
- `design-docs/sql-queries/by-page.sql` — createUser INSERT updated for new fields; deleteUser FK pre-check and DELETE queries added

**Verify:**
- `npm run lint` → 0 errors (1 pre-existing warning in org-nav.spec.ts) ✓
- `npx tsc --noEmit` → 0 errors ✓
- Preview READY at `https://quotation-system-5f0w1s4dp-vistra-indias-projects.vercel.app`
- `/api/health` → `{ database: "connected" }` ✓
- `DELETE /api/v1/orgs/vistra/users/fake-id` (unauthenticated) → 401 ✓ (route deployed)
- `POST /api/v1/orgs/vistra/users` (unauthenticated) → 401 ✓ (route deployed)
- Full functional verification (authenticated MANAGE_USERS session: create form shows new fields, password min-8 enforced client+server, list shows Full Name column + Delete button with confirm, detail shows richer fields) — to be covered by end-of-stage tester pass.
