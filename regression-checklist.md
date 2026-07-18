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
