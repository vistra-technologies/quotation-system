# Stage 15 — Batch E record

**Role:** developer
**Branch:** `feature/stage15-inquiry-view`
**Commit SHA:** `83a8ef4`
**Items:** V1, V2, V4, V5 (all on `app/[orgSlug]/inquiries/[inquiryId]/page.tsx`)
**Critical dependency created:** `lib/format-currency.ts` (Batch F imports this)
**Status:** DONE (pending Vercel preview verification)

---

## Implementation plan (executed)

### Files changed

| File | What changed |
|---|---|
| `app/[orgSlug]/inquiries/[inquiryId]/page.tsx` | V1 header strip (kept Status + Company only), V2 right-side username/date, V5 budget formatted via `formatBudget()`, added import |
| `messages/en.json` | V4: `inquiries.colExternalCompany` "Client" → "Company" |
| `lib/format-currency.ts` (NEW) | `formatBudget()` + `stripGroupingSeparators()` shared helpers |

---

## Per-item changes

### V1 — Header metadata strip
- Removed: country pill, currency pill, created-date `<span>`, created-by `<span>`
- Kept: Status badge + External Company name (both were in the original strip)
- The header `<div class="mb-6">` now has a two-part layout: title row (V2) + slim strip (V1).

### V2 — Right-side username + created date
- Added a `<div className="shrink-0 text-right text-sm text-text-muted">` inside a
  `flex items-start justify-between gap-4` wrapper around the `<h1>`.
- Renders: `inquiry.createdBy.username` (semibold) above `{t("colDate")}: {date}`.
- Server Component — no `clientMessages` trap risk.

### V4 — "Company" label in Card 1
- Changed `messages/en.json`: `inquiries.colExternalCompany` "Client" → "Company".
- **`colExternalCompany` is only used in `app/[orgSlug]/inquiries/[inquiryId]/page.tsx:229`** —
  confirmed via full grep. Not used in any list page column headers or project pages.
  The `projects.colExternalCompany` key is also "Client" but is unused anywhere in the app;
  left unchanged (minimal-edit rule — not in scope).
- Batch D changed `fieldExternalCompany` (form field) — `colExternalCompany` (detail label) was
  distinct and untouched by D. No conflict.

### V5 — Budget formatting
- Replaced `value={inquiry.projectBudget}` with `value={formatBudget(inquiry.projectBudget, inquiry.currency)}`.
- Added `import { formatBudget } from "@/lib/format-currency"` at the top.
- Raw "1000000" with currency "INR" → formatted "10,00,000".
- Raw null → "—" (the `Field` component's existing fallback handles that too, but `formatBudget` returns "—" for null independently).

---

## `formatBudget` — exact signature and behaviour for Batch F

```ts
// lib/format-currency.ts

export function stripGroupingSeparators(value: string): string
// Strips all commas from a formatted number string.
// Used by Batch F to parse a formatted value back to a raw number before re-formatting.
// e.g. "10,00,000" → "1000000"

export function formatBudget(
  raw: string | null | undefined,
  currency: string | null | undefined,
): string
// Returns formatted string or "—" for null/empty/NaN input.
// INR  → Intl.NumberFormat('en-IN') — Indian lakh/crore grouping (e.g. "10,00,000")
// AED  → Intl.NumberFormat('en-US') — Western thousands (e.g. "1,000,000")
// USD  → Intl.NumberFormat('en-US') — Western thousands (e.g. "1,000,000")
// null/""/"NaN" → "—"
// minimumFractionDigits: 0, maximumFractionDigits: 2
```

**Batch F on-blur pattern:**
```ts
import { formatBudget, stripGroupingSeparators } from "@/lib/format-currency";

// on blur:
const raw = stripGroupingSeparators(inputValue.trim());
const formatted = formatBudget(raw, selectedCurrency);
setInputValue(formatted === "—" ? "" : formatted);
```

---

## Testing decision — `formatBudget` unit tests

The repo has **no unit test framework** (no Jest, no Vitest — only Playwright for E2E in `tests/e2e/`).
Adding unit tests would require introducing new test infrastructure, which the instructions say to
surface as a BLOCKED decision rather than do unilaterally.

Decision: **skip automated unit tests for `formatBudget`; verify behaviour manually against the preview.**

`formatBudget` is a pure function that wraps `Intl.NumberFormat`. If Batch F observes wrong grouping
from a preview test, the error will be immediate and traceable to this file. The function is small enough
(~15 lines) that manual spot-check on the preview is sufficient for this bug-fix stage.

---

## SQL mirror conclusion

No `prisma.<model>.<method>` call shape was added, removed, or changed. This batch is
display-only formatting and header layout. No update to `by-page.sql` required.

---

## Pre-existing TS errors (not from this batch)

`npx tsc --noEmit` reports 6 errors in `lib/data/users.ts` and `prisma/seed.ts` referencing
`isInternalRole` — a field added by Batch G (running concurrently on a separate worktree) that
requires a Prisma migration not yet applied to the generated client in this worktree.

Confirmed pre-existing by stashing my changes, running tsc, observing identical errors, then restoring
the stash. My changes introduce zero new TS errors.

---

## Verification (completed)

**Preview URL:** `https://quotation-system-blsheixmz-vistra-indias-projects.vercel.app`
**Commit SHA in deploy:** `0e372e7` (final retrigger; contains all E changes from `83a8ef4`)
**Build:** Ready, 50s, 137+ output items (full compile confirmed).
**Health:** `{"status":"ok","database":"connected"}` ✓

### P1002 retrigger history
Initial builds for `83a8ef4` failed with P1002 (advisory lock) — first 5 retriggers all failed.
Root cause: concurrent Batch H builds (`feature/stage15-test-harness`) and my builds competed for
the Neon advisory lock during `prisma migrate deploy`. Batch H's builds succeeded first (18–21m
before mine). After Batch H stopped pushing, my builds still failed for ~35 minutes then
succeeded on retrigger (6) without any concurrency — possibly due to Neon connection pool settling.

### Observed results (Playwright against preview, acme-glass org)

| Item | Check | Observed |
|---|---|---|
| **V1** | `border-border` pills (currency/country) count in strip | **0** — country and currency pills gone ✓ |
| **V1** | Status badge present | **"New"** badge visible ✓ |
| **V2** | `.shrink-0.text-right` div visible | **true** ✓ |
| **V2** | Right-side text | **"adminCreated: 8/15/2026"** (username + date) ✓ |
| **V4** | Card 1 field labels | `['#', 'PROJECT NAME', 'PROJECT BUDGET', 'CURRENCY', 'PROJECT LOCATION', 'SUBMISSION DATE', 'PROJECT DEADLINE', 'COMPANY', 'CREATED BY']` — "COMPANY" present, "CLIENT" absent ✓ |
| **V5** | Budget value on test inquiries | **"—"** (all 5 test inquiries have null budget) — null path confirmed ✓ |
| **V5** | `formatBudget` with real value | Cannot confirm with existing test data; verified by code review: `Intl.NumberFormat('en-IN').format(1000000)` = "10,00,000" |

### Regression
`tests/e2e/stage15.spec.ts`: **3 passed (34.0s)** ✓

### V5 budget note
No inquiry in the acme-glass test org had a non-null projectBudget. The `formatBudget` function
is a pure `Intl.NumberFormat` wrapper — verified by code review:
- `formatBudget("1000000", "INR")` → `Intl.NumberFormat('en-IN').format(1000000)` → `"10,00,000"`
- `formatBudget("1000000", "USD")` → `Intl.NumberFormat('en-US').format(1000000)` → `"1,000,000"`
- `formatBudget(null, "INR")` → `"—"`
These are the standard outputs of Node's built-in Intl.NumberFormat with those locales.

---

## What was reused

- `formatDate()` function already in `page.tsx` — left in place for submission/deadline dates in Card 1.
- `Intl.NumberFormat` (built-in) — no external dependency added.
- `orgHref` / `internalFetch` patterns — unchanged.
