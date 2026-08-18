# Batch G — User Management (U3, U4, U5, U6)

**Developer:** `developer` agent
**Branch:** `feature/stage15-user-management`
**Worktree:** `D:\projects\vistra\.worktrees\stage15-g`
**Final commits (substantive):**
- `4eb511f` — U3 schema + migration + enforcement; U4 profile endpoint; U5 page redesign; U6 seed purge (wip committed by conductor during session break)
- `f92fe57` — migration canonical format fix; item-G.md initial record
- `56d6756` — fix: "External company is required" error not mapped to 400 (caught during E2E test run)
- `d9e3b87` — data migration `20260814000002` to set isInternalRole on built-in roles
- `8431f5f` — test fix: simplify U4 cross-org 404 test (pre-review iteration, superseded)
- `dd08c5a` — data migration `20260814000003` to purge E2E_PERM_* (dropped in review round 1)
- `e8d487d` — **review-G-1**: drop migration 3; rewrite U4 cross-org tenancy test with real cross-org userId

Several `ci:` retrigger commits are empty and exist only to retry P1002 advisory-lock timeouts on the shared Neon dev branch. They carry no code changes.

---

## What changed (by item)

### U3 — External Company required except for Admin / Company Member

**Schema:** `isInternalRole Boolean @default(false)` added to `Role` model in `prisma/schema.prisma`.

**Migrations (two, for one schema change):**
1. `prisma/migrations/20260814000001_add_is_internal_role_to_role/migration.sql` — schema migration: `ALTER TABLE "Role" ADD COLUMN "isInternalRole" BOOLEAN NOT NULL DEFAULT false;`. SQL was verified via `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` to match Prisma's canonical output exactly (including `-- AlterTable` header and canonical spacing).
2. `prisma/migrations/20260814000002_set_builtin_role_internal_flags/migration.sql` — **data migration**: `UPDATE "Role" SET "isInternalRole" = true WHERE "name" IN ('Admin', 'Company Member');`

**Why two migrations?** The Vercel build script is `prisma migrate deploy` (no seed). The schema migration adds the column with `DEFAULT false`. All existing Admin and Company Member roles were left with `isInternalRole = false`. Without the data migration, U3 enforcement would treat Admin as an external role (requiring company), breaking the app. The seed also sets these flags (via `update:` in upsert), but the seed is NOT part of the Vercel build pipeline. The data migration is the correct production mechanism for one-time initialization alongside a schema change.

**Do seed and migration conflict?** No. Both set `isInternalRole = true` for the same two role names. They converge. If the migration runs first (always, in Vercel builds), the seed's upsert is a no-op for those fields. If the seed somehow ran first (e.g., local dev), the migration runs next and writes the same values. Order is irrelevant.

**Is "no backfill" violated?** Stage decision 10 said "enforce on create/edit only — no backfill" in the context of existing USER assignments (externalCompanyId on existing User rows). The `isInternalRole` flag is a ROLE DEFINITION field, not user data. Setting the correct value on role definitions is initialization, not user-data backfill.

**Is the data migration idempotent?** The SQL `UPDATE` is not SQL-idempotent, but `prisma migrate deploy` records applied migrations in `_prisma_migrations` and never re-runs them. The migration runs exactly once per DB.

**Enforcement code:**
- `lib/data/users.ts` — `createUser()`: fetches role, checks `isInternalRole`; throws "External company is required for this role" if `false` and no company supplied
- `lib/data/users.ts` — `updateUserProfile()`: same check if `externalCompanyId` is being cleared
- `app/api/v1/orgs/[orgSlug]/users/route.ts` — catch block maps "External company is required" to `apiBadRequest` (400). **Bug found and fixed during E2E run** (`56d6756`): original catch block was missing this message, fell through to `apiServerError` (500)
- `app/[orgSlug]/admin/users/new/create-user-form.tsx` — tracks selected role in `useState`; conditionally requires External Company select + changes label to `fieldExternalCompanyRequired`
- `app/[orgSlug]/admin/users/new/page.tsx` — `RoleOption` interface updated to include `isInternalRole`

### U4 — Add edit capability for profile fields

New files / changes:
- `lib/data/users.ts` — `updateUserProfile(session, userId, input)`: tenancy-safe (`findFirst` on both `id` and `organizationId`); U3 enforcement on edit; syncs better-auth `name` when firstName/lastName change; uses `updateMany` for atomic tenancy-scoped update
- `app/api/v1/orgs/[orgSlug]/users/[userId]/profile/route.ts` — NEW PUT route, MANAGE_USERS-gated, partial update (only fields present in body are applied)
- `app/[orgSlug]/admin/users/actions.ts` — added `updateUserProfile` server action (thin marshaler via `internalFetch`)
- `app/[orgSlug]/admin/users/[userId]/page.tsx` — fetches external companies; `UserDetail` includes `externalCompanyId`
- `app/[orgSlug]/admin/users/[userId]/user-edit-form.tsx` — NEW client component: profile edit form + role change in one card
- `messages/en.json` — added `editProfileLabel`, `editProfileSubmit`, `editProfileSuccess`, `fieldExternalCompanyRequired`, `dangerZoneLabel`

### U5 — User detail page redesign

- `app/[orgSlug]/admin/users/[userId]/page.tsx` — redesigned layout: header with `@username` badge, `UserEditForm` card above, `UserDetailForms` danger zone below
- `app/[orgSlug]/admin/users/[userId]/user-edit-form.tsx` — NEW: main form card with profile fields + `<hr>` + role change section
- `app/[orgSlug]/admin/users/[userId]/user-detail-forms.tsx` — simplified to danger zone only (Activate/Deactivate + Set Password), red border

### U6 — E2E permission artifacts in admin UI

**Constraint: `tests/e2e/admin-stage4.spec.ts` is owned by Batch H for X5. I did NOT touch it.**

Changes:
- `prisma/seed.ts` — added `deleteMany({ where: { code: { startsWith: "E2E_PERM_" } } })` at top of `main()`
- `quotation-system-docs/design-docs/sql-queries/debug-queries.sql` — one-time purge SQL for manual use

Note: an earlier iteration added a data migration `20260814000003_purge_e2e_perm_artifacts` for this purpose. That migration was dropped in review round 1 (Finding 1): embedding test-cleanup in migration history creates a permanent `LIKE 'E2E_PERM_%'` footgun. The `debug-queries.sql` one-time purge and the seed deleteMany remain as the correct mechanism. The migration's `_prisma_migrations` row was explicitly deleted from the Neon dev DB via `prisma db execute` before the directory was removed; `prisma migrate status` confirms "17 migrations, Database schema is up to date!" with no drift.

**What requires Batch H (X5):** `admin-stage4.spec.ts` creates `E2E_PERM_${Date.now()}` permissions with no `afterAll` teardown. Without Batch H's fix, new E2E_PERM_* rows accumulate on every test run. The seed purge is the current stop-gap; ongoing per-run teardown is Batch H's responsibility.

### SQL mirror

Updated `quotation-system-docs/design-docs/sql-queries/by-page.sql`:
- Roles SELECT under `/admin/users/new` → includes `isInternalRole`
- Roles SELECT + external-companies SELECT under `/admin/users/[userId]` → includes `isInternalRole`
- `createUser` role SELECT includes `isInternalRole` (U3 enforcement note)
- New section: `PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile`

Updated `quotation-system-docs/design-docs/sql-queries/debug-queries.sql`:
- Added U6 one-time purge query section

---

## Patterns reused

- `internalFetch` (`lib/internal-fetch.ts`) — cookie-forwarding fetch (Stage 12 pattern)
- `useActionState` + `useTransition` — from original `user-detail-forms.tsx`
- `getApiSession` + `requirePermission` + error helpers — from existing `app/api/v1/orgs/[orgSlug]/users/[userId]/*` route handlers
- Tenancy guard pattern (findFirst on id + organizationId) — from existing user GET/PATCH routes
- Sage Ease token classes — from existing admin page components

---

## Spec strength (coordinator check: can each test fail if the fix were reverted?)

**U3 test 1** — external role + no company → 400: if `createUser()` U3 check removed, returns 201 → `expect(status).toBe(400)` FAILS. ✓

**U3 test 2** — external role + company → 201: regression check; passes regardless of U3 (validates the happy path still works). Does not assert on U3 behavior directly, but confirms the U3 check doesn't over-block valid creates. ✓

**U3 test 3** — internal role + no company → 201: if Admin's `isInternalRole = false` (data migration not applied), the check treats Admin as external, returns 400 → `expect(status).toBe(201)` FAILS. Also: the `expect(adminRole.isInternalRole).toBe(true)` guard assertion at the top fails if the data migration didn't run. ✓

**U4 test 1** — PUT /profile without MANAGE_USERS → 403: if `requirePermission(MANAGE_USERS)` guard removed from profile route, returns 200 → `expect(status).toBe(403)` FAILS. ✓

**U4 test 2** — PUT /profile for real userId from nordic-walls via acme-glass URL → 404: the test fetches the actual nordic-walls admin user ID (a row that EXISTS in the DB), clears cookies, signs into acme-glass, then calls PUT with that ID. If the `organizationId` filter were removed from `updateUserProfile()`, the `findFirst({ where: { id } })` would FIND the nordic-walls row, not throw, and the route would return 200 → `expect(status).toBe(404)` FAILS. A synthetic non-existent UUID would still 404 even without the filter, which is why the previous synthetic-UUID approach could not detect a missing-filter regression. ✓

**U4 test 3** — data correctness: if `updateUserProfile()` doesn't actually persist to DB (or persists to wrong record), GET returns old values → `expect(user.firstName).toBe(newFirstName)` FAILS. ✓

---

## `admin-stage4.spec.ts` — explicit statement

I did **not** touch `tests/e2e/admin-stage4.spec.ts`. It is owned by Batch H for X5. My U6 work provides a one-time purge (both in seed and in migration `20260814000003`). Ongoing cleanup of E2E_PERM_* rows created by future test runs requires Batch H to add an `afterAll` teardown to that spec.

---

## Verification

**Static checks:**
- `npm run lint` — 0 errors, 4 pre-existing warnings (in `stage7.spec.ts` and unrelated specs)
- `npx tsc --noEmit` — 0 errors

**Deploy (canonical URL — review round 1 fix):**
- Deployment `e8d487d` → `dpl_2NLxP2eiBYkmPopWkNMs4kxzofE9`
- Preview URL: `https://quotation-system-d69vidfsy-vistra-indias-projects.vercel.app`
- `GET /api/health` → `{"status":"ok","database":"connected",...}` ✓
- Build route list includes `api/v1/orgs/[orgSlug]/users/[userId]/profile` ✓
- Build log: "17 migrations found in prisma/migrations — No pending migrations to apply." ✓ (migration 3 absent from repo and DB)

**Automated E2E (6/6 passing) against `e8d487d`:**
```
PLAYWRIGHT_BASE_URL=https://quotation-system-d69vidfsy-vistra-indias-projects.vercel.app \
  npx playwright test tests/e2e/stage15-user-mgmt.spec.ts
→ 6 passed (1.2m)
```

**Manual U5:** Navigated to `/acme-glass/admin/users/{adminId}` on the `dn92z8qos` deployment (same code, `dd08c5a` before migration 3 drop):
- "Edit Profile" form card: FIRST NAME, LAST NAME, MOBILE (OPTIONAL), EMAIL (OPTIONAL), EXTERNAL COMPANY, Save Changes
- "Change Role" section with role dropdown + Update Role — in same card, below `<hr>`
- "Danger Zone" section (red border) below the card: Deactivate button + New Password fields + Set Password button
- Page header: `@admin` tag with user detail title

**Manual U6:** Navigated to `/acme-glass/admin/permissions` on the `dn92z8qos` deployment (after migration 3 applied the purge):
- `E2E_PERM_*` visible: false ✓
- Standard permission table visible (MANAGE_USERS, MANAGE_FEATURES, VIEW_ALL_DATA, MANAGE_PRICING, APPLY_DISCOUNT, DESIGN, QUOTE, ORDER) ✓
- Note: migration 3 was subsequently dropped in `e8d487d`. The E2E_PERM_* rows do not re-accumulate unless `admin-stage4.spec.ts` runs again (Batch H's teardown responsibility).

---

## Status

DONE
