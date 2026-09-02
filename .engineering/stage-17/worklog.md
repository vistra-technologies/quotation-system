# Stage 17 — worklog

**Stage target:** [`quotation-system-docs/development-cycles/stage-17.md`](../../../quotation-system-docs/development-cycles/stage-17.md)
**Tracker row:** [`quotation-system-docs/development-cycles/README.md`](../../../quotation-system-docs/development-cycles/README.md)
**Stage branch:** `release/stage-17`, cut from `master` at the tip of `origin/master` (no drift — confirmed clean before cutting), 2026-09-02.

---

## Work items

Filled in once the developer's plan proposes a breakdown (Step 2). Scope has 4 parts per the stage doc:
1. Intake form required/optional flips (4 forms)
2. Configuration-page restyle to mockup + Selection edit support (new PATCH route)
3. Docs (already done during stage-prep — no code)
4. SuperAdmin: create-org admin-password field (4a) + cross-org add-user (4b)

| Item | Description | Branch | Status |
|---|---|---|---|
| 1 | Intake form required/optional flips | `feature/1-intake-required-flips` | ✅ merged into `release/stage-17` |
| 2 | Configuration page restyle + Selection edit | `feature/2-configuration-restyle` | ✅ merged into `release/stage-17` |
| 4a | Create-org admin password field | `feature/4a-create-org-admin-password` | ✅ merged into `release/stage-17` |
| 4b | SuperAdmin cross-org add-user | `feature/4b-superadmin-add-user` | in progress |

---

## Activity log

- **2026-09-02 — conductor:** `release/stage-17` cut from `master` (up to date with `origin/master`, no
  local changes pending). Working dir scaffolded. Next: dispatch developer to produce `profile.md` and
  the implementation plan.
- **2026-09-02 — developer:** Wrote `profile.md` and `plan.md` after verifying all key files against
  current code. One open question surfaced (audit log for auto-created admin account — GATE A, human
  decision required before 4a can be coded). Recommendation: serial build order 1 → 2 → 4a → 4b.
  See `plan.md` FLAG 1 and `profile.md` "Key files confirmed" for the spot-check results.
- **2026-09-02 — conductor (GATE A):** Human decided FLAG 1 — **Option B, two audit-log rows.** Item 4a
  must write both `"org.create"` (existing) and a second `"user.create"` row (`targetType: "User"`,
  `targetId` = the new admin user's id, `metadata: { organizationId }`), per plan.md's Option-B branch.
  `createOrganizationWithDefaults()` must return `adminUserId` in its `ok` result so the route handler can
  write the second row. Plan's serial build order (1 → 2 → 4a → 4b) accepted — proceeding serially, no
  other deviations found. Starting item 1.
- **2026-09-02 — developer (item 1):** Implemented required/optional flips on all 4 intake forms. Changed
  files: `app/[orgSlug]/projects/new/create-project-form.tsx`,
  `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx`,
  `app/[orgSlug]/inquiries/new/create-inquiry-form.tsx`,
  `app/[orgSlug]/inquiries/[inquiryId]/edit/edit-inquiry-form.tsx`. End-client block fields (name, phone,
  email, address line 1, city, state) and GST made fully optional; `mainContractorName` made required.
  Also removed now-dead `isIndia` state/const from all 4 files (no longer referenced in JSX). No new
  Prisma queries → no `by-page.sql` update needed. Lint and `tsc --noEmit` passed locally (exit 0).
  Deployed: `https://quotation-system-bm1vwtq2a-vistra-indias-projects.vercel.app`
  (`/api/health` → 200 `database: connected`). Manual UI verification of form behavior needed against
  this preview URL before merging to `release/stage-17`.
- **2026-09-02 — reviewer (item 1):** APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 2 MINOR. All 8 field
  flips confirmed correct across all 4 files; `isIndia` confirmed absent from executable code; no
  server/API/DB touched; no unrelated changes. Minors: (1) `companyCountry` still declared in the
  TypeScript interface of both edit forms and still passed by their parent pages — dead code, no type
  error, no runtime effect; (2) stale JSDoc comments in all 4 files still describe the removed
  conditional-GST behavior. Details in `review-item1.md`.
- **2026-09-02 — developer (item 2):** Implemented configuration page restyle + Selection edit support.
  Changed files (app repo, branch `feature/2-configuration-restyle`, commit `d8b484b`):
  - `lib/data/selections.ts` — added `updateSelection(session, id, input)` (tenancy guard + PATCH-style
    update; `componentTypeId` not patchable; returns null on not-found)
  - `app/api/v1/orgs/[orgSlug]/selections/[id]/route.ts` — new PATCH route delegating to `updateSelection()`;
    returns 401/403/404/400 correctly; confirmed live (curl returns 401, not 404)
  - `app/[orgSlug]/projects/[projectId]/configuration/page.tsx` — reworked to 3-column layout; removed
    separate selections table section; extended `SelectionRow` type to include `config`; passes `selections`
    down to `AddSelectionForm`
  - `app/[orgSlug]/projects/[projectId]/configuration/add-selection-form.tsx` — substantially reworked:
    sidebar replaces `<select>`, Configure button replaces `<details>/<summary>` (absent when no advanced
    fields), full add/edit-mode state machine, schema-drift-safe pre-fill. `FieldInput` unchanged.
  - `app/[orgSlug]/projects/[projectId]/configuration/actions.ts` — added `updateSelection` server action
    (same `internalFetch` pattern as `createSelection`)
  Docs repo (commit `44a0bcf` on `main`):
  - `design-docs/sql-queries/by-page.sql` — extended GET section to note `config` included; added PATCH
    section with tenancy-guard SELECT + UPDATE queries
  Lint: 0 errors (5 pre-existing warnings). `tsc --noEmit`: exit 0.
  Preview URL: `https://quotation-system-jyjsiy7jb-vistra-indias-projects.vercel.app`
  (`/api/health` → 200 `database: connected`; PATCH route returns 401 auth-required, not 404).
  Manual UI verification required against preview URL: 3-column layout, sidebar click, Configure button
  presence/absence, right-column edit round-trip.
- **2026-09-02 — reviewer (item 2):** APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 2 MINOR. Tenancy guard
  on PATCH route/DAL confirmed correct; `componentTypeId` lock verified at all three layers; schema-drift
  handling covers both directions without crashing; `by-page.sql` updated (CLAUDE.md rule satisfied);
  reuse of `FieldInput`/`LoadingOverlay`/`createSelection` confirmed. Minors: (1) `handleEditSelection`
  type-filter drops `number|null` config values even when key exists in schema (no current field type
  produces them, theoretical); (2) PATCH route accepts empty-string `label` where POST enforces non-empty
  (UI path is guarded by the action, but direct API call can bypass). Details in `review-item2.md`.
- **2026-09-02 — developer (item 4a):** Implemented create-org admin password field. Branch:
  `feature/4a-create-org-admin-password`, commit `c3ebd43`.
  Changed files (app repo):
  - `lib/data/superadmin/orgs.ts` — added `import { auth } from "@/lib/auth"`;
    `createOrganizationWithDefaults` gains `adminPassword: string` 3rd param; hashes password before
    transaction; inside transaction tracks `adminRoleId` from role-creation loop (`roleDef.name === "Admin"`),
    then creates admin `User` + `Account` atomically; returns `adminUserId` in the `ok` result;
    `createOrgAuditLog` gains optional `targetType` 5th param (defaults to `"Organization"`) so it can
    serve both audit rows without a new helper — `orgId` param renamed `targetId` in the signature.
  - `app/api/v1/superadmin/orgs/route.ts` — validates `adminPassword` (required string, ≥8 chars, 400
    if missing/short), passes to `createOrganizationWithDefaults`; calls `createOrgAuditLog` twice after
    commit: `"org.create"` (Organization) + `"user.create"` (User, GATE A Option B).
  - `app/controls/(authenticated)/orgs/actions.ts` — reads `adminPassword` from FormData, validates
    client-side (non-empty, ≥8), includes in POST body.
  - `app/controls/(authenticated)/orgs/new/create-org-form.tsx` — added password field (type=password,
    minLength=8, required, autoComplete=new-password) between slug and submit button.
  Changed files (docs repo, commit `cd875cf` on `main`):
  - `design-docs/sql-queries/by-page.sql` — added steps 5–8 under the `/controls/orgs/new` section:
    User INSERT, Account INSERT, org.create audit log row, user.create audit log row (GATE A Option B).
  Lint: 0 errors (5 pre-existing warnings). `tsc --noEmit`: exit 0.
  Preview URL: `https://quotation-system-cqfs3tdu9-vistra-indias-projects.vercel.app`
  (`/api/health` → 200 `database: connected`).
  Verification: POST `/api/v1/superadmin/orgs` with `adminPassword:"SecurePass1234!"` → 201, org created.
  Org list confirms `userCount: 1` for the new org (admin User row present in DB).
  Subdomain login (`test-stage17.easeetool.com`) cannot be exercised from the preview URL — org was
  created in the Neon dev branch, which the production/staging domain serves from the main branch.
  DB evidence (userCount: 1) is the confirmation per the plan's "direct DB/API inspection" fallback.
- **2026-09-02 — reviewer (item 4a):** APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 2 MINOR. All 8
  security/correctness checks pass: password never plaintext in logs/response; hashing matches
  `lib/data/users.ts` pattern exactly; User+Account creation is inside the same `prisma.$transaction`
  as org+roles; Admin role captured by name with a throw guard (not by index); two audit rows fire
  after the transaction commits with correct action/targetType/targetId/metadata per GATE A Option B;
  `createOrgAuditLog` signature change backward-compatible with both existing call sites; server-side
  ≥8-char enforcement is in the API route independent of client. Minors: (1) `by-page.sql` Step 5
  uses `INSERT INTO "User"` (capital U) while the existing user INSERT at line 1746 uses lowercase
  — casing inconsistency in the docs mirror only; (2) `by-page.sql` Step 8 has `:orgId` embedded
  inside a SQL string literal where it won't be substituted — misleading placeholder. Details in
  `review-item4a.md`.
- **2026-09-02 — developer (item 4b):** Implemented SuperAdmin cross-org add-user console. Branch:
  `feature/4b-superadmin-add-user`, commit `2edf0bb`.
  New files (app repo):
  - `lib/data/superadmin/users.ts` — `listUsersInOrg`, `listExternalCompaniesInOrg`,
    `createUserInOrg` with full tenancy guards (role in org, company in org, U3 enforcement)
    and atomic User+Account creation (same pattern as `lib/data/users.ts`); password hashed via
    `auth.$context.password.hash()`; returns typed result shape.
  - `app/api/v1/superadmin/orgs/[orgId]/users/route.ts` — GET (users + external companies)
    and POST (create user) handlers; guarded by `requireSuperAdminFromRequest`; POST writes
    audit log via `createOrgAuditLog(action: "user.create", targetType: "User")` after commit.
  - `app/controls/(authenticated)/users/page.tsx` — Server Component following
    `roles/page.tsx` org-picker pattern; fetches users/roles in parallel; shows user table
    and add-user form when org is selected; suspended orgs excluded from picker.
  - `app/controls/(authenticated)/users/actions.ts` — `addUser` server action mirroring
    `orgs/actions.ts` pattern.
  - `app/controls/(authenticated)/users/create-user-form.tsx` — Client Component mirroring
    org-admin create-user-form field-for-field; companyRequired logic for U3 parity.
  Modified files (app repo):
  - `app/controls/(authenticated)/roles/org-picker.tsx` — added optional `basePath` prop
    (default `/controls/roles`) so the component can be reused for `/controls/users`.
  - `app/controls/(authenticated)/controls-shell.tsx` — added "Users" nav entry with
    people icon linking to `/controls/users`.
  Docs repo (commit `b4e7239` on `main`):
  - `design-docs/sql-queries/by-page.sql` — added `/controls/users` section with GET
    (user list, external companies), POST (tenancy guards, user INSERT, account INSERT,
    audit log INSERT).
  Static checks: `npm run lint` — 0 errors (5 pre-existing warnings). `npx tsc --noEmit` — exit 0.
  Preview URL: `https://quotation-system-nq53sk2su-vistra-indias-projects.vercel.app`
  (`/api/health` → 200 `database: connected`; `GET /controls/users` → 307 redirect to login
  (auth guard); `GET /api/v1/superadmin/orgs/test-id/users` → 401 auth required — both routes
  live and auth-guarded correctly).
  Manual UI verification required against preview URL: `/controls/users` page, org picker,
  user list rendering, add-user form submission, audit log row in Neon SQL editor.
- **2026-09-02 — reviewer (item 4b):** APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 2 MINOR. Both
  tenancy invariants confirmed: `roleId` and `externalCompanyId` are each validated against the target
  org in the DAL before the transaction (cross-org IDs correctly rejected as 400). All auth guards,
  password handling, audit logging, and add-only scope checks pass. `OrgPicker` `basePath` extension
  confirmed backward-compatible (roles page still passes no prop, default kicks in). `by-page.sql`
  updated with full coverage. Minors: (1) `by-page.sql` audit-log INSERT has `<orgId>` inside JSON
  string literal (same type as 4a MINOR #2, docs-only); (2) suspended-org guard is picker-only —
  direct URL navigation to `?orgId=<suspended-org-id>` still renders the add-user form (pre-existing
  pattern from `/controls/roles` template, not a regression). Details in `review-item4b.md`.
