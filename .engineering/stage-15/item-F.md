# Stage 15 — Batch F record

**Role:** developer
**Branch:** `feature/stage15-form-behaviours`
**Items:** C5, C6, C9 (all four forms)
**Status:** IN PROGRESS

---

## Implementation plan

### Files changed

| File | What changed |
|---|---|
| `app/[orgSlug]/inquiries/actions.ts` | C5: strip commas from `projectBudget` in `createInquiry` + `updateInquiry` before sending to API |
| `app/[orgSlug]/projects/actions.ts` | C5: strip commas from `projectBudget` in `createProject` + `updateProject` |
| `app/[orgSlug]/inquiries/new/page.tsx` | C6: add `defaultCurrency: string` to `lockedCompany` and `externalCompanies` type casts |
| `app/[orgSlug]/inquiries/new/create-inquiry-form.tsx` | C5 (budget controlled + onBlur), C6 (currency controlled, defaultCurrency threading), C9 (patterns) |
| `app/[orgSlug]/inquiries/[inquiryId]/edit/edit-inquiry-form.tsx` | C5 (budget controlled + onBlur, format initial value), C9 (patterns) |
| `app/[orgSlug]/projects/new/page.tsx` | C6: add `defaultCurrency: string` to type casts |
| `app/[orgSlug]/projects/new/create-project-form.tsx` | C5, C6, C9 (mirror of inquiry create form) |
| `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx` | C5, C9 (mirror of inquiry edit form) |

### Decisions taken

**C5 submit path:** Strip commas in the server action using `.replace(/,/g, "")` on the raw `projectBudget` string before sending to the API. This keeps the DB storage as a clean numeric string (`"1000000"`, not `"10,00,000"`). The API route's `parseStr()` is unchanged — it just stores what the action sends. `formatBudget()` on the detail page internally calls `stripGroupingSeparators` anyway, so the round-trip would be safe either way, but clean DB storage is better.

**C6 initial state:** `selectedCurrency` initializes to `lockedCompany?.defaultCurrency ?? "INR"` on create forms (locked user gets their company's default; no-company case defaults to INR per spec). When company changes in the dropdown, `selectedCurrency` updates to the new company's `defaultCurrency`. Edit forms don't have company selection — no C6 changes there.

**C9 patterns:**
- Budget: `pattern="[\d,\.]*"` — allows digits, commas, decimal points, and empty string. Tolerates post-C5 formatting (commas are valid in the pattern).
- Name fields (Project Name, contractor/consultant names, End Client Name, City, State): `pattern="[A-Za-z0-9 \-]*"` — alphanumeric + space + hyphen.
- Phone/email/address fields: no pattern (built-in type validation or not in scope).

**SQL mirror conclusion:** No new Prisma query shapes. `listExternalCompanies` returns full rows (no `select`), `getExternalCompanyById` already selects `defaultCurrency`. The API was already returning `defaultCurrency` — I'm only reading it in TypeScript. No `by-page.sql` update required.

---

## Verification (filled in after deployment)

TBD

