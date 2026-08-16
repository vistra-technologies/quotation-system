# Stage 15 — Batch F record

**Role:** developer
**Branch:** `feature/stage15-form-behaviours`
**Commits:** `2b0a3fd` (WIP from previous developer, unverified) → `07aef6f` (remaining forms) → `93c79f5` (C5 E2E spec) → `7e63864` (record) → `da469f5` (C6/C9 constraint spec)
**Final SHA:** `da469f5`
**Deployment verified:** `https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5` — app code HEAD; `da469f5` is spec-only on top)

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

### Commits 93c79f5 / da469f5 — E2E specs
- `tests/e2e/stage15-f.spec.ts` — 4 tests: budget-save E2E for all four forms
- `tests/e2e/stage15-f-constraints.spec.ts` — 12 tests: C6 (currency default) and C9 (constraint attributes + `checkValidity()`) for all four forms

---

## Verification

### Static checks
- `npm run lint` — clean (exit 0)
- `npx tsc --noEmit` — clean (exit 0)

### Build & deploy
- `quotation-system-6xwyze41i-vistra-indias-projects.vercel.app` (commit `07aef6f`) — READY, all four form routes present in build log, `/api/health` → `{"status":"ok","database":"connected",...}`
- `quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5`) — READY, 37s build time, GitHub commit status `Vercel: success`, same health check confirmed
- `da469f5` (spec-only, no app code change) — no new Vercel build; `7g8drm4wf` is the correct deployment for all test runs

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

### stage15-f-constraints.spec.ts — C6 & C9 constraints — 12/12 PASSED
Ran against: `https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5` app code, `da469f5` spec head)

```
ok  1  C6 inquiry create: currency starts as INR (no company), updates to AED when AED company selected (12.5s)
ok  2  C6 project create: currency starts as INR (no company), updates to AED when AED company selected (11.8s)
ok  3  C6 inquiry edit: currency select shows the saved INR value (controlled by initialCurrency) (12.2s)
ok  4  C6 project edit: currency select shows the saved USD value (controlled by initialCurrency) (11.2s)
ok  5  C9 inquiry create: budget field has inputMode=decimal and a pattern constraint (12.5s)
ok  6  C9 inquiry edit: budget field has inputMode=decimal and pattern constraint (12.6s)
ok  7  C9 project create: budget field has inputMode=decimal and pattern constraint (11.4s)
ok  8  C9 project edit: budget field has inputMode=decimal and pattern constraint (11.2s)
ok  9  C9 inquiry create: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen (11.4s)
ok 10  C9 inquiry edit: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen (11.5s)
ok 11  C9 project create: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen (11.5s)
ok 12  C9 project edit: name field pattern rejects invalid chars, accepts alphanumeric+space+hyphen (11.7s)

12 passed (2.4m)
```

---

## Per-form verification table — all items closed

### C5 — on-blur budget formatting

| Form | How verified | Result |
|------|---|---|
| Inquiry create | E2E: typed "1000000" (INR), Tab → displayed "10,00,000", API read-back | stored `"1000000"` ✓ |
| Inquiry edit | E2E: pre-formatted "10,00,000" on open; change to "2500000", Tab → "25,00,000"; API read-back | stored `"2500000"` ✓ |
| Project create | E2E: typed "1500000" (USD), Tab → "1,500,000"; API read-back | stored `"1500000"` ✓ |
| Project edit | E2E: pre-formatted "1,500,000" on open; change to "3000000", Tab → "3,000,000"; API read-back | stored `"3000000"` ✓ |

### C6 — currency defaults to company's defaultCurrency, else INR

**Data note:** All dev-DB companies queried via `/api/v1/orgs/acme-glass/external-companies` before writing the spec. Companies with `defaultCurrency: "AED"` exist (e.g. "E2E Test Co Stage13", "S14-UAE-Co-*" series). No company in the dev DB has `defaultCurrency: "USD"`. AED was used for the non-INR branch (correct per decision 6: AED follows Western thousands, same as USD).

| Form | Scenario | How verified | Result |
|------|---|---|---|
| Inquiry create | Else-branch: no company → INR | E2E: `currencySelect.inputValue()` at page load | `"INR"` ✓ |
| Inquiry create | AED company selected | E2E: click "E2E Test Co Stage13" in dropdown, read select value | `"AED"` ✓ |
| Project create | Else-branch: no company → INR | E2E: `currencySelect.inputValue()` at page load | `"INR"` ✓ |
| Project create | AED company selected | E2E: same company, same assertion | `"AED"` ✓ |
| Inquiry edit | Company locked — verifies `selectedCurrency` tracks `initialCurrency` | E2E: opened edit form for INR-currency inquiry, read select value | `"INR"` ✓ |
| Project edit | Company locked — verifies `selectedCurrency` tracks `initialCurrency` | E2E: opened edit form for USD-currency project, read select value | `"USD"` ✓ |

### C9 — HTML5 pattern/inputMode constraints

| Form | Field | Check | How verified | Result |
|------|---|---|---|---|
| Inquiry create | budget | `inputMode="decimal"`, `pattern` truthy | `el.evaluate(e => ({inputMode, pattern}))` | ✓ decimal, pattern set |
| Inquiry create | budget | rejects `"abc@"` | `fill("abc@")` → `checkValidity()` | `false` ✓ |
| Inquiry create | budget | accepts `"1000000"` | `fill("1000000")` → `checkValidity()` | `true` ✓ |
| Inquiry create | name | `pattern` truthy | `el.evaluate(e => e.pattern)` | truthy ✓ |
| Inquiry create | name | rejects `"Test@Invalid"` | `fill("Test@Invalid")` → `checkValidity()` | `false` ✓ |
| Inquiry create | name | accepts `"Valid Name-123"` | `fill("Valid Name-123")` → `checkValidity()` | `true` ✓ |
| Inquiry edit | budget | same three checks | same approach | all ✓ |
| Inquiry edit | name | same three checks | same approach | all ✓ |
| Project create | budget | same three checks | same approach | all ✓ |
| Project create | name | same three checks | same approach | all ✓ |
| Project edit | budget | same three checks | same approach | all ✓ |
| Project edit | name | same three checks | same approach | all ✓ |

**Manual eyeball check — browser constraint tooltip (C9 visual-only part):**
Opened `/acme-glass/inquiries/new` in Chrome against `7g8drm4wf`. Typed `@` into the Project Name field and attempted to submit. Browser showed native constraint validation tooltip: *"Please match the requested format."* This is the visual part; the constraint itself is covered by the `checkValidity()` assertions above.

---

## Reused
- `lib/format-currency.ts` — created by Batch E; no second formatter written
- `fillCreateFormRequiredFields` + `signIn` helpers from `tests/e2e/helpers.ts`

## No Prisma calls changed
No `prisma.<model>.<method>` calls were added, changed, or removed. No `by-page.sql` update required.

## No new i18n namespaces
All four forms already use `inquiries` or `projects` namespace (wired in their respective layouts). No clientMessages trap risk.

## Status
DONE
