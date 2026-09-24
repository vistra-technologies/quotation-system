# Stage 25 worklog

## Status

- **Phase:** implement — Batches 1–2 **R1 APPROVED** (`review-r1-v2.md`), merged into `release/stage-25`
  @ `fec663a`. Batch 3 DONE (`493701e`). Batch 4 DONE (`2731f6a`). **Batch 5 DONE** (`6639049`,
  branch `feature/s25-b5-org-formula-picker`, preview READY). R2 checkpoint covers Batches 3–5 together.
- **Active work item:** Batch 5 DONE. R2 review pending (covers Batches 3–5). Next after R2: Batch 6.
- **Latest artifacts:** `plan-b5.md` (implemented)
- **Review cadence for this stage (non-default — see `profile.md`):** R1 after Batches 1–2, R2 after
  3–5, R3 after 6 alone, R4 after 7–9. Functional verification deferred to one `engineering:test` pass
  at the end, not per-batch.

## Work items

| # | Batch | Status |
|---|---|---|
| 1 | Bug 3: ComponentType-edit crash | DONE — `dd164d3`, preview READY |
| 2 | Bug 2: pills don't re-lock | DONE — `aada016`, preview READY, 7/7 tests pass |
| 3 | Formula-set API + data layer | DONE — `493701e`, preview READY |
| 4 | Formula-set SuperAdmin screens (mockup first) | DONE — `2731f6a`, preview READY |
| 5 | Org create/edit formula picker (mockup first) | DONE — `6639049`, preview READY |
| 6 | Pricing → Inventory rename | not started |
| 7 | Inventory create/edit API | not started |
| 8 | Inventory create/edit popup (mockup first) | not started |
| 9 | Problem popup (mockup first) | not started |

## Activity log

*(agents append their own thin entries below, in order)*

---

**2026-09-24 — developer — Batch 1 investigation + plan**

Role: developer (plan-only dispatch)
Outcome: root cause identified, plan written to `.engineering/stage-25/plan.md`.

Root cause: **suspect (a) confirmed.** The guard (DAL → route → 409) works correctly for
field-key removal. The crash is purely in the server action `updateSuperAdminComponentType`
(actions.ts line 137) which throws on any non-ok response — Next.js propagates that throw to
the error boundary. Suspects (b) and (c) are false: the guard covers field-key removal
(`removedReferencedKeys()` in `lib/formula-compat.ts`), and the org-level route already
imports and catches `ComponentTypeGuardError` with `apiConflict`.

Files to change:
- `app/controls/(authenticated)/component-types/actions.ts` — convert `updateSuperAdminComponentType` to `useActionState` signature (return `{ error }` instead of throwing)
- `app/controls/(authenticated)/component-types/edit-component-form.tsx` — `useActionState`, inline error display, pre-save calc-warning
- `tests/e2e/superadmin-component-types.spec.ts` (new) — three API tests for the guard

Reused patterns: `app/controls/(authenticated)/users/create-user-form.tsx` + `actions.ts`
(AddUserState / useActionState / isPending pattern).

Decision to gate: pre-save warning is inline text (not a modal) — no mockup needed per
S25-11 (only Batches 4/5/8/9 require mockup-first). Flagged at top of plan.md.

Status: **DONE** — plan ready for Gate A review before implementation starts.

---

**2026-09-24 — developer — Batch 1 implementation**

Role: developer (implement dispatch)
Branch: `feature/s25-b1-componenttype-crash` → commit `dd164d3`
Preview: `https://quotation-system-m1aobw2mn-vistra-indias-projects.vercel.app` (READY, health 200)

Files changed:
- `app/controls/(authenticated)/component-types/actions.ts` — added `UpdateComponentTypeState` type; changed `updateSuperAdminComponentType` from `(formData) → void` (throw on error) to `(prevState, formData) → { error }` (return error on any non-ok including 409); 401 still redirects.
- `app/controls/(authenticated)/component-types/edit-component-form.tsx` — removed `useFormStatus` import; added `useActionState` (react); switched `PendingOverlay` to `visible` prop; switched `SubmitButton` to `isPending` prop; added `code` state for warning tracking; added `showCalcWarning` computed value (true when code changed or any initial field key removed); added inline error display (`state.error`) and calc-warning advisory (`text-status-pending-text`) above submit button.
- `tests/e2e/superadmin-component-types.spec.ts` — added 3 new API-level formula-guard tests (tests 15–17): 409 on removing a referenced key; 200 on removing an unreferenced key; 200 on adding a key. All skip if `TEST_SA_USERNAME`/`TEST_SA_PASSWORD` absent.

Reused: `useActionState` + `AddUserState` pattern from `app/controls/(authenticated)/users/create-user-form.tsx` + `actions.ts`; `PendingOverlay visible` prop from same.

Verify: `npx eslint <3 files>` → clean; `tsc --noEmit` → clean; Vercel preview READY; `/api/health` 200 `database:connected`; e2e run → 4 passed (auth gate + redirect page), 15 skipped (SA creds absent, expected per spec header). No SuperAdmin creds available in local env, so formula-guard tests skipped silently — confirmed that's the designed behavior.

Decision taken: `text-status-pending-text` used for calc-warning (no `text-status-warn-text` token in `globals.css`; `status-pending` is amber `#875711` which reads as a visual advisory).

Status: **DONE**

---

**2026-09-24 — developer — Batch 2 investigation + plan**

Role: developer (plan-only dispatch)
Outcome: root cause confirmed, route audit complete, plan written to `.engineering/stage-25/plan-b2.md`.

Root cause: **API layer is fully correct.** All invalidation paths (partition PATCH geometry, replaceSides add/remove, Floor delete, Room delete, Selection config PATCH) were wired in Stage 23 Batch 3 and are intact. The bug is entirely a missing `router.refresh()` on the client: `handleSubmitDesign()` calls it (Stage 21 QA fix), but `handleSave()`, `onSave` (unsaved-modal), `handleFloorDeleted`, `handleRoomDeleted`, and `handleSideConverted` in `design-workspace.tsx` do not.

Trip-wire: did NOT fire. The human's repro edit (`design`/`heightMm` change) is covered by D-14/D-17 — the API clears correctly. No design decision needed.

Files to change:
- `app/[orgSlug]/projects/[projectId]/design/design-workspace.tsx` — add `router.refresh()` in 5 places (handleSave, onSave modal, handleFloorDeleted, handleRoomDeleted, handleSideConverted); `router` already in scope
- `tests/e2e/stage25-b2-pill-relock.spec.ts` (new) — 6 API-level tests (one per clearing route) + 1 e2e UI test (submit → edit partition → pills locked without reload)

No child component files need to change. No migration needed (S25-10 confirmed). No mockup needed (not a visual design change per S25-11).

Reused: `arm()`/`readProjectState`/`insertCalculation`/`setDesignSubmittedAt` pattern from `stage23-wiring.spec.ts` and `db-helpers.ts`; `router.refresh()` pattern from `handleSubmitDesign()`.

Status: **DONE** — plan ready for Gate A review before implementation starts.

---

**2026-09-24 — developer — Batch 2 implementation**

Role: developer (implement dispatch)

Files changed:
- `app/[orgSlug]/projects/[projectId]/design/design-workspace.tsx` — added `router.refresh()` in 5 places: `handleSave()`, `runWithUnsavedGuard`'s `onSave`, `handleFloorDeleted`, `handleRoomDeleted`, `handleSideConverted`. `router` was already in scope (imported from `next/navigation`, used in `handleSubmitDesign`).
- `tests/e2e/stage25-b2-pill-relock.spec.ts` (new) — 6 API regression tests (one per clearing route: partition geometry PATCH, sides add/remove, Room delete, Floor delete, Selection config PATCH) + 1 E2E UI test (submit design → edit partition height → pills lock without reload).

Reused: `arm()`/`insertCalculation`/`setDesignSubmittedAt`/`readProjectState` from `db-helpers.ts`; `apiSignIn()` + `orgUrl()` from `helpers.ts`; `newWall()` pattern from `stage23-wiring.spec.ts`; `router.refresh()` comment style from `handleSubmitDesign()`.

Open item found during implementation: Design page (`page.tsx`) redirects to Project Details when `selectionCount === 0` (Stage 19 Batch 4 gate). `newWall()` creates no Selection, so the E2E UI test needed a GLASS Selection added before `arm()`. Fixed in second commit (`aada016`).

Pill selector confirmed from `project-wizard-breadcrumb.tsx`: locked step renders as `<span aria-disabled="true">`, unlocked as `<Link>`. Test asserts `summaryLi.locator('span[aria-disabled="true"]')` has count 0 (before) then 1 (after save without reload).

Route Audit Table (Execution Log deliverable — full table in `plan-b2.md`):
| Route | API Correct? | UI Gap Fixed? |
|---|---|---|
| Partition PATCH geometry | Yes | handleSave + modal onSave now call router.refresh() |
| replaceSides add/remove partition | Yes | handleSideConverted now calls router.refresh() |
| Room delete | Yes | handleRoomDeleted now calls router.refresh() |
| Floor delete | Yes | handleFloorDeleted now calls router.refresh() |
| Selection config PATCH | Yes | No gap (server action redirect causes full re-render) |
| All non-invalidating paths | Yes | No router.refresh() needed, correct |

Verify: lint → 0 errors (9 pre-existing warnings). `tsc --noEmit` → clean. Vercel preview `quotation-system-i6ed7dqvp-vistra-indias-projects.vercel.app` READY. `/api/health` 200. Spec: **7/7 passed**.

Commits: `bb6d94b` (app + spec), `aada016` (test fix: add Selection for Design page gate). Branch: `feature/s25-b2-pill-relock`.

Status: **DONE**

---

**2026-09-24 — reviewer — R1 checkpoint (Batches 1 + 2)**

Role: reviewer · Verdict: **CHANGES-NEEDED** · Findings: 0 CRITICAL / 2 IMPORTANT / 4 MINOR
Report: `.engineering/stage-25/review-r1.md`. Headline: both root-cause fixes are correct and the B2 route audit
checks out against the DAL. Two small gaps against the stage checklist: the "older-version key → allowed" test is
missing, and the delete-confirm dialog has no calculation-impact warning. `tsc`/`eslint` clean.

---

**2026-09-24 — developer — R1 fix round (Findings 1–4, Feature #5 to backlog per human)**

Role: developer (R1 fix dispatch)
Branch: `feature/s25-r1-fixes` → commit `bdc278b`
Preview: `https://quotation-system-3qmvonvb4-vistra-indias-projects.vercel.app` (READY, health 200)

Files changed:
- `tests/e2e/superadmin-component-types.spec.ts` — (F1) new test "formula-guard: PATCH removing a key only an unassigned (older-version) formula set referenced → 200": creates a unique-code temp component type + an unassigned `FormulaSet` (via `createTempFormulaSet` from db-helpers) referencing that type's field key; PATCHes to remove the key; expects 200 because the set is NOT the org's `activeFormulaSetId`. Cleans up with `deleteTempFormulaSet`. (F3) Existing 409 test: converted two soft `test.skip` exits to hard `expect` (GLASS not found → `toBeTruthy()`; `glassType` field not present → `toBeLessThan()`); added `toMatch(/v\d+/)` and `toContain("glassType")` to the 409 error-body assertions. Added import of `createTempFormulaSet`/`deleteTempFormulaSet` from `./db-helpers`.
- `app/controls/(authenticated)/component-types/_delete-button.tsx` — (F2) added sentence "Deleting a component type can also affect this organization's formula/material/BOQ calculations." to the ConfirmDialog message.
- `app/controls/(authenticated)/component-types/edit-component-form.tsx` — (F4) added `const [name, setName] = useState(initialName)` (like `code`); changed `<input defaultValue={initialName}>` to `value={name} onChange={(e) => setName(e.target.value)}` so the field survives a React 19 form-action reset after a 409.

Reused: `createTempFormulaSet`/`deleteTempFormulaSet` already in `tests/e2e/db-helpers.ts` + `prisma/e2e-db-helper-cli.ts` (Stage 23 B3). Controlled-input pattern from `code` state already in same file.

Verify: `tsc --noEmit` → clean (no output). `npm run lint` → exit 0. Vercel preview READY, `/api/health` 200 `database:connected`. E2e spec (20 tests): 4 passed (auth-gate + page redirect, no SA creds needed), 16 skipped (SA creds absent — expected per spec header; formula-guard tests in this set will be exercised in the `engineering:test` pass on `test.easeetool.com` with real creds). Hard expects in F3 will fire correctly when SA creds are present.

Finding #5 (label freeze in calculation): to backlog per human decision, not touched.

Status: **DONE**

---

**2026-09-24 — reviewer — R1 re-review (fix round `bdc278b`)**

Role: reviewer · Verdict: **APPROVE** · New findings: 0 CRITICAL / 0 IMPORTANT / 0 MINOR
Report: `.engineering/stage-25/review-r1-v2.md`. R1 #1–#4 are verified resolved. `tsc`/`eslint` are clean. Carry-forward to
`engineering:test`: run `superadmin-component-types.spec.ts` with `TEST_SA_*` set and expect 0 skipped formula-guard tests (they have never run).

---

**2026-09-24 — developer — Batch 3 implementation**

Role: developer (implement dispatch)
Branch: `feature/s25-b3-formula-set-api` → commit `493701e`
Preview: `https://quotation-system-lgnm9phnh-vistra-indias-projects.vercel.app` (READY, health 200)

Files added:
- `lib/data/superadmin/formula-sets.ts` — DAL: `listFormulaSets`, `getFormulaSet`, `createFormulaSet`, `updateFormulaSet` (in-use lock check + update in `$transaction`), `newVersionOfFormulaSet`, `createFormulaSetAuditLog`. `FormulaSetInUseError` carries `inUseBy` counts for the 409 response shape. `locked` computed from `_count` in a single `findMany`/`findUnique` — no extra round-trips.
- `app/api/v1/superadmin/formula-sets/route.ts` — GET (list, `body` omitted) + POST (create). Validator wired before DB write; P2002 → 409.
- `app/api/v1/superadmin/formula-sets/[setId]/route.ts` — GET (detail, `body` included) + PATCH (update; `FormulaSetInUseError` → 409 with `inUseBy`; NOT_FOUND → 404; P2002 → 409).
- `app/api/v1/superadmin/formula-sets/[setId]/version/route.ts` — POST new-version action; optional `name` body field for fork; NOT_FOUND → 404.
- `tests/e2e/superadmin-formula-sets.spec.ts` — 15 API-level Playwright tests. T1–T1e (auth gate, no SA creds needed): all 5 pass. T2–T11 (CRUD + lock + new-version + 404): 10 skip when SA creds absent (expected — same pattern as `superadmin-component-types.spec.ts`).

Docs repo (`quotation-system-docs`):
- `design-docs/sql-queries/by-page.sql` — appended `[Stage 25 Batch 3]` section with SQL for all 6 DAL functions. Commit `f597ece` in docs repo.

Reused: `requireSuperAdminFromRequest` + `SuperAdminUnauthorizedError` from `lib/superadmin-guard.ts`; `apiBadRequest`/`apiUnauthorized`/`apiNotFound`/`apiConflict`/`apiServerError` from `lib/api-error.ts`; `validateFormulaSetBody` from `lib/formula-set/validate.ts`; `$transaction` pattern from `lib/data/superadmin/component-types.ts`; audit log pattern from `createComponentTypeAuditLog`; `readOrgActiveFormulaSet` from `tests/e2e/db-helpers.ts` (T9 locked-set test).

Decision taken: 401 (not 403) for non-SA callers on all routes — matches every existing superadmin route's `apiUnauthorized`/`SuperAdminUnauthorizedError` convention per plan-b3.md gate resolution.

Verify: `npx eslint <5 new files>` → 0 errors. `tsc --noEmit` → clean. Vercel preview READY (58s build). `/api/health` 200 `database:connected`. Routes confirmed live via curl (all return 401 without SA cookie). E2e: **5/15 passed** (T1–T1e), 10 skipped (SA creds absent — designed behavior, will exercise T2–T11 in `engineering:test` pass with real creds).

Status: **DONE**

---

**2026-09-24 — developer — Batch 4 mockup**

Role: developer (mockup-only dispatch, S25-11 requirement)
Docs repo: `design-docs/mockups/formula-sets-poc.html` — commit `01176fc` on docs `main`

What the mockup shows (three tab-switched views in one self-contained HTML file):

1. **List view** — table with Name / Version / Status / In-use-by (org+project+calc chips) /
   Actions columns. Shows both unlocked rows (pill-success, "Edit" action) and locked rows
   (pill-locked, "View" action). In-use chips highlighted in blue when counts > 0. Includes
   the "+ New Formula Set" create-form at the bottom of the page (name + version fields +
   JSON textarea + Create button).

2. **Detail — editable (unlocked) set** — two states side by side:
   - State A (valid): name/version inputs + JSON textarea (normal border) + Save enabled.
   - State B (validation errors): same form but JSON textarea has a red border (`class="error"`),
     and a red error panel immediately below lists each error string
     (`variables is required`, `code is required`, `multiplier must be positive`); Save button
     is disabled/greyed out.

3. **Detail — locked set** — locked banner with in-use counts; name/version inputs disabled
   (greyed); JSON body shown as a `<pre>` read-only block (not a textarea); both the section
   header and the form footer have a "+ Create new version (v3)" primary button; no Save.

Visual style: matches controls-shell.tsx + globals.css tokens exactly (Nunito font, --primary
#4E7F58, --bg-card #FBFAF5, --border #E0E2D7, shadow-card, pill shapes, font weights, table
th uppercase tracking). Sidebar shown in full with "Formula Sets" nav item active.

Status: **DONE** — mockup at `quotation-system-docs/design-docs/mockups/formula-sets-poc.html`.
Awaiting human sign-off before real component code is written (S25-11).

---

**2026-09-24 — developer — Batch 3 plan**

Role: developer (plan-only dispatch)
Outcome: plan written to `.engineering/stage-25/plan-b3.md`.

Plan covers:
- 5 routes: GET /formula-sets, POST /formula-sets, GET /formula-sets/[setId], PATCH /formula-sets/[setId], POST /formula-sets/[setId]/version
- DAL: `lib/data/superadmin/formula-sets.ts` following `component-types.ts` pattern exactly (types, queries, mutations, audit log)
- In-use check (S25-2): counts all three tables (`activeForOrgs`, `pinnedProjects`, `calculations`) inside a single `$transaction` before the update
- "New version" action: fetches max version for the name, creates version+1
- Validation wired: `validateFormulaSetBody()` from `lib/formula-set/validate.ts` before create and before update when body supplied; malformed JSON → 400 never 500
- Response shapes: list omits `body`; detail includes `body`; both include computed `locked` + `inUseBy` counts
- Tests: 11 API-level Playwright tests (T1–T11) in `tests/e2e/superadmin-formula-sets.spec.ts`, same Tier 1 pattern as `superadmin-component-types.spec.ts`

Decision flagged: existing superadmin routes return 401 (not 403) for all non-SA callers via `apiUnauthorized`. Plan proposes keeping that convention and testing for 401; flag in plan if human wants a true 403 for org-authenticated-but-not-SA callers.

Files to add: `lib/data/superadmin/formula-sets.ts`, `app/api/v1/superadmin/formula-sets/route.ts`, `app/api/v1/superadmin/formula-sets/[setId]/route.ts`, `app/api/v1/superadmin/formula-sets/[setId]/version/route.ts`, `tests/e2e/superadmin-formula-sets.spec.ts`. Plus `by-page.sql` update.
No migration (S25-10 confirmed — `FormulaSet` already exists with correct shape).

Status: **DONE** — plan ready for gate before implementation.

---

**2026-09-24 — developer — Batch 4 implementation (API amendment + UI screens)**

Role: developer (implement dispatch)
Branch: `feature/s25-b4-formula-screens` → commit `2731f6a`
Preview: `https://quotation-system-2wc6q6yjo-vistra-indias-projects.vercel.app` (READY, 1m build, health 200)

**API change (Batch 3 amendment):**
- `lib/data/superadmin/formula-sets.ts` — added `CreateFormulaSetInput` (no `version`); changed `createFormulaSet` to run a `$transaction`: `aggregate MAX(version) → insert with maxV+1 (or 1 for new name)`. Old `FormulaSetInput` unchanged (used by update's `Partial<>` type).
- `app/api/v1/superadmin/formula-sets/route.ts` — removed `version` required-field check from POST; if client sends `version` it is silently ignored; passes `{ name, body }` to DAL. P2002 handler kept for edge-case race protection.
- `tests/e2e/superadmin-formula-sets.spec.ts` — replaced old T4 ("same name+version → 409") with T4a ("new name → v1") and T4b ("existing name → auto-increments to v2"); both use separate name families (`TEST_SET_NAME-v1check`, `TEST_SET_NAME-incr`) to avoid sequencing conflict with T8 (which patches `createdSetId` from T3 to version=2). T3 updated to send no `version` field.
- `quotation-system-docs/design-docs/sql-queries/by-page.sql` — updated `createFormulaSet` SQL to show the two-step transaction (SELECT MAX + INSERT). Docs repo commit `8b2ad0b`.

Decision: silently ignore `version` if client sends it (not reject) — simpler guard, clearly documented in route comment and plan-b4.md.

**UI screens:**
- `app/controls/(authenticated)/formula-sets/page.tsx` — list page (Server Component): table (name, version mono, status pill, in-use chips, created date, Edit/View links), `NewSetSection` below table.
- `app/controls/(authenticated)/formula-sets/actions.ts` — server actions: `createSuperAdminFormulaSet` + `updateSuperAdminFormulaSet` (both `useActionState` signature: return `{ error, validationErrors? }` on failure, `redirect` on success, `redirect /controls/login` on 401).
- `app/controls/(authenticated)/formula-sets/_new-set-section.tsx` — Client Component: name+datalist autocomplete, JSON textarea, version-is-automatic info banner, inline validation error panel, Save disabled when errors present.
- `app/controls/(authenticated)/formula-sets/[setId]/page.tsx` — detail page (Server Component): locked sets render read-only disabled inputs + `<pre>` JSON + `NewVersionButton`; unlocked sets render `EditFormulaSetForm`; metadata strip (status, in-use, created, updated/published).
- `app/controls/(authenticated)/formula-sets/[setId]/_edit-form.tsx` — Client Component: controlled name, read-only version (disabled input), JSON textarea with inline validation error panel, Save disabled when errors or pending, Cancel `<Link>` to list.
- `app/controls/(authenticated)/formula-sets/[setId]/_new-version-button.tsx` — Client Component: `fetch POST /version` → `router.push` to new set's detail page; shows inline error string on failure.
- `app/controls/(authenticated)/controls-shell.tsx` — added "Formula Sets" nav item (grid/table SVG icon) after Component Types, `/controls/formula-sets` path.
- `tests/e2e/superadmin-formula-sets-ui.spec.ts` — 5 UI-level Playwright tests: list renders rows (UI-L1); create new name → v1 (UI-C1); create existing name → v2 (UI-C2); locked set read-only + "Create new version" + no Save (UI-D1); validation error disables Save (UI-E1). All skip without SA creds.

Reused: `internalFetch` from `lib/internal-fetch.ts`; `useActionState` + `PendingOverlay(visible)` pattern from `edit-component-form.tsx`; `FormulaSetListItem`/`FormulaSetDetail` types from DAL; SA login helper from existing e2e specs; `redirect("/controls/login")` on 401 from `actions.ts`.

Verify: `npx eslint <new/changed files>` → 0 errors. `tsc --noEmit` → clean. Vercel preview READY. `/api/health` 200 `database:connected`. `/controls/formula-sets` → 307→200 (redirects to login as expected for unauthenticated). `/api/v1/superadmin/formula-sets` → 401 (auth gate). E2e (`superadmin-formula-sets`): **5/21 passed** (T1–T1e auth gates), 16 skipped (SA creds absent). Note: pre-existing lint errors in `.engineering/stage-22/prod-recon-readonly.ts` (4 `no-explicit-any`) were present before this batch and are in gitignored `.engineering/` files.

Status: **DONE**

---

**2026-09-24 — developer — Batch 5 mockup**

Role: developer (mockup-only dispatch, per S25-11)
Branch: `feature/s25-b5-org-formula-picker`

File created: `quotation-system-docs/design-docs/mockups/org-formula-picker-poc.html`

Five-tab static HTML mockup showing:
1. **Org list** — new "Formula set" column; mismatch chip (`pending`-yellow pill with warning icon) on rows where the assigned set has ComponentType gaps; "None assigned" pill for orgs with no set.
2. **Create org form** — existing fields (name, slug, admin password) plus a required formula-set `<select>` at the bottom; "Manage formula sets ↗" link opens the sets screen; picker requires a selection before submit.
3. **Edit org (clean)** — new page (doesn't exist today); name editable, slug read-only with a note it's fixed, formula-set picker pre-selected to current set, info hint that only new projects use a changed set; suspend/reactivate section coexists below the form.
4. **Edit org (mismatch, persistent indicator)** — same edit page with mismatch chip in the h1, persistent amber banner at top of page, and an open mismatch detail panel below the picker listing the three kinds of gap (missing type, missing field key, inactive field key) — each with the specific code names.
5. **Post-save mismatch warning** — same as tab 4 but with a "Saved" success toast alongside the mismatch chip, making clear the save succeeded and the warning is advisory only; detail panel copy is updated to "was saved, fix these to clear the indicator."

Design tokens and shell layout match `formula-sets-poc.html` exactly. No real app code touched.

Status: **DONE** (mockup) — awaiting human sign-off before component code

---

**2026-09-24 — developer — Batch 5 implementation**

Role: developer (implement dispatch)
Branch: `feature/s25-b5-org-formula-picker` → commit `6639049`
Preview: `https://quotation-system-o5ncza1np-vistra-indias-projects.vercel.app` (READY, ~1m build, health 200)

**Files added:**
- `app/controls/(authenticated)/orgs/_formula-set-picker.tsx` — shared client component. Two native `<select>` elements (name 2fr / version 1fr grid). Groups flat formula-set list by name with `useMemo`, sorts versions newest-first. Version select is disabled until a name is chosen. Auto-selects the first version when a name is picked. Hidden `<input name="formulaSetId">` carries the selected ID into form actions. Accepts `initialSetId` prop for pre-selection on the edit form.
- `app/controls/(authenticated)/orgs/_mismatch-chip.tsx` — server-renderable amber badge. Uses `status-pending-*` Tailwind tokens (amber, matching existing usage in component-types page).
- `app/controls/(authenticated)/orgs/[orgId]/page.tsx` — new org edit page (Server Component). Fetches org detail + formula sets in parallel. Computes initial mismatch warnings server-side via `getOrgForEdit` + `compatResultToWarnings`. Renders `EditOrgForm` with all props.
- `app/controls/(authenticated)/orgs/[orgId]/edit-org-form.tsx` — client component. `useActionState(editOrg)`. Editable name + `FormulaSetPicker` pre-selected to `activeFormulaSetId`. Read-only slug with subdomain note. Mismatch banner shown when `initialMismatches.length > 0` or after-save warnings arrive. Mismatch detail panel lists each warning item inline. "Saved" indicator appears after successful save. Suspend/reactivate section below (reuses existing `SuspendOrgButton`).

**Files modified:**
- `lib/data/superadmin/orgs.ts` — extended `OrgRow` type with `activeFormulaSetId`, `formulaSetLabel`, `hasMismatch`; updated `listAllOrganizations` to include `activeFormulaSet` + `componentTypes` in select and compute mismatch flag; added `getOrgForEdit` (returns detail + mismatch `CompatResult`); added `updateOrgSettings`; added `computeOrgMismatchWarnings` (fetches set body + org component types, calls `checkStructuralCompatibility`); added `compatResultToWarnings` (converts `CompatResult` to `OrgFormulaWarning[]`); new exported types `OrgFormulaWarning`, `OrgForEditDetail`, `UpdateOrgResult`. `createOrganizationWithDefaults` signature changed from `(name, slug, adminPassword)` to `(name, slug, adminPassword, formulaSetId: string)` — removes internal `findFirst` by `ACTIVE_FORMULA_SET_NAME`.
- `app/api/v1/superadmin/orgs/route.ts` — POST: now requires `formulaSetId` in body (400 if absent); validates it exists via `getFormulaSet` (404 if not); passes to `createOrganizationWithDefaults`; computes mismatch warnings after creation; returns `{ org, warnings }`.
- `app/api/v1/superadmin/orgs/[orgId]/route.ts` — new PATCH handler: `{ name?, formulaSetId? }` (400 if neither); validates formula set via `getFormulaSet`; calls `updateOrgSettings`; writes audit log; returns `{ org, warnings }`.
- `app/controls/(authenticated)/orgs/actions.ts` — `createOrg` now extracts and forwards `formulaSetId`; redirects to `/controls/orgs/[orgId]` on success (not `/controls/orgs`). New `editOrg` server action returns `{ saved, warnings, error }` state.
- `app/controls/(authenticated)/orgs/new/create-org-form.tsx` — accepts `formulaSets` prop; adds divider + `FormulaSetPicker` below admin password field.
- `app/controls/(authenticated)/orgs/new/page.tsx` — loads formula sets via `internalFetch` server-side; passes to `CreateOrgForm`; shows an advisory banner when no formula sets exist.
- `app/controls/(authenticated)/orgs/page.tsx` — adds "Formula Set" column (label + `MismatchChip` when mismatched, "None assigned" pill when null); adds "Edit" link per row to `/controls/orgs/[orgId]`; colSpan updated to 7.
- `tests/e2e/superadmin-orgs.spec.ts` — added `getFirstFormulaSetId` helper; updated all 4 existing create-org calls to include `formulaSetId`; added 8 new Batch 5 tests (B5-1 through B5-8): missing formulaSetId → 400; nonexistent formulaSetId → 404; valid create → 201 + warnings array; PATCH no cookie → 401; PATCH no fields → 400; PATCH nonexistent formulaSetId → 404; PATCH valid update → 200 + org + warnings; GET list includes formulaSetLabel + hasMismatch.

**Docs repo (`quotation-system-docs`):**
- `design-docs/sql-queries/by-page.sql` — appended `[Stage 25 Batch 5]` section (SQL for listAllOrganizations extended, getOrgForEdit, updateOrgSettings, computeOrgMismatchWarnings, org.update audit log). Commit `ab62c7a`.

**Reused:**
- `checkStructuralCompatibility` from `lib/formula-compat.ts` (exact reuse — no duplication of mismatch logic per stage-25.md requirement)
- `listFormulaSets` / `getFormulaSet` from `lib/data/superadmin/formula-sets.ts`
- `requireSuperAdminFromRequest` + `apiUnauthorized` / `apiBadRequest` / `apiNotFound` from `lib/superadmin-guard.ts` + `lib/api-error.ts`
- `SuspendOrgButton` from `../_suspend-button.tsx` (reused as-is on edit page)
- `internalFetch` from `lib/internal-fetch.ts`
- `useActionState` + `isPending` pattern from `edit-component-form.tsx` / existing `create-org-form.tsx`

**Decision taken:** `formulaSetId` is required on POST /orgs (not optional with fallback to `ACTIVE_FORMULA_SET_NAME`). The `ACTIVE_FORMULA_SET_NAME` import removed from `lib/data/superadmin/orgs.ts`. Org creation now always requires an explicit choice — this is correct per S25-3 and the approved mockup's "formula set field is required" note.

**Verify:**
- `npm run lint` → 0 new errors (4 pre-existing in `.engineering/stage-22/prod-recon-readonly.ts`, gitignored file, unchanged)
- `tsc --noEmit` → clean (no output)
- Vercel preview `quotation-system-o5ncza1np-vistra-indias-projects.vercel.app` → READY (~1min build)
- `/api/health` → 200 `database:connected`
- `GET /api/v1/superadmin/orgs` → 401 (auth gate confirmed)
- `PATCH /api/v1/superadmin/orgs/any-id` → 401 (new endpoint auth gate confirmed)

Status: **DONE**

---

**2026-09-24 — reviewer — R2 checkpoint (Batches 3–5)**

Role: reviewer
Verdict: **CHANGES-NEEDED** — 0 CRITICAL · 3 IMPORTANT · 5 MINOR
Report: `.engineering/stage-25/review-r2.md`
Static: `tsc --noEmit` clean, `eslint` on the changed areas clean. No migration in the diff (S25-10 OK).

---

**2026-09-24 — developer — R2 fix round (feature/s25-r2-fixes)**

Role: developer
Branch: `feature/s25-r2-fixes` (cut off `release/stage-25` with Batches 1–5 merged)
Commit: `8860d72` (app); docs repo commit `6df6650` (by-page.sql only)
Preview: `https://quotation-system-bo2okbq35-vistra-indias-projects.vercel.app` — READY, health ✓

**Findings addressed:**

- **Finding 1 (IMPORTANT)** — `app/controls/(authenticated)/formula-sets/_new-set-section.tsx`:
  Added controlled `name`/`body` state (React 19 fix); replaced the broken `localValidationErrors`
  flag with dismiss-by-identity pattern (`dismissed === state`). Create now re-enables after any
  keystroke following a validation error; textarea content survives a failed submit.

- **Finding 2 (IMPORTANT)** — `app/controls/(authenticated)/formula-sets/[setId]/_edit-form.tsx`:
  Replaced sticky `bodyCleared` boolean with same dismiss-by-identity pattern; made `body` a
  controlled `useState(initialBodyJson)` with `value`/`onChange`. Textarea no longer reverts to
  original value on a failed save. UI-E1 test should now pass with SA creds.

- **Finding 3 (IMPORTANT)** — `tests/e2e/helpers.ts`, `superadmin-orgs.spec.ts`,
  `stage23-summary.spec.ts`, `superadmin-roles.spec.ts`:
  Added shared `getSeededFormulaSetId(request, token)` to `helpers.ts` — filters formula-sets
  list for `name === "glass-partition-standard"` and takes the highest version, bypassing any
  junk e2e sets. Replaced `superadmin-orgs.spec.ts`'s private `getFirstFormulaSetId` with the
  shared helper. Added `formulaSetId` to the org-create calls in `stage23-summary.spec.ts`
  (beforeAll, SA section) and `superadmin-roles.spec.ts` (`createTestOrg`).

- **Finding 5 (MINOR)** — `quotation-system-docs/design-docs/sql-queries/by-page.sql`:
  Removed stale Step 1.5 (the `ACTIVE_FORMULA_SET_NAME` findFirst is gone; replaced with the
  existence check the route now performs). Fixed `listAllOrganizations` SQL: replaced the
  `LEFT JOIN ComponentType` (which produced N×M rows) with a correlated subquery.

- **Finding 8 (MINOR)** — `app/controls/(authenticated)/orgs/[orgId]/edit-org-form.tsx`:
  Updated both mismatch banner messages from "New projects will fail to compute until resolved"
  to "New projects cannot be created under this org until this is resolved." (project creation
  is refused 409, not silently allowed and then failing at compute time).

**Not addressed (per scope):**
- Finding 4 — test coverage nice-to-have; not in scope.
- Finding 6 — snapshot-builder duplication; not in scope.
- Finding 7 — **CARRY-FORWARD for human decision**: `app/controls/(authenticated)/orgs/[orgId]/page.tsx`
  reads the DB directly via `getOrgForEdit()` instead of going through `app/api/v1/**`. This is an
  architecture-pattern inconsistency (Stage 12 rule). Not a security hole (SuperAdmin layout still
  guards it), and the stage doc doesn't require it to be fixed now. Decision: add a dedicated
  `GET /api/v1/superadmin/orgs/[orgId]` route and fetch through it, or deliberately document the
  exception. Recommend the human weighs in before Batch 7 or at end-of-stage cleanup.

**Verify:**
- `tsc --noEmit` — clean
- `npm run lint` — 0 new errors (4 pre-existing `no-explicit-any` in `.engineering/stage-22/prod-recon-readonly.ts`)
- E2E against preview: 22 passed, 41 skipped (SA creds absent in local env — expected),
  0 failed. SA-gated tests (formula-set UI + org create + roles isolation) will exercise at
  `engineering:test` on `test.easeetool.com` with real creds.

Status: **DONE**

---

**2026-09-24 — reviewer — R2 re-review (fix round `8860d72` + docs `6df6650`)**

Role: reviewer · Verdict: **CHANGES-NEEDED** · 0 CRITICAL / 1 IMPORTANT / 1 MINOR · report: `review-r2-v2.md`.
The R2 findings 1, 2, 3, 5 and 8 are verified fixed. New: the reserved-slug e2e test (`superadmin-orgs.spec.ts:112`) sends no `formulaSetId` and now fails, and the invalid-slug test passes for the wrong reason.
