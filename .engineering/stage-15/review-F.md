# Stage 15 — Batch F — Review

**Reviewer:** engineering:reviewer
**Branch:** `feature/stage15-form-behaviours` @ `da469f5`
**Items:** C5, C6, C9 — all four forms (inquiry create/edit, project create/edit)
**Static checks run:** `npm run lint` (5 warnings, 0 errors — 4 pre-existing; 1 new, noted below); `npx tsc --noEmit` clean.
**Date:** 2026-08-17

---

## Findings (severity-ranked)

### [IMPORTANT] C6 edit-form specs cannot detect a C6 regression — `stage15-f-constraints.spec.ts` tests 3 and 4

**File:** `tests/e2e/stage15-f-constraints.spec.ts` — "C6 inquiry edit" (test 3) and "C6 project edit" (test 4)

**What the tests assert:** Open an edit form, read `currencySelect.inputValue()`, assert it equals "INR" (or "USD").

**Why they cannot fail:** The old edit-form code used `defaultValue={initialCurrency}`. An uncontrolled select with `defaultValue` produces the same `inputValue()` result in Playwright as a controlled `value={selectedCurrency}`. Reverting `value={selectedCurrency}` to `defaultValue={initialCurrency}` leaves both tests green — they test what the DB holds, not how the form manages that state.

The implementation is correct — `selectedCurrency` state IS necessary on edit forms because `handleBudgetBlur` reads it to format correctly when the user changes the currency select before blurring the budget. But that behavior (change currency → blur budget → re-format using new currency) is not tested anywhere.

**Suggested fix:** Replace the read-only `inputValue()` assertions with a behavioral check: change the currency select to a different value, then fill and blur the budget, and assert the formatted display reflects the new currency. That assertion would fail without the `selectedCurrency` state. Given the minimal scope of the C6 edit change, dropping tests 3 and 4 entirely and adding a one-line manual check note is also acceptable — either is better than a green light that proves nothing.

---

### [MINOR] Unused import in `stage15-f-constraints.spec.ts` — generates a lint warning

**File:** `tests/e2e/stage15-f-constraints.spec.ts:26`

`fillCreateFormRequiredFields` is imported from `./helpers` but never called in this file. It is used in `stage15-f.spec.ts`. The import generates a `@typescript-eslint/no-unused-vars` warning — the only new lint warning introduced in this batch.

**Suggested fix:** Remove `fillCreateFormRequiredFields` from the import.

---

### [MINOR] C6 create-form "INR at page load" first sub-assertion is not reliably falsifiable

**File:** `tests/e2e/stage15-f-constraints.spec.ts` — tests 1 and 2, first `expect(initialCurrency).toBe("INR")`

The old create-form code rendered an uncontrolled `<select>` with no `value` or `defaultValue`. Chrome's behaviour for an uncontrolled select whose first option is `<option value="" disabled>` is to pick "INR" (first non-disabled option) as the `.value` — meaning Playwright's `inputValue()` may return `"INR"` even without the C6 fix. The meaningful protection is the second sub-assertion in each test ("AED after company selection"), which genuinely fails without the fix. The first sub-assertion adds noise, not coverage.

**Suggested fix:** Drop the before-company-selection assertion or replace it with a comment that documents the initial state rather than asserting it.

---

### [MINOR] `stage15-f-constraints.spec.ts` volume is disproportionate to the item; C9 assertions border on DOM-structure checks

**File:** `tests/e2e/stage15-f-constraints.spec.ts` (386 lines)

The plan's verification table (plan.md §4) called for *manual* verification of C9 — "C5 on-blur format (INR vs USD), C6 currency default, C9 pattern restrictions." The committed spec instead automates 8 C9 tests that verify HTML attribute presence (`inputMode`, `pattern`) and browser-native `checkValidity()` behaviour. While these attributes govern functional behaviour rather than layout, they sit close to the line the wireframe rule draws ("DOM structure" — the attributes ARE part of the DOM, and their presence is one step above what `checkValidity()` actually needs to verify). The C5 save tests (`stage15-f.spec.ts`) are the right kind — they test the behavioral invariant (value stored = value displayed without commas) across a full round-trip. The constraints spec adds 386 lines for marginal value that will only rot when the markup changes.

This is a judgment call, not a blocker; the developer's call on whether to trim.

---

## Round-trip correctness trace (explicit, per the reviewer brief)

**Normal path (type → blur → submit):** `budgetValue` state updated via `onChange` → `handleBudgetBlur` calls `stripGroupingSeparators(budgetValue.trim())` then `formatBudget(stripped, selectedCurrency)` → display shows "10,00,000" (INR) or "1,500,000" (USD) → form submits `budgetValue` via `<input value={budgetValue}>` → server action does `.replace(/,/g, "")` → stored "1000000". Clean. ✓

**Unchanged budget resubmitted on edit:** `budgetValue` initialised to `formatBudget(initialProjectBudget, initialCurrency)` → "10,00,000" displayed; user submits without touching budget → form sends "10,00,000" → action strips → "1000000". ✓

**Empty/cleared budget:** `budgetValue = ""` → `(formData.get("projectBudget") as string | null)?.trim() || null` → `null`; `rawBudget ? ...replace... : null` → `null`. ✓ (Both inquiry and project actions handle this correctly.)

**Already-formatted value in DB (pre-Batch-F record):** `formatBudget` calls `stripGroupingSeparators` internally before parsing, so `initialProjectBudget = "10,00,000"` → `parseFloat("1000000")` → display "10,00,000"; submit → action strips → "1000000". ✓

**Decimal value:** "1000000.505" → blur → rounded by `Intl.NumberFormat(maxFractionDigits: 2)` → "10,00,000.51" → action strips commas → "1000000.51". Stored as string. Pattern `[\d,\.]*` matches. ✓

**Currency switched after formatting:** User types "1000000" (INR) → blurs → "10,00,000" displayed; switches currency to AED; submits without re-blurring → form sends "10,00,000"; action strips → "1000000". ✓ (Stale display until next blur, but stored value always clean.)

**C6 else-branch when `defaultCurrency` is null/undefined at runtime:** `null ?? "INR"` = "INR"; `undefined ?? "INR"` = "INR". Protected. ✓ (Empty string `""` would slip past `??` — but the API types this as `string` and real companies have valid currency codes; near-zero practical risk.)

## Consistency across all four forms

All four forms received C5 (controlled budget + blur handler + server-action comma-strip) and C9 (pattern on budget + name fields). Create forms received C6 (currency state initialised from `lockedCompany?.defaultCurrency ?? "INR"`, updated on company change). Edit forms received C6 state tracking (`selectedCurrency` initialised to `initialCurrency`) as a necessary enabler for the blur handler when the user changes the currency select before blurring the budget. No form is a near-miss.

## Architecture rules

- `orgHref`/`useOrgHref`: no hand-built org URLs in app code. Test specs use hardcoded `/acme-glass/...` (correct for E2E targeting a known tenant). ✓
- UI/API separation: no Prisma calls in pages; all budget handling flows through existing server actions → existing API. ✓
- `clientMessages` trap: all four forms use their existing `inquiries` or `projects` namespace, already wired in their respective layouts. No new namespace. ✓
- SQL mirror: no new or changed `prisma.<model>.<method>` calls; `listExternalCompanies` was already returning `defaultCurrency` (verified by the AED E2E test passing). No `by-page.sql` update required. ✓

---

## Verdict: APPROVE-WITH-NITS

1 IMPORTANT (test quality — C6 edit specs cannot detect regression), 3 MINOR (unused import, weak first sub-assertion on C6 create, spec volume).

Production code is correct and complete on all four paths. The IMPORTANT finding is about the spec giving false confidence for C6 on edit forms — the dev should either fix those two tests or drop them. The MINOR findings are at the developer's discretion. Nothing here blocks shipping.
