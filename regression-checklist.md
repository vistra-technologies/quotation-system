# Regression checklist

Standing set of conditions verified across past stages. Grows by one condition per stage (owned by
`engineering:test` on each clean PASS). Bootstrapped 2026-07-12 from Stage 1 + Stage 2 test reports, since no
checklist existed yet.

## Stage 1 — Infra scaffold
1. `GET /api/health` → 200, body includes `database: "connected"`.

## Stage 2 — Actors & Authentication
2. `GET /api/auth/ok` → 200 `{"ok":true}`.
3. Sign-in with a seeded user's synthetic email (`{username}@{orgSlug}.internal`) + correct password →
   200, session cookie set.
4. Sign-in with wrong password → 401 `INVALID_EMAIL_OR_PASSWORD`.
5. `POST /api/auth/sign-up/email` (public self-signup) → 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` — signup is
   server-provisioned only.
6. RBAC: each of the 4 roles (Admin, Company Member, Distributor, Architectural Firm) shows exactly its
   matrix-defined permission set on `/{orgSlug}/dashboard`, no more/fewer.
7. Tenancy isolation: a session cookie obtained from one org's login must NOT authenticate against a
   different org's path (cross-org cookie replay against `/{orgSlug2}/dashboard` → redirect to
   `/{orgSlug2}/login`).
8. Apex host strips any client-supplied `x-org-id`/`x-org-slug` headers before the session check (defends
   the apex from spoofed-header session hijack).
9. Path-based routing: apex (`/`) → 200 org selector; known org path (`/{orgSlug}/login`) → 200 login
   page; unknown slug (`/nonexistent/login`) → 404 JSON `{"error":"Organization not found"}`.
10. Instant deactivation: flipping a user's `active` to `false` invalidates their existing session on the
    very next request (redirect to `/{orgSlug}/login`), no wait for expiry.
11. Unauthenticated request to `/{orgSlug}/dashboard` → redirect to `/{orgSlug}/login`.

## Real-browser UI flow
12. From the apex org selector page, clicking an organization link lands the browser on **that org's own
    login page on the same deployed origin** (not `localhost`, regardless of what environment is under
    test) — exercised via the Playwright harness (`npm run test:e2e`, `playwright.config.ts` /
    `tests/e2e/`), not curl. Full flow: apex → click org → login page loads on-origin → sign in with seeded
    creds (`admin` / `Seed1234!`) → dashboard renders with correct username/org/role → sign out →
    redirect to `/{orgSlug}/login`. Note: requires `BETTER_AUTH_URL` to be configured for the target
    environment (see Stage 2 bug report); currently verified only via curl (items 1–11 above).

## Stage 3 — Catalog & Pricing Foundation
Automated: `tests/e2e/pricing-stage3.spec.ts` (serial mode, 90 s timeout per test).

13. **MANAGE_PRICING gating — distributor:** `distributor` role navigating to `/{orgSlug}/pricing` is
    server-redirected to `/{orgSlug}/dashboard`; the Pricing Management heading is never rendered.
14. **MANAGE_PRICING gating — architect:** same as item 13 for the `architect` role.
15. **MANAGE_PRICING gating — item edit page:** unauthorized direct navigation to
    `/{orgSlug}/pricing/{itemId}` (any role without MANAGE_PRICING) is redirected to
    `/{orgSlug}/dashboard` before the item is looked up.
16. **Pricing CRUD round-trip (company member):** a `member` (MANAGE_PRICING) can (a) add a new
    `ItemPrice` for a catalog item via the form, (b) update it by submitting the same currency again
    with a different amount (upsert), and (c) delete it; all three changes persist and reflect in the UI.
17. **Seed data integrity:** after `npx prisma db seed`, the DB must have exactly 48 `CatalogItem` rows
    and 96 `ItemPrice` rows (12 items × 4 orgs; 2 currencies × 12 items × 4 orgs). Each org must have
    exactly its own 12 items and 24 prices — no cross-org sharing.
18. **Pricing tenancy isolation:** a session from one org cannot view or mutate another org's catalog
    prices. A cross-org cookie replay on `/{orgSlug2}/pricing` → redirect to `/{orgSlug2}/login`.
19. **next-intl strings:** all Stage 3 user-facing strings in the pricing pages render from the English
    locale dictionary (no hardcoded display text visible in the pricing components, excepting decorative
    UI characters like arrow symbols).
20. **Stage 2 regression after Stage 3 migration:** per-org login, cross-org session rejection,
    role-correct dashboard, and `/api/health` all still pass after the Stage 3 migration is applied.
    (Items 1, 3, 7, 11 verified; item 10 manual only — deactivation test requires a DB write.)

## Stage 4 — Admin section (users, roles, permissions)
21. **MANAGE_USERS gating:** a role without MANAGE_USERS navigating to `/{orgSlug}/admin/users` → redirect to dashboard.
22. **MANAGE_FEATURES gating:** a role without MANAGE_FEATURES navigating to `/{orgSlug}/admin/roles` → redirect to dashboard.
23. **Cross-org user list isolation:** org A's admin cannot see org B's users by any URL manipulation.
24. **Create-user + login round-trip:** admin creates a user with username/role/password → new user can log in immediately.
25. **Password-reset round-trip:** admin sets a new password for a user → old password stops working; new password works.
26. **Activate/deactivate instant block:** deactivating a currently-logged-in user invalidates their session on the very next request.
27. **Inert-permission caveat:** the permissions page shows a prominent warning that adding a Permission row grants no capability until a developer wires it in code.
28. **Loading overlay lifecycle:** form submission in admin user actions shows a loading state that clears on completion.
29. **Authenticated-user login-page handling:** a logged-in user visiting their own org's `/login` is redirected to `/dashboard`; visiting another org's `/login` sees a notice rather than being auto-redirected.

## Stage 5 — DAL + ComponentType + Project
30. **DAL lint rule:** a file under `app/` importing `@/lib/prisma` directly fails `npm run lint`.
31. **ComponentType tenancy:** org A's session cannot read org B's ComponentTypes.
32. **ComponentType RBAC:** a role without MANAGE_FEATURES receives a 403/redirect on all `/admin/components` routes and actions.
33. **ComponentType field schema round-trip:** add a field, save, reload — field still present in the editor.
34. **Inert-caveat visible:** every ComponentType and field (there is no core/non-core distinction) shows the inert-until-wired notice in the admin UI, exactly once per page.
35. **Project tenancy:** org A's session cannot read org B's Projects.
36. **Project `projectNumber` per-org:** org A and org B can each have a project #1 without conflict.
37. **Stage 2/3/4 regression after DAL refactor:** per-org login, cross-org session rejection, pricing CRUD, instant deactivation, and admin user/role/permission flows all still pass.
38. **Cross-tenant ExternalCompany guard:** a crafted `createProject` form submission containing another org's `externalCompanyId` UUID is rejected by the DAL (`lib/data/projects.ts` org-scoped `findFirst` guard) with `INVALID_EXTERNAL_COMPANY`, surfaced as "Selected company is invalid." on the form — no cross-tenant FK is created. Verified E2E: stage5.spec.ts test 12.

## Stage 6 — Selection, ComponentType overhaul, External Company UI
Automated: `tests/e2e/stage6.spec.ts` (19 tests, serial mode).

39. **External Company CRUD + RBAC + tenancy:** create via UI round-trips into both the list and the user-create dropdown; a role without `MANAGE_USERS` is refused; org A cannot see org B's external companies.
40. **ComponentType overhaul round-trip:** `category` persists; all 4 field types (`field`/`radio`/`dropdown`/`checkbox`) with options/hint/required save and reload intact across Basic/Advanced sections; move-up/down reordering persists; a role without `MANAGE_FEATURES` is refused.
41. **ComponentType malformed-options guard:** saving a `radio`/`dropdown` field with empty `options` throws a visible validation error instead of silently dropping the field (regression guard for the Area 2 CHANGES-NEEDED bug fixed during Stage 6 implement).
42. **Selection round-trip:** adding a Selection to a project renders the dynamic form correctly for the picked ComponentType (required validation, radio/dropdown options, checkbox, hint text), and the saved `config` reflects what was entered and appears in the project's selection list; org A cannot view or attach selections on org B's projects.
43. **Client i18n namespace coverage:** every namespace a client component calls `useTranslations()` on is actually forwarded in its route layout's `clientMessages` (regression guard for the Stage 6 test-phase MAJOR bug — `projects/layout.tsx` omitted `selections`, silently breaking the Selection form's hydration with no server-side signal).

## Stage 6 amendment (2026-07-18) — `core` removed, `category` becomes a real FK
44. **No `core` distinction:** ComponentType create/edit forms have no "Core" checkbox on any field and no core/inert badge on the list page; GLASS/DOOR/PROFILE_STOP are fully admin-editable like any other type.
45. **Category dropdown, not free text:** the category field on create/edit is a `<select>` sourced from `ComponentCategory`; selecting a category and saving round-trips correctly across reload; a `categoryId` belonging to another org is rejected by the DAL tenancy guard (`assertCategoryInOrg`).

## Stage 10 — EaseeTool: Brand, Design & Domain
Manual (verified against `test.easeetool.com` after each staging deploy — Playwright cannot spoof
`Host` headers against ad-hoc `*.vercel.app` preview URLs due to Vercel's edge firewall).

46. **Test-env apex routing:** `https://test.easeetool.com/` → 200, org-selector page (same as
    `app/page.tsx` — heading "EaseeTool", org list). Must NOT return `{"error":"Organization not found"}`.
47. **Test-env org subdomain routing:** `https://vistra.test.easeetool.com/vistra/login` (or `/` with
    subdomain rewrite) resolves `vistra` org correctly — 200 login page. Must NOT 404.
48. **Test-env unknown-org subdomain still 404s:** `https://nope.test.easeetool.com/` → 404 JSON
    `{"error":"Organization not found"}` — unknown slug must NOT silently pass through.
49. **Production apex routing unchanged:** `https://easeetool.com/` → 200, org-selector page.
50. **Production org subdomain routing:** `https://vistra.easeetool.com/` (or equivalent known org)
    resolves correctly → 200 login or dashboard (depending on session state).
51. **Localhost / CI path-based fallback unchanged:** `http://localhost:3000/vistra/login` → 200 login
    page; `http://localhost:3000/nonexistent/login` → 404 JSON. (Automated: existing `org-nav.spec.ts`
    and `smoke.spec.ts` cover these via the path-based fallback that runs on any non-easeetool.com host.)

## Stage 11 — Subdomain URL Hygiene (Part A, Batches 1–3)

Automated: `tests/e2e/subdomain-url-hygiene.spec.ts` (4 tests, serial mode).
Run against the deployment's own `*.vercel.app` hash URL via `PLAYWRIGHT_BASE_URL`
(not the custom domain — `trustedOrigins` is scoped to `VERCEL_URL`).

52. **No doubled org segment after login:** after signing in via `/{orgSlug}/login`, the post-redirect
    URL must be `/{orgSlug}/dashboard` (path-based mode on `*.vercel.app`). Must NOT contain
    `/{orgSlug}/{orgSlug}` (the doubled-slug bug fixed in Stage 11).

53. **Sidebar nav links produce clean URLs:** clicking "Inquiries", "Projects", and the "Home" top-bar
    icon each navigate to `/{orgSlug}/<section>` without a doubled org segment. Admin flyout links
    (`/admin/users`, `/admin/roles`, etc.) must also produce clean URLs (manual check on a subdomain
    host, as the flyout requires CSS hover which is harder to automate).

54. **Logout redirects to clean login URL:** clicking Log Out navigates to `/{orgSlug}/login` without a
    doubled segment. On a subdomain host (`vistra.easeetool.com`), the URL must be `/login`, not
    `/vistra/login`.

55. **Server redirect from unauthenticated access is clean:** an unauthenticated request to
    `/{orgSlug}/dashboard` (path-based) or `vistra.easeetool.com/dashboard` (subdomain) is
    server-redirected to the login page without a doubled org segment.

**Manual check on a subdomain host (e.g., `vistra.test.easeetool.com`) once all batches are merged:**
- After login: URL is `vistra.easeetool.com/dashboard` (NOT `vistra.easeetool.com/vistra/dashboard`).
- After sidebar nav: URL is `vistra.easeetool.com/projects` (NOT `.../vistra/projects`).
- After logout: URL is `vistra.easeetool.com/login` (NOT `.../vistra/login`).
- After unauthenticated access: server redirect lands on `vistra.easeetool.com/login` (NOT `.../vistra/login`).

## Stage 11 — Part B (Batches 4–9, UI restyle)

Manual (no per-batch tester pass — full regression runs once at end-of-stage against `test.easeetool.com`).
All checks: verify via the Vercel preview URL for the merged `release/stage-11` branch.

### Batch 5 — Inquiries cluster

56. **Inquiry list page:** `/{orgSlug}/inquiries` renders Sage Ease card/table with correct status badge
    colors (NEW=orange, DISMISSED=gray, CONVERTED=green), count badge in heading, "New Inquiry" primary
    button, and a "Start Project" button per row (disabled for closed inquiries).
57. **New inquiry form:** `/{orgSlug}/inquiries/new` renders a two-column card (Inquiry Details / Client
    Information panels with sage-green panel titles), Sage Ease field inputs, and Cancel + Create Inquiry
    buttons in the card footer. Cancel returns to the list.
58. **Inquiry detail page:** `/{orgSlug}/inquiries/{id}` renders back link, heading with inquiry number,
    metadata row (country, currency, status badge, client, date, created-by), Dismiss + Start Project
    buttons, and a two-column read-only card. Both buttons remain disabled when the inquiry is closed.
59. **Dismiss behavior:** Dismiss form submits without error for a NEW inquiry, flipping status to
    DISMISSED and redirecting back to the detail page. Button is disabled for DISMISSED/CONVERTED inquiries.
60. **Start Project behavior:** Start Project converts a NEW inquiry to a project, redirects to the new
    project's detail page. Button is disabled for DISMISSED/CONVERTED inquiries. A SEQUENCE_CONFLICT error
    is displayed inline (not a crash). (Also verifiable from the list page row button.)

### Batch 6 — Project wizard interior + New Project form

61. **Summary page chrome:** navigating to a project's Summary step renders the page heading "Summary",
    the card placeholder, and Back / Next: Quotation navigation links. The page must NOT render any
    Floor/Partition data, SVG shop drawings, or cut-list tables (still inert).
62. **Quotation page chrome:** navigating to a project's Quotation step renders the page heading "Quotation",
    the card placeholder, and a Back navigation link. Page must stay inert.
63. **New Project form — Sage Ease styling:** the New Project page renders the page heading, card wrapper,
    and all form fields (Project Name, Destination Country, Currency, Client) with Sage Ease input styling.
    Submitting the form still creates a project and redirects to the project detail page (behavior unchanged).

### Batch 7 — Component Types admin cluster

64. **Component Types list page — Sage Ease restyle:** `/{orgSlug}/admin/components` renders with
    Sage Ease heading, card wrapper, count badge, code chip (monospace), category chip (icon + label),
    fields badge (pill), status pill (green = Active, muted = Inactive), and Edit button. No
    interactive search/filter (not in the original RSC — was a JS-only mockup feature).
65. **Create Component Type page — Sage Ease restyle:** `/{orgSlug}/admin/components/new` renders
    with Sage Ease back link, heading, inert-caveat notice (status-pending amber tokens), form card.
    All form fields (Code, Name, Category, Field Schema) use Sage Ease token classes. Form / JSON
    toggle visually matches the design; field reordering (↑↓) and option builder still function.
66. **Edit Component Type page — Sage Ease restyle:** `/{orgSlug}/admin/components/[id]` renders
    with Sage Ease back link, heading + code monospace subtitle, inert-caveat, form card. Active
    checkbox, JSON view/edit toggle, all field-row controls (move, remove, required) still function.
    Stage 7 field-schema round-trip (item 33) must still pass.

### Batch 8 — Admin: Users + External Companies

67. **Users list page renders correctly:** `/admin/users` loads, shows the users table with username, role,
    and status columns. Active users show a green badge; inactive users show a muted badge.
68. **Create-user form works end-to-end:** `/admin/users/new` renders the form; submitting with valid data
    creates the user and redirects to the list. Submitting a duplicate username shows the inline error
    message without a page crash.
69. **User detail page renders correctly:** `/admin/users/[userId]` shows the metadata card (username, role,
    status) and the three action sections (activate/deactivate, change role, set password). Self-user
    cannot deactivate themselves (button disabled, helper text shown).
70. **Activate/deactivate, change-role, and set-password actions still work:** each form submission triggers
    the correct server action and the page reflects the updated state after redirect.
71. **External Companies list page renders correctly:** `/admin/external-companies` loads, shows the table
    with name and type columns.
72. **Create-external-company form works end-to-end:** `/admin/external-companies/new` renders; submitting
    creates the company and redirects to the list. Duplicate-name error shows inline.

### Batch 9 — Admin: Roles + Permissions + Pricing + apex + 404 pages

73. **Roles cluster renders correctly:** `/admin/roles` list, `/admin/roles/new`, and `/admin/roles/[roleId]`
    (with permission toggle buttons) render with Sage Ease tokens; create-role and permission-toggle actions
    still work end-to-end.
74. **Permissions cluster renders correctly:** `/admin/permissions` list and `/admin/permissions/new` render
    with Sage Ease tokens; create-permission action still works.
75. **Pricing cluster renders correctly:** `/pricing` list and `/pricing/[itemId]` edit page render with
    Sage Ease tokens (no stray `min-h-screen` wrapper); price CRUD still works.
76. **Apex org selector renders correctly:** `/` renders the org-selector cards with Sage Ease tokens;
    clicking an org still navigates to that org's own subdomain login page (local `orgHref()` helper
    unchanged).
77. **404 pages render correctly:** an unknown path at the apex (`/some-bogus-path`) renders the standalone
    `app/not-found.tsx` page (no org shell) with a link back to `/`; an unknown path within a known org
    (`/{orgSlug}/some-bogus-path`) renders `app/[orgSlug]/not-found.tsx` inside the org shell (sidebar
    present). An unknown org slug itself must still return `proxy.ts`'s existing JSON 404 (unchanged,
    out of scope for this batch).

## Stage 12 — UI/API Layer Separation

Automated: `tests/e2e/stage12.spec.ts` (10 tests, serial mode).
Run against the deployment's own `*.vercel.app` hash URL via `PLAYWRIGHT_BASE_URL`.

### API layer architecture

78. **No direct `lib/data/*` imports in `app/**` pages:** `npm run lint` passes with zero errors — the
    ESLint rule in `eslint.config.mjs` enforcing that `lib/data/*` is importable only from `app/api/**`
    catches any violation at lint time (stage 5 item 30, extended by stage 12 capstone).

79. **API tenancy isolation (cross-org 403):** every protected API route under
    `/api/v1/orgs/{orgA}/**` returns `403 {"error":"Access denied"}` when called with a valid
    session from org B. Verified via curl for all key routes: users, inquiries, catalog,
    external-companies, projects, component-types. `getApiSession()` cross-tenant guard is the
    enforcement point.

80. **API RBAC gating:** distributor session (no MANAGE_USERS, no MANAGE_PRICING) is denied
    `GET /api/v1/orgs/{orgSlug}/admin/users` (403) and `GET /api/v1/orgs/{orgSlug}/catalog` (403).
    Distributor IS allowed `GET /api/v1/orgs/{orgSlug}/inquiries` and
    `GET /api/v1/orgs/{orgSlug}/component-types` (no gate on GET).

### Dashboard redesign (Batch 7b)

81. **Dashboard heading is "Welcome, {firstName}":** `/{orgSlug}/dashboard` renders an `<h1>` containing
    "Welcome" (not the literal string "Dashboard"). `firstName` is the first word of the user's
    display name (e.g., "vistra" for the vistra admin, "acme-glass" for the acme-glass admin).
    Automated: `stage12.spec.ts` "Dashboard: heading is 'Welcome, {firstName}'".

82. **Dashboard KPI tiles present:** three tiles (Orders, Projects, Inquiries) are rendered. Orders is
    always 0 (no Order model yet). Projects and Inquiries show real counts from the
    `/api/v1/orgs/{orgSlug}/stats` API. Loading skeleton disappears once data loads.
    Automated: `stage12.spec.ts` "Dashboard: three KPI tiles" and "Dashboard stats API".

83. **Home icon → dashboard link:** the Home icon in `TopBarActions` links to `/{orgSlug}/dashboard`
    (or `/dashboard` on subdomain hosts). Clicking it from any page navigates back to dashboard without
    a doubled org segment. This was a bugfix in Stage 12 Correction 3.
    Automated: `stage12.spec.ts` "Dashboard: Home icon in top-bar links to dashboard".

### Inquiries list redesign (Batch 7c)

84. **Inquiries list column schema:** the table has exactly these columns: "Project Name" (link to
    detail), "Company" (internal users) / "Client Name" (external users), "Location",
    "Status", "Created On", "Submission Date". There is NO `#N` inquiry-number column on the list.
    Automated: `stage12.spec.ts` "Inquiries list: column headers match Batch 7c schema".

85. **Inquiry name is the detail link:** in the inquiries list, the inquiry name in the "Project Name"
    column links to `/{orgSlug}/inquiries/{uuid}`. There are no `#N`-format links anywhere on the
    list page.
    Automated: `stage12.spec.ts` "Inquiries list: each inquiry row has a link to the detail page".

86. **Inquiry number visible on detail page, not list:** `/{orgSlug}/inquiries/{id}` shows the inquiry
    number in the `<h1>` as `#{N} — {name}`. The number is also in the "Inquiry Details" card.
    Automated: `stage12.spec.ts` "Inquiries list: inquiry number (#N) is visible on the detail page".

87. **Inquiries list empty state:** no-filter empty list shows "No inquiries yet. Create your first
    inquiry." Filtered with no matches shows "No inquiries match your filters." Neither shows a table.
    Automated: `stage12.spec.ts` "Inquiries list: empty state shown when search returns no results".

88. **Inquiries list toolbar (My/All + search):** the scope toggle and search input are present on
    `/{orgSlug}/inquiries` regardless of filter state. The `scope=mine` URL param scopes results
    to the current user's inquiries; `search=` filters by name/country.
    Automated: `stage12.spec.ts` "Inquiries list toolbar: My/All toggle and search input".

### Inquiries/new back link (Bug 4 fix)

89. **"Back to Inquiries" link on /inquiries/new:** the create-inquiry page has a functional back link
    (text from i18n key `backToList`, e.g. "← Back to Inquiries") above the form. Clicking it
    navigates to `/{orgSlug}/inquiries`.
    Automated: `stage12.spec.ts` "Inquiries/new: 'Back to Inquiries' link".

### Proxy TTL cache (Batch 8)

90. **Proxy slug cache correctness:** the in-process 60-second TTL cache in `proxy.ts` returns the
    correct org for repeated requests. An org that exists in the cache must NOT serve a different
    org's pages, and a cache miss for a new org must trigger a fresh DB lookup. (Manual/load-test
    verification; no automated spec needed unless cache invalidation logic changes.)

### Stage 11 regression (post-Stage 12)

91. **All Stage 11 Playwright specs pass:** `subdomain-url-hygiene.spec.ts` (4 tests),
    `login.spec.ts` (13 tests), and `stage7.spec.ts` (all tests) pass without modification against
    the Stage 12 build. Stage 12 touched pages that Stage 11 tests cover; no regressions introduced.
