# Stage 15 — Bug Report (engineering:test pass)

**Tester:** engineering:tester  
**Date:** 2026-08-17  
**Branch:** `release/stage-15` @ `736059b` (includes tester's two spec fixes)  
**Deployment tested:** `quotation-system-23mbbpo11-vistra-indias-projects.vercel.app` (READY, 137+ routes, `database: "connected"`)  
**Full suite:** 211 tests (213 − 2 stale tests removed) · 198 passed · 3 rate-limit flakes · 10 not-run  

---

## Executive summary

Two MAJOR regressions in `tests/e2e/stage14.spec.ts` were found and fixed during this test pass (commit `736059b`, pushed to `release/stage-15`). Both were caused by Stage 15 production changes that were correct but did not update the Stage 14 regression spec. One MINOR test design flaw remains in `stage15-f-constraints.spec.ts`. All Stage 15 product behaviors verified correct.

---

## MAJOR — Found and Fixed

### [MAJOR — FIXED] stage14.spec.ts permanently failing: V3 and C9 broke Stage 14 regression tests

**Summary:** Stage 15's two most impactful changes (V3: remove destination country from inquiry view; C9: add HTML5 pattern restrictions to name/budget fields) both broke committed Stage 14 regression tests. Neither was updated as part of the implement phase.

**Impact:** Before this fix, `stage14.spec.ts` had two permanent failures that (due to `test.describe.configure({ mode: "serial" })`) blocked 10 additional tests from running — including cross-org tenancy isolation tests (×2), GST conditional validation (×3), inquiry→project conversion (×1), and Batch D behavior tests (×3). Effectively 12 of 15 tests in the file were broken.

**Repro — Failure 1 (V3):**
```
PLAYWRIGHT_BASE_URL=<preview> npx playwright test tests/e2e/stage14.spec.ts
```
Test `stage14.spec.ts:138` ("destinationCountry: INDIA company shown as India on inquiry detail") fails:
```
Error: expect(locator).toBeVisible() failed
Locator: getByText('India', { exact: true }).first()
Expected: visible
Timeout: 10000ms
element(s) not found
```
Root cause: Stage 15 Batch A (V3) removed `destinationCountry` from the inquiry detail page UI (`inquiries/[inquiryId]/page.tsx:216`), but Stage 14's spec still asserted it was visible. The UAE variant at line 160 would also fail. The product change is correct; the spec was stale.

**Repro — Failure 2 (C9):**
After the V3 tests are removed, `stage14.spec.ts:212` ("convertInquiryToProject") fails:
```
TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
waiting for navigation until "load"
```
Root cause: Stage 15 Batch F (C9) added `pattern="[A-Za-z0-9 \-]*"` to name/city/state fields and `pattern="[\d,\.]*"` to the budget field. The Stage 14 convertInquiryToProject test used sentinel values with underscores (`MAIN_CONTRACTOR_SENTINEL`, `CITY_SENTINEL`, etc.) and a non-numeric budget (`BUDGET_SENTINEL_XYZ`). The browser's HTML5 validation silently blocked form submission, causing the waitForURL timeout.

**Fix applied (commit `736059b`):**
1. Removed the two stale destination-country display tests (`:138` and `:160`). Added a comment explaining V3. The invariant that destination country is not user-editable is preserved by the API-level test at the same section and by the project detail assertion in the conversion test.
2. Updated the convertInquiryToProject sentinel values: underscores → hyphens for pattern-restricted fields (`MAIN-CONTRACTOR-SENT`, `INT-CONTRACTOR-SENT`, etc.); budget changed to numeric `9988776655`. Added explanatory comments.

**Post-fix result:** All 13 tests in `stage14.spec.ts` pass in isolation (confirmed).

**Suspected area:** `tests/e2e/stage14.spec.ts`. The implement phase should have updated this file when Batch A (V3) and Batch F (C9) landed.

---

## MINOR — Not Fixed (recommended future action)

### [MINOR] stage15-f-constraints.spec.ts:308 has a cross-file ordering dependency

**Summary:** The C9 inquiry edit test (`stage15-f-constraints.spec.ts:308`) searches for an inquiry named `C5-inq-create-*` using `pageSize=20`. This inquiry is created by a different spec file (`stage15-f.spec.ts`). In a full 8-worker parallel suite, this test occasionally runs before `stage15-f.spec.ts` has created the inquiry, or before it appears on page 1 of results.

**Repro:** Fails on isolated invocation (`npx playwright test "tests/e2e/stage15-f-constraints.spec.ts:308"`) — the inquiry doesn't exist or isn't in the top 20. Fails ~1 in 3 full parallel suite runs (race condition with concurrent inquiry creation pushing the target off page 1). Passes when running the full `stage15-f-constraints.spec.ts` file alone (old inquiries from previous suite runs are in the DB).

**Expected:** The test should find a real inquiry to verify the edit form's pattern restriction, regardless of test execution order.

**Actual:** `expect(c5Inquiry).toBeTruthy()` fails when the inquiry isn't in the first 20 results.

**Suspected area:** `tests/e2e/stage15-f-constraints.spec.ts:308-318`. Fix: change the API call to use a larger `pageSize` (e.g., 100) or look for any existing inquiry rather than a specific named one.

---

### [MINOR] Local `npx tsc --noEmit` gives misleading type errors (stale Prisma generated client)

**Summary:** Running `npx tsc --noEmit` locally produces 6 type errors in `lib/data/users.ts` and `prisma/seed.ts` because the locally cached Prisma generated client (in `app/generated/prisma/`, which is gitignored) was generated before Batch G added `isInternalRole` to the schema.

**Repro:**
```
npx tsc --noEmit
```
Errors:
```
lib/data/users.ts(71,25): error TS2353: 'isInternalRole' does not exist in type 'RoleSelect<DefaultArgs>'
lib/data/users.ts(76,13): error TS2339: Property 'isInternalRole' does not exist on type '{ name: string; id: string; ... }'
[+ 4 similar errors in users.ts and prisma/seed.ts]
```

**Expected:** `tsc --noEmit` passes after running `npx prisma generate`.

**Actual:** Fails with false positives when the generated client is stale. This requires a DB connection to fix locally, making `tsc --noEmit` unreliable as a pre-push check after schema changes.

**Note:** This does NOT affect Vercel builds — `npm run build` runs `prisma generate` first. The errors are only local.

**Suspected area:** Developer workflow. Consider documenting that `tsc` requires a recent `prisma generate` after schema changes, or adding a `postinstall` / dev-startup note.

---

## Infrastructure finding (resolved)

**Vercel builds for `release/stage-15` were in Error state** when testing began. All builds triggered after Batches F and H were merged (commits `a14e4dc` and `a7ed9ff`) failed — the branch had no READY deployment for the fully merged 8-batch code. Root cause: P1002 Neon advisory-lock contention (documented transient). Applied the established remedy (empty retrigger commit `60deb04`), which produced a READY deployment (`hpbjjdyf6`) used for all testing.

Note: The Batch H developer's full-suite run was against `feature/stage15-test-harness` (not against the merged `release/stage-15`). The current test pass is the first time all 8 batches were exercised together in an integrated deployment. This integration surface is where both regressions were discovered.

---

## What was verified (all passing)

All Stage 15 product behaviors exercised end-to-end on the merged deployment:

| Area | Tests | Result |
|---|---|---|
| D1/D2/D3/D4 — dashboard greeting, stats scoping, org pills | `stage15-b.spec.ts` (2 tests) | PASS |
| L1/PL1 — pagination boundary, ≤10 per page | `stage15.spec.ts` (3 tests) | PASS |
| C10 — Address Line 2 optional | `stage15.spec.ts` (1 test) | PASS |
| C5/C6 — budget save round-trip (4 forms) | `stage15-f.spec.ts` (4 tests) | PASS |
| C6 constraints (C6/C9 patterns) | `stage15-f-constraints.spec.ts` (11/12 pass; test 308 flaky — see MINOR) | PASS* |
| U3/U4/U5/U6 — user management, profile endpoint | `stage15-user-mgmt.spec.ts` (6 tests) | PASS |
| X5 — positive tenancy assertion on users list | `admin-stage4.spec.ts:187` | PASS |
| X6 — hardened signIn helper (stage6.spec.ts:379) | `stage6.spec.ts:379` | PASS |
| V3 — destination country removed from inquiry detail | Code inspection + test fix | CONFIRMED |
| Health endpoint | `GET /api/health` | `database: "connected"` |
| Auth, RBAC, cross-org tenancy | Full suite | PASS |
| E2E: all of Stages 3–15 regression suite | 211 tests | 198 pass, 3 rate-limit flakes, 10 not-run |

---

## Rate-limit baseline (not regressions)

3 failures in the final full suite run are rate-limit flakes, not product bugs:
- `login.spec.ts:201` — inline sign-in without hardened helper (known, pre-Stage-15)
- `org-nav.spec.ts:259` — inline sign-in without hardened helper (known, pre-Stage-15)
- `stage15-f-constraints.spec.ts:308` — cross-file ordering dependency (see MINOR above)

These are equal to or fewer than the 5 known baseline failures from Batch H's runs. The X6 fix is working; `stage6.spec.ts:379` passed in all runs.

**Three inline-signIn spec files** (`login.spec.ts`, `org-nav.spec.ts`, `pricing-stage3.spec.ts`) remain the source of persistent rate-limit flakiness and are the human's call to fix (noted as deferred in the worklog).

---

## Recommended coverage gaps

1. **stage15-f-constraints.spec.ts:308** — Fix the cross-file dependency: query a larger page or find any existing inquiry for the C9 edit form check.
2. **Post-schema-change tsc guidance** — Document that `npx tsc --noEmit` requires a fresh `prisma generate` when the schema has changed and the generated client is stale.
3. **PV1** — Wizard breadcrumb highlight on Project Details: still owes the human's own visual verification against `test.easeetool.com` (no automated check, as noted in Batch A's close-out).

---

## Verdict

**FAIL** — Two MAJOR spec regressions were found during this pass. Both were caused by Stage 15 production changes (V3, C9) that did not update the Stage 14 regression spec. Both are **fixed** in commit `736059b` on `release/stage-15`. Post-fix deployment `23mbbpo11` is READY and verified healthy. No CRITICAL or MAJOR issues remain. One MINOR test design flaw and one MINOR local tooling issue are documented above.
