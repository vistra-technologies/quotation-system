# Stage 15 — Batch F record

**Role:** developer
**Branch:** `feature/stage15-form-behaviours`
**Commits:** `2b0a3fd` (WIP from previous developer, unverified) → `07aef6f` (remaining forms) → `93c79f5` (C5 E2E spec) → `7e63864` (record) → `da469f5` (C6/C9 constraint spec) → `a1f8456` (record update) → HEAD (nit fixes — see below)
**Deployment verified (app code):** `https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5`)

---

## What changed

### Picked up from WIP (2b0a3fd — previous developer, unverified)
- `app/[orgSlug]/inquiries/actions.ts` — strips commas from budget before saving (C5)
- `app/[orgSlug]/projects/actions.ts` — same
- `app/[orgSlug]/inquiries/new/create-inquiry-form.tsx` — C5 blur handler, C6 currency default, C9 patterns
- `app/[orgSlug]/inquiries/new/page.tsx` — added `defaultCurrency` to company types
- `app/[orgSlug]/projects/new/page.tsx` — added `defaultCurrency` to company types

### Commit 07aef6f — remaining three forms
- `app/[orgSlug]/inquiries/[inquiryId]/edit/edit-inquiry-form.tsx`
  - Added `useState`, imported `formatBudget`/`stripGroupingSeparators` from `@/lib/format-currency`
  - Added `selectedCurrency` state (init to `initialCurrency`) and `budgetValue` state (init pre-formatted from `initialProjectBudget`)
  - Added `handleBudgetBlur`
  - Converted budget + currency from uncontrolled to controlled
  - Added `pattern="[A-Za-z0-9 \-]*"` to project name, all 4 contractor/consultant fields, endClientName, endClientCity, endClientState
  - Added `inputMode="decimal"` and `pattern="[\d,\.]*"` to budget field

- `app/[orgSlug]/projects/new/create-project-form.tsx`
  - Added `defaultCurrency: string` to `lockedCompany` and `externalCompanies` types
  - Imported `formatBudget`/`stripGroupingSeparators`
  - Added `selectedCurrency` state (init to `lockedCompany?.defaultCurrency ?? "INR"`), `budgetValue` state
  - Added `handleBudgetBlur`
  - Updated company `onChange` to set `selectedCurrency` from `co?.defaultCurrency ?? "INR"`
  - Converted budget + currency to controlled; C9 patterns on all name fields

- `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx`
  - Added `useState`, imported formatters; same C5/C6/C9 changes as inquiry edit form

### Commits 93c79f5 / da469f5 — E2E specs (initial)
- `tests/e2e/stage15-f.spec.ts` — 4 tests: budget-save E2E for all four forms
- `tests/e2e/stage15-f-constraints.spec.ts` — 12 tests: C6 and C9 for all four forms

### HEAD (nit fixes — APPROVE-WITH-NITS review response)
Changes to `tests/e2e/stage15-f-constraints.spec.ts`:
- Removed unused `fillCreateFormRequiredFields` import (review nit: lint warning)
- Tests 1 & 2 (C6 create): dropped the "INR at page load" first sub-assertion, which was not reliably falsifiable (Chrome picks first non-disabled option regardless of state). The load-bearing assertion ("AED after company selection") is retained.
- Tests 3 & 4 (C6 edit): replaced read-only `inputValue()` assertions (which passed on revert since `defaultValue` and `value` produce the same Playwright `inputValue()`) with behavioral assertions: change currency select → fill budget → press Tab → assert re-formatted display uses the new currency's grouping. Inquiry edit: INR→AED switch, "1000000" → expect "1,000,000". Project edit: USD→INR switch, "1000000" → expect "10,00,000". These fail on revert because the old `defaultValue={initialCurrency}` approach means `handleBudgetBlur` reads the stale initial value, not the user's new selection.
- **These replacement tests (3 & 4) are UNVERIFIED — not run per coordinator instruction (Batch H holds the shared dev Neon branch for its full suite run). The spec is committed; Playwright run is pending coordinator green-light.**

---

## Verification

### Static checks
- `npm run lint` — 4 warnings (all pre-existing), 0 errors; the `fillCreateFormRequiredFields` warning from `da469f5` is now gone (exit 0)
- `npx tsc --noEmit` — clean (exit 0)

### Build & deploy (app code — no new Vercel build for spec-only commits)
- `quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5`) — READY, 37s build time, GitHub commit status `Vercel: success`, `/api/health` → `{"status":"ok","database":"connected",...}`

---

## E2E test results

### stage15-f.spec.ts — C5 budget save — 4/4 PASSED
Ran against: `https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5`)

```
ok 1 C5 inquiry create: budget persisted as clean numeric string after blur-format (20.7s)
ok 2 C5 inquiry edit: budget pre-formatted on open, updated value persisted as clean numeric string (11.9s)
ok 3 C5 project create: budget persisted as clean numeric string after blur-format (12.5s)
ok 4 C5 project edit: budget pre-formatted on open, updated value persisted as clean numeric string (11.6s)

4 passed (58.6s)
```

### stage15-f-constraints.spec.ts — C6 & C9 constraints

**Initial run (da469f5, before nit fixes) — 12/12 PASSED** against `https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app`

Tests 3 & 4 (C6 edit) were then replaced (HEAD commit). The replacement tests are **UNVERIFIED — pending coordinator green-light for Playwright run**.

Tests 1, 2, 5–12 are unchanged from the passing run; the only spec change in those tests is dropping one weak sub-assertion from tests 1 & 2.

---

## Per-form verification table — all items

### C5 — on-blur budget formatting

| Form | How verified | Result |
|------|---|---|
| Inquiry create | E2E: typed "1000000" (INR), Tab → displayed "10,00,000", API read-back | stored `"1000000"` ✓ |
| Inquiry edit | E2E: pre-formatted "10,00,000" on open; change to "2500000", Tab → "25,00,000"; API read-back | stored `"2500000"` ✓ |
| Project create | E2E: typed "1500000" (USD), Tab → "1,500,000"; API read-back | stored `"1500000"` ✓ |
| Project edit | E2E: pre-formatted "1,500,000" on open; change to "3000000", Tab → "3,000,000"; API read-back | stored `"3000000"` ✓ |

### C6 — currency defaults to company's defaultCurrency, else INR

**Data note:** All dev-DB companies queried via `/api/v1/orgs/acme-glass/external-companies` before writing the spec. Companies with `defaultCurrency: "AED"` exist (e.g. "E2E Test Co Stage13"). No company in the dev DB has `defaultCurrency: "USD"`. AED was used for the non-INR branch in create-form tests.

| Form | Scenario | How verified | Result |
|------|---|---|---|
| Inquiry create | AED company selected | E2E (da469f5): click "E2E Test Co Stage13" in dropdown, read select value | `"AED"` ✓ |
| Project create | AED company selected | E2E (da469f5): same company, same assertion | `"AED"` ✓ |
| Inquiry edit | Change currency INR→AED, blur budget "1000000", check display | UNVERIFIED (spec replaced at HEAD; pending Playwright run) | — |
| Project edit | Change currency USD→INR, blur budget "1000000", check display | UNVERIFIED (spec replaced at HEAD; pending Playwright run) | — |

### C9 — HTML5 pattern/inputMode constraints

| Form | Field | Check | How verified | Result |
|------|---|---|---|---|
| Inquiry create | budget | `inputMode="decimal"`, `pattern` truthy | E2E (da469f5) | ✓ |
| Inquiry create | budget | rejects `"abc@"` → `checkValidity()` false | E2E (da469f5) | ✓ |
| Inquiry create | budget | accepts `"1000000"` → true | E2E (da469f5) | ✓ |
| Inquiry create | name | `pattern` truthy | E2E (da469f5) | ✓ |
| Inquiry create | name | rejects `"Test@Invalid"` → false | E2E (da469f5) | ✓ |
| Inquiry create | name | accepts `"Valid Name-123"` → true | E2E (da469f5) | ✓ |
| Inquiry edit | budget | same three checks | E2E (da469f5) | all ✓ |
| Inquiry edit | name | same three checks | E2E (da469f5) | all ✓ |
| Project create | budget | same three checks | E2E (da469f5) | all ✓ |
| Project create | name | same three checks | E2E (da469f5) | all ✓ |
| Project edit | budget | same three checks | E2E (da469f5) | all ✓ |
| Project edit | name | same three checks | E2E (da469f5) | all ✓ |

**Manual eyeball check — browser constraint tooltip (C9 visual-only part):**
Opened `/acme-glass/inquiries/new` in Chrome against `7g8drm4wf`. Typed `@` into the Project Name field and attempted to submit. Browser showed native constraint validation tooltip: *"Please match the requested format."*

---

## Review findings addressed (APPROVE-WITH-NITS)

| Finding | Severity | Action |
|---|---|---|
| C6 edit specs pass on revert (tests 3 & 4) | IMPORTANT | Replaced with behavioral assertion: change currency → blur budget → assert grouping matches new currency |
| Unused `fillCreateFormRequiredFields` import | MINOR | Removed from import line |
| "INR at page load" sub-assertion not reliably falsifiable | MINOR | Dropped from tests 1 & 2 |
| Spec volume (386 lines) | MINOR | Developer's call — C9 tests kept; they cover behavioral invariants (what the constraint accepts/rejects), not DOM structure or styling |

---

## Reused
- `lib/format-currency.ts` — created by Batch E; no second formatter written
- `signIn` helper from `tests/e2e/helpers.ts`

## No Prisma calls changed
No `prisma.<model>.<method>` calls were added, changed, or removed. No `by-page.sql` update required.

## Status
DONE (pending Playwright re-run for replaced C6 edit tests 3 & 4 — coordinator to green-light)
