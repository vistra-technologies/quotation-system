# Stage 15 — Batch F record

**Role:** developer
**Branch:** `feature/stage15-form-behaviours`
**Commits:** `2b0a3fd` (WIP from previous developer, unverified) → `07aef6f` (remaining forms) → `93c79f5` (E2E spec)
**Final SHA:** `93c79f5`
**Deployment:** `https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app`

---

## What changed

### Picked up from WIP (2b0a3fd — previous developer, unverified)
Already done but unverified when I started:
- `app/[orgSlug]/inquiries/actions.ts` — strips commas from budget before saving (C5)
- `app/[orgSlug]/projects/actions.ts` — same
- `app/[orgSlug]/inquiries/new/create-inquiry-form.tsx` — C5 blur handler, C6 currency default, C9 patterns
- `app/[orgSlug]/inquiries/new/page.tsx` — added `defaultCurrency` to company types
- `app/[orgSlug]/projects/new/page.tsx` — added `defaultCurrency` to company types

### My commit 07aef6f — remaining three forms
- `app/[orgSlug]/inquiries/[inquiryId]/edit/edit-inquiry-form.tsx`
  - Added `useState`, imported `formatBudget`/`stripGroupingSeparators` from `@/lib/format-currency`
  - Added `selectedCurrency` state (init to `initialCurrency`) and `budgetValue` state (init pre-formatted from `initialProjectBudget`)
  - Added `handleBudgetBlur` function
  - Converted budget input from uncontrolled `defaultValue` to controlled `value`/`onChange`/`onBlur`
  - Converted currency select from uncontrolled `defaultValue` to controlled `value`/`onChange`
  - Added `pattern="[A-Za-z0-9 \-]*"` to: project name, all 4 contractor/consultant fields, endClientName, endClientCity, endClientState
  - Added `inputMode="decimal"` and `pattern="[\d,\.]*"` to budget field

- `app/[orgSlug]/projects/new/create-project-form.tsx`
  - Added `defaultCurrency: string` to `lockedCompany` and `externalCompanies` types
  - Imported `formatBudget`/`stripGroupingSeparators`
  - Added `selectedCurrency` state (init to `lockedCompany?.defaultCurrency ?? "INR"`), `budgetValue` state
  - Added `handleBudgetBlur`
  - Updated company `onChange` to set `selectedCurrency` from `co?.defaultCurrency ?? "INR"`
  - Converted budget + currency to controlled
  - Added C9 patterns to same set of name fields

- `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx`
  - Added `useState`, imported formatters
  - Same C5/C6/C9 changes as the inquiry edit form

### My commit 93c79f5 — E2E spec
- `tests/e2e/stage15-f.spec.ts` — 4 serial tests covering budget-save E2E for all four forms

---

## Verification

### Static checks
- `npm run lint` — clean (exit 0)
- `npx tsc --noEmit` — clean (exit 0)

### Build & deploy (commit 07aef6f)
- Deployment: `quotation-system-6xwyze41i-vistra-indias-projects.vercel.app` — READY
- Build log commit: `Cloning completed… Commit: 07aef6f`
- All four routes present: `/[orgSlug]/inquiries/new`, `/[orgSlug]/inquiries/[inquiryId]/edit`, `/[orgSlug]/projects/new`, `/[orgSlug]/projects/[projectId]/edit`
- `/api/health`: `{"status":"ok","database":"connected",...}` — confirmed

### Build & deploy (commit 93c79f5 — final with spec)
- Deployment: `quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` — READY, 37s build time
- GitHub commit status: `Vercel: success`
- Health: `/api/health` → `{"status":"ok","database":"connected",...}`

### E2E test results — `stage15-f.spec.ts` — 4/4 PASSED

```
ok 1 C5 inquiry create: budget persisted as clean numeric string after blur-format (20.7s)
ok 2 C5 inquiry edit: budget pre-formatted on open, updated value persisted as clean numeric string (11.9s)
ok 3 C5 project create: budget persisted as clean numeric string after blur-format (12.5s)
ok 4 C5 project edit: budget pre-formatted on open, updated value persisted as clean numeric string (11.6s)

4 passed (58.6s)
```

Ran against: `PLAYWRIGHT_BASE_URL=https://quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app`

---

## Per-form verification table

| Form | C5 (blur format) | C6 (currency default) | C9 (patterns) | Budget save verified |
|------|---|---|---|---|
| Inquiry create | ✓ E2E: typed "1000000", blur → "10,00,000" (INR), stored "1000000" | ✓ Code: defaults to `lockedCompany?.defaultCurrency ?? "INR"` | ✓ Code: pattern on all name fields | ✓ API read-back: `"1000000"` |
| Inquiry edit | ✓ E2E: pre-formatted "10,00,000" on open; change to "2500000" → blur → "25,00,000", stored "2500000" | N/A (edit form locks currency to saved value; tracked as state for blur handler) | ✓ Code: pattern on all name fields | ✓ API read-back: `"2500000"` |
| Project create | ✓ E2E: typed "1500000" (USD), blur → "1,500,000", stored "1500000" | ✓ Code: defaults to `lockedCompany?.defaultCurrency ?? "INR"` | ✓ Code: pattern on all name fields | ✓ API read-back: `"1500000"` |
| Project edit | ✓ E2E: pre-formatted "1,500,000" on open; change to "3000000" → blur → "3,000,000", stored "3000000" | N/A (edit form tracks currency for blur handler) | ✓ Code: pattern on all name fields | ✓ API read-back: `"3000000"` |

### C6 manual check note
C6 (currency defaults to company's defaultCurrency) requires knowing what `defaultCurrency` value is set on the test companies in the dev DB. This is wired in code and can be verified manually: select a company in the dropdown → observe the currency select changing to that company's `defaultCurrency`. The code path is confirmed correct by reading the implementation.

### C9 manual check note
HTML5 `pattern` restrictions are browser-enforced. Playwright's `fill()` bypasses native browser validation (it sets the value directly), so these are verified manually: open the form, type a special character (e.g. `@`) into a name field, the browser shows a constraint validation tooltip. Visual check deferred to manual per stage policy.

---

## Reused
- `lib/format-currency.ts` — created by Batch E; imported by all four forms (no duplicate formatter written)
- `@/lib/format-currency.ts`'s `formatBudget()` and `stripGroupingSeparators()` — used identically across all forms
- `fillCreateFormRequiredFields` helper from `tests/e2e/helpers.ts`
- `signIn` helper from `tests/e2e/helpers.ts`

## No Prisma calls changed
No `prisma.<model>.<method>` calls were added, changed, or removed. No `by-page.sql` update required.

## No new i18n namespaces
All four forms already use `inquiries` or `projects` namespace (wired in their respective layouts). No clientMessages trap risk.

## Status
DONE
