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
| 4b | SuperAdmin cross-org add-user | `feature/4b-superadmin-add-user` | ✅ merged into `release/stage-17` |
| 4b-fix | Post-merge crash fix (`/controls/users` LoadingOverlay) | `feature/4b-superadmin-users-crash-fix` | ✅ merged into `release/stage-17` |
| test-fix-1 | `superadmin-orgs.spec.ts`/`superadmin-roles.spec.ts` adminPassword payload fix | `feature/stage17-bugfix-batch-1` | ✅ merged into `release/stage-17` |
| 5a | Layout fix — double max-width nesting in project wizard layout | `feature/5a-wizard-layout-padding-fix` | pending |
| 5b | Starter ComponentType catalog seeds at org creation | `feature/5b-component-catalog-seeding` | pending |
| 5c/5d | Icons + field-pairing layout + Saved Components/footer restyle | `feature/5cd-configuration-icons-layout` | ✅ merged into `release/stage-17` |
| 6a | SuperAdmin org hard-delete (suspended-only, transactional cascade, audit-logged) | `feature/6a-org-hard-delete` | 🔨 built, awaiting review |

**2026-09-03 — item 5 added (post-test, pre-deploy).** Human reviewed the live Configuration page
against the mockup and found real gaps beyond items 1/2/4a/4b's scope — see
`quotation-system-docs/design-docs/08-decisions-and-changelog.md`'s 2026-09-03 entry and
`stage-17.md`'s item 5 for full detail. Reopens the stage for one more implement→test round before
`engineering:deploy`. Items 1-4 (+ the crash fix and test fix above) remain merged, tested (PASS), and
untouched by this addition — only item 5 needs building.

**2026-09-03 — item 6 added (post-item-5-test, pre-deploy).** Human retrospective observation:
`engineering:test` passes against `staging` create orgs with no cleanup — confirmed 34/39 orgs (87%) in
the shared Neon dev branch are `e2e-`/`test-`/`verify-` test debris, and there is no delete capability
today (only suspend/reactivate). See `stage-17.md`'s item 6 for full detail (deletion order, safety gate,
audit-log handling). 6a is app code, this stage; 6b (tester cleanup convention) is a marketplace-plugin
instructions change, actioned separately, not part of this repo's build.

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
- **2026-09-03 — post-merge bug (human report) + fix — item 4b `/controls/users` crash on org
  select:** Human reported selecting an org under `/controls/users` reliably hit
  `app/global-error.tsx` ("Try again"). Root cause: `create-user-form.tsx` imported the shared
  `@/components/loading-overlay`, whose `LoadingOverlay` calls `useTranslations()` unconditionally on
  mount — `/controls` has no `NextIntlClientProvider`, so mounting throws immediately once
  `CreateUserForm` renders (i.e. as soon as an org with roles is selected). **Identical failure mode**
  to the Stage 16 `permission-toggle-button.tsx` post-deploy hotfix (2026-09-02) — same fix applied: a
  local, translation-free `PendingOverlay` (visible-prop-driven `<div>`, no `useTranslations()`).
  Fixed on `feature/4b-superadmin-users-crash-fix` (off `release/stage-17`), `npm run lint` clean,
  merged `873f728` → `release/stage-17` at `e01e24a`. **Not click-through verified** — SuperAdmin
  credentials (`SUPERADMIN_*_PASSWORD`) aren't available outside Vercel/CI env, so this needs
  confirming in the credentialed `engineering:test` pass. Documented in `AGENTS.md` (new "`/controls`
  has no `NextIntlClientProvider`" section) so any future `/controls/**` client component copies the
  local-overlay pattern instead of reintroducing this a third time.
- **2026-09-03 — separate bug found (human report), NOT fixed this stage — recurring
  `BETTER_AUTH_URL`/`crossSubDomainCookies` login-redirect-loop:** Human reported signing in on this
  stage's own `release/stage-17` ad-hoc preview (`quotation-system-nwr3b0eiw-...vercel.app`) bounces
  back to the login screen. Confirmed via direct `curl` against `/api/auth/sign-in/email`: the 200
  response's `Set-Cookie` sets `Domain=.easeetool.com` on a request served from a `*.vercel.app` host —
  RFC 6265 host-match failure, browser drops the cookie silently, next request has no session.
  Root cause: `lib/auth.ts`'s `crossSubDomainCookies.enabled`/`.domain` are computed once, at
  `betterAuth()` construction, from the single static `BETTER_AUTH_URL` env value for the whole Preview
  environment — which cannot be simultaneously correct for `test.easeetool.com` (needs the shared
  `.easeetool.com` cookie domain) and any ad-hoc branch preview (needs none). **This is not new** — the
  same env-var tradeoff has been hit and patched as a one-off at least four times already (Stage 2,
  Stage 10 Batch 2, Stage 13 H1, Stage 15 Round 2); this is the same structural bug recurring on a fifth
  branch. **Not fixed here** — a real fix (driving `crossSubDomainCookies` per-request off the inbound
  Host header, e.g. via better-auth's dynamic-baseURL support, rather than a static env var) touches
  production auth-cookie behavior and needs its own implement pass, not an ad hoc patch mid-verification.
  Documented in full in `AGENTS.md` so the next agent that hits "login succeeds but bounces back" on a
  branch preview recognizes it immediately instead of re-diagnosing from scratch. **Recommend scoping a
  dedicated fix as a future stage or as `engineering:stage-prep` input** — out of Stage 17's approved
  scope to fix now.
- **2026-09-03 — tester (engineering:test pass 1):** FAIL. Tested against `https://test.easeetool.com` (staging, commit `36fecba`). Static checks clean (lint 0 errors, tsc 0 errors). All product code verified correct — scope 1 (all 4 intake forms), scope 2 (PATCH route full round-trip), scope 4a/4b (code inspection, SA API auth guards). 1 MAJOR + 1 MINOR found, both in the committed E2E test suite (not product code): `superadmin-orgs.spec.ts` tests 3, 5, and 9 were not updated to include the new required `adminPassword` in their POST bodies — they will fail when SA credentials are set (test 3 body assertion, tests 5 and 9 status assertions). Test 4 also silently passes for the wrong reason. SuperAdmin live click-through (gaps A/B/C: `/controls/users` crash fix confirmation, create-org 4a end-to-end, add-user 4b end-to-end) could not be completed — SA credentials unavailable outside Vercel/CI. See `.engineering/stage-17/bugs-1.md`.
- **2026-09-03 — reviewer (bugfix batch 1):** APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR. All 5 `adminPassword` call sites confirmed updated with a valid (≥8 char) value; test 5's `userCount` assertion (0→1) and title change verified correct and consistent with Stage 17 item 4a's auto-create behavior; no other stale assertions found in either file; diff confirmed scoped to exactly the two test files; lint 0 errors, tsc 0 errors. See `.engineering/stage-17/review-bugfix1.md`.
- **2026-09-03 — conductor: credentialed SuperAdmin click-through (closes test-pass-1 gaps A/B/C).** Human
  supplied bootstrap SuperAdmin credentials (`devadmin`/confirmed working against `test.easeetool.com`).
  All three previously-unverified flows confirmed live, via direct API calls plus a direct read against
  the same Neon dev-branch DB that backs `test.easeetool.com` (`DATABASE_URL_UNPOOLED` from local
  `.env.local`, per CLAUDE.md's Neon-env-split note):
  - **Gap A (`/controls/users` crash fix):** `GET /controls/users?orgId=<vistra>` with a valid SA session
    renders "Add new user" in the HTML with zero "Something went wrong" markers. Confirmed fixed.
  - **Gap B (item 4a, create-org-with-admin-password):** created a real throwaway org
    (`verify-4a-<timestamp>`) via `POST /api/v1/superadmin/orgs` with `adminPassword`. Confirmed via DB
    query: exactly one `user` row (`username: "admin"`), exactly two `SuperAdminAuditLog` rows
    (`org.create` targeting the org id, `user.create` targeting the user id — GATE A Option B, exactly as
    decided). Confirmed the auto-created admin can sign in (`POST /api/auth/sign-in/email` → 200).
  - **Gap C (item 4b, cross-org add-user):** on the same throwaway org, confirmed a cross-org `roleId`
    (vistra's Admin role) is rejected 400 (`"roleId does not belong to this organization"`); a same-org
    role succeeds 201; the new user can sign in and appears in `GET .../users`.
  All three gaps from `bugs-1.md` are now closed. Merged `feature/stage17-bugfix-batch-1` → `release/stage-17`
  (`c31a50f`). Next: re-sync `staging`/`test.easeetool.com` and re-run the tester for a final PASS.
- **2026-09-03 — tester (engineering:test pass 2):** PASS. Tested against `https://test.easeetool.com` (staging, commit `230f7f5`). Static checks clean (lint 0 errors, tsc 0 errors). All bugs-1.md issues confirmed resolved: tests 3, 4, 5, 9 in `superadmin-orgs.spec.ts` and the `createTestOrg()` helper in `superadmin-roles.spec.ts` all pass with SA credentials supplied. SuperAdmin full login round-trip, tenancy isolation, cross-org role ownership guard — all pass. 25/31 tests passed; 3 Tier-2 page-navigation tests showed transient `ERR_NETWORK_IO_SUSPENDED`/timeout failures due to parallel-worker resource contention (all 3 pass in isolation in 7s total); 3 tests cascaded-skipped from serial-mode. No new defects found. 0 CRITICAL, 0 MAJOR, 0 MINOR (new). Pre-existing MINOR flakiness noted: Tier-2 tests are sensitive to concurrent load from the tenancy-isolation test. See `.engineering/stage-17/test-pass-2.md`.
- **2026-09-03 — developer (item 5c/5d):** Icons + field-pairing layout + sidebar/saved-items restyle + footer. Branch: `feature/5cd-configuration-icons-layout`, commit `053ef3a`.
  New files:
  - `lib/component-icons.tsx` — `ComponentIcon` lookup: GLASS (4-pane window), DOOR (rect + handle circle), PROFILE_STOP (extruded-rail bar + tick marks), fallback = box/package SVG reused from the empty state.
  Changed files:
  - `app/[orgSlug]/projects/[projectId]/configuration/add-selection-form.tsx` — (a) `pairFields()` helper groups consecutive `field`/`dropdown` entries into `grid-cols-2` rows; `radio`/`checkbox` always full-width (no `FieldEntry` interface change); (b) sidebar tiles restyled from flat text to vertical icon-over-label bordered cards; selected = `bg-primary text-text-on-primary`; (c) Saved Components rows restyled to icon chip + bold name + muted type subtitle + chevron `›`; editing row highlighted (border-primary bg-primary-softer), icon chip flips to bg-primary; (d) Configure button → `w-full bg-primary-soft border-primary-soft text-primary-dark` (soft treatment); submit button → `w-full`, stacked below Configure.
  - `app/[orgSlug]/projects/[projectId]/configuration/page.tsx` — added `Link` import; compute `base` via `orgHref`; card footer (border-t, justify-between) with Back (outline) and Continue to Design (primary) links using subdomain-aware `${base}/projects/${projectId}` hrefs.
  Lint: 0 errors (5 pre-existing warnings in test files). `tsc --noEmit`: exit 0.
  Judgment calls: (1) icon shapes — GLASS=divided window, DOOR=rect+handle, PROFILE_STOP=bar+ticks (all 24×24 outlined, matching codebase icon language); (2) soft-button class combo = `bg-primary-soft border-primary-soft text-primary-dark` (direct translation of style guide's `.btn-soft`); (3) `pairFields` key = `row[0].key` (stable, field-schema-derived, not index).
- **2026-09-03 — developer (item 5a):** Layout fix — removed double-centered max-width in project wizard layout. Changed: `app/[orgSlug]/projects/[projectId]/layout.tsx` line 74 — replaced `"mx-auto w-full max-w-5xl px-6 py-8"` with `"py-8"`. The parent `app/[orgSlug]/projects/layout.tsx` already applies `mx-auto max-w-[1180px] px-8`, so the inner wrapper's centering/width/horizontal-padding was redundant and wasted ~150-190px. Lint: 0 errors (5 pre-existing warnings). tsc: pre-existing errors only (generated Prisma client absent from worktree, unrelated `proxy.ts`/`users.ts` nullability — all pre-existing on the branch, not introduced by this change). Branch: `feature/5a-wizard-layout-padding-fix`, commit `f8577a2`, pushed. Vercel preview will be the functional verification.
- **2026-09-03 — developer (item 5b):** Starter ComponentType catalog seeding at org creation. Changed files (app repo, branch `feature/5b-component-catalog-seeding`, commit `84f73fd`):
  - `lib/component-catalog-seed.ts` (new) — shared module exporting `COMPONENT_TYPE_DEFS` (GLASS, DOOR, PROFILE_STOP with full `fieldsSchema`) and `SEEDED_CATALOG_CATEGORY_NAME = "Glass Partitions"`. DOOR's `doorType` field changed from `type: "radio"` to `type: "dropdown"` per the field-pairing decision (Stage 17 5b spec + decisions log 2026-09-03 decision #3).
  - `lib/data/superadmin/orgs.ts` — imports shared module; inside the existing `$transaction`, after admin User+Account creation, adds `tx.componentCategory.create()` + loop over `COMPONENT_TYPE_DEFS` with `tx.componentType.create()` (plain `.create()`, not `.upsert()` — this path only runs once at org creation). No change to the function's return type or callers.
  - `prisma/seed.ts` — imports `COMPONENT_TYPE_DEFS` and `SEEDED_CATALOG_CATEGORY_NAME` from the new module; removes the now-redundant inline `componentTypeDefs` array; updates all three log lines that referenced `componentTypeDefs.length`. The idempotent upsert loop is otherwise unchanged.
  Docs repo (commit `c5326e7` on `main`):
  - `design-docs/sql-queries/by-page.sql` — added Steps 9 and 10 under `/controls/orgs/new`: ComponentCategory INSERT and ComponentType INSERT (per def), inside the same transaction.
  Static checks (from worktree after `npm install`): lint 0 errors (5 pre-existing warnings), tsc exit 0.
  Live verification (org creation producing 3 ComponentTypes) is engineering:test's job against the Vercel preview.
- **2026-09-03 — reviewer (item 5 — integrated 5a/5b/5c/5d):** APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 1 MINOR. All per-item and integration correctness checks pass; lint 0 errors and tsc exit 0 confirmed independently (fresh run). See `.engineering/stage-17/review-item5.md`.
- **2026-09-03 — tester (engineering:test pass 3):** PASS. Tested against `https://test.easeetool.com` (staging, commit `f9d8c75` — items 5a/5b/5c/5d). Static checks clean (lint 0 errors, tsc exit 0). All item 5 deliverables verified: 5a double-max-width removed (confirmed in HTML + source); 5b new org gets exactly 3 seeded ComponentTypes (GLASS/DOOR/PROFILE_STOP, doorType=dropdown), auto-admin signs in, vistra untouched; 5c/5d icons present, field-pairing grid-cols-2 active, Saved Components rows show chevron + editing highlight, footer Back/Continue to Design correct. Regression (item 2 PATCH round-trip + componentTypeId lock): intact. 0 CRITICAL, 0 MAJOR, 0 MINOR (new). Pre-acknowledged MINOR from review-item5.md not re-reported. See `.engineering/stage-17/test-pass-3.md`.
- **2026-09-03 — developer (item 6a):** Implemented SuperAdmin org hard-delete. Branch: `feature/6a-org-hard-delete`.
  Changed files (app repo):
  - `lib/data/superadmin/orgs.ts` — added `DeleteOrgResult` type + `deleteOrganization(orgId)` function: pre-flight findUnique (not_found → 404, not_suspended → 400 safety gate); 14-step `$transaction` deleting all org-scoped children in FK-safe order (Selection → Partition → Floor → Project → Inquiry → ItemPrice → CatalogItem → ComponentType → ComponentCategory → User → RolePermission via role.organizationId filter → ExternalCompany → Role → Organization); returns org identity captured before deletion for audit log.
  - `app/api/v1/superadmin/orgs/[orgId]/route.ts` (new) — DELETE handler; auth guard (`requireSuperAdminFromRequest`); maps not_found→404, not_suspended→400, unknown_error→500; writes `createOrgAuditLog` with `action: "org.delete"`, `targetType: "Organization"`, `metadata: { slug, name }` after the transaction commits.
  - `app/controls/(authenticated)/orgs/_delete-button.tsx` (new) — Client Component; `ConfirmDialog` (not `window.confirm`); names org in dialog copy; direct fetch to DELETE endpoint + `router.refresh()`; no `LoadingOverlay` (AGENTS.md rule — `/controls` has no `NextIntlClientProvider`); only rendered by the page for suspended orgs.
  - `app/controls/(authenticated)/orgs/page.tsx` — added `DeleteOrgButton` import; `OrgsTable` gains optional `showDeleteButton` prop (default false); suspended-orgs section passes `showDeleteButton`; button rendered conditionally alongside `SuspendOrgButton` in a flex gap row.
  Docs repo (same change, in `quotation-system-docs/`):
  - `design-docs/sql-queries/by-page.sql` — added `/controls/orgs DELETE` section (Steps 0–15: pre-flight SELECT, all 14 DELETE statements in FK-safe order matching the transaction, post-transaction audit log INSERT note).
  Static checks: `npm run lint` — 0 errors (5 pre-existing warnings, unchanged). `npx tsc --noEmit` — exit 0.
  Commit: `e6ea331`. Pushed to `feature/6a-org-hard-delete`. Vercel preview build in progress — preview URL to be appended by orchestrator after polling deployment to READY.
- **2026-09-03 — developer (item 6a — TOCTOU fix, review finding):** Addressed reviewer IMPORTANT finding: `deleteOrganization()` re-verifies `isSuspended` inside the `$transaction` (step 0) before the first delete. A concurrent reactivate between the pre-flight check and the transaction start no longer proceeds — `findUnique` inside the transaction reads the current committed state; if `isSuspended` is false (or row is gone), throws a NOT_SUSPENDED sentinel that is caught and mapped to `{ ok: false, reason: "not_suspended" }` instead of `unknown_error`. No other files changed. Lint: 0 errors (5 pre-existing). tsc: exit 0. Commit: `e77bc9e`, pushed.
- **2026-09-03 — reviewer (item 6a):** CHANGES-NEEDED. 0 CRITICAL, 1 IMPORTANT, 0 MINOR. IMPORTANT: TOCTOU race on the suspended-only safety gate — `isSuspended` is read outside `$transaction` and not re-verified inside before the first DELETE; a concurrent reactivate between the pre-flight read and the transaction start could delete a live org (irreversible). Fix: re-read `isSuspended` inside the transaction before the first `deleteMany`. All other checks pass: FK-safe deletion order verified against real schema (all 14 steps + RolePermission relay filter), no missing tables, `orgIdentity` captured pre-delete, audit log action/targetType/metadata correct per spec, `ConfirmDialog` used (not `window.confirm`), no `@/components/loading-overlay` import, `showDeleteButton` gated to suspended-orgs section only, `finally` resets loading correctly, convention-consistent with sibling DAL functions. Lint 0 errors, tsc exit 0 independently confirmed. See `.engineering/stage-17/review-item6a.md`.
- **2026-09-03 — reviewer (item 6a — TOCTOU fix re-check, commit `e77bc9e`):** APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR. IMPORTANT finding confirmed resolved: `tx.organization.findUnique` (Step 0) is the first statement inside the `$transaction` callback; throws `{ code: "NOT_SUSPENDED" }` sentinel if `!locked || !locked.isSuspended`; Prisma aborts the transaction on throw (no deletes execute); catch maps sentinel → `{ ok: false, reason: "not_suspended" }`, not `unknown_error`. Error shape identical to pre-flight path. No other files changed. Lint 0 errors (5 pre-existing), tsc exit 0 confirmed. One nit not blocking: inline comment describes "Postgres serializable snapshot" but Prisma's default isolation is READ COMMITTED — fix is still adequate for this use case. See this worklog entry (no separate review file for a scoped re-check).
