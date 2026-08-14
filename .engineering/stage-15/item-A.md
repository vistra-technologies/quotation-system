# Stage 15 — Batch A record

**Role:** developer (head of A→C→D→E→F serial chain)
**Branch:** `feature/stage15-mechanical`
**Final commit SHA:** `5425cbc`
**Preview URL:** `https://quotation-system-c327r9njh-vistra-indias-projects.vercel.app`
**Status:** DONE

---

## What changed (per item)

### L1 — Inquiry list pagination
- `app/[orgSlug]/inquiries/page.tsx`: `pageSize` 20 → 10.
- `ListPagePagination` already renders numbered page buttons — no component change needed.

### PL1 — Project list pagination
- `app/[orgSlug]/projects/page.tsx`: `pageSize` 20 → 10. Same fix.

### C10 — Address Line 2 optional
Removed `required` attribute and the red asterisk label from `endClientAddressLine2` in all four forms:
- `app/[orgSlug]/inquiries/new/create-inquiry-form.tsx`
- `app/[orgSlug]/inquiries/[inquiryId]/edit/edit-inquiry-form.tsx`
- `app/[orgSlug]/projects/new/create-project-form.tsx`
- `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx`

No server-side validation changes were needed — the actions and API routes treat the field as optional already (`parseStr` / `|| null` pattern).

### V3 — Remove destinationCountry from inquiry detail view
- `app/[orgSlug]/inquiries/[inquiryId]/page.tsx`: removed `<Field label={t("fieldDestinationCountry")} value={inquiry.destinationCountry || undefined} />` from Card 1. Replaced with a comment explaining the decision (derived field, never user-entered).

### X1 — Project edit form shows real project number
- `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx`:
  - Added `projectNumber: number` and `companyProjectNumber: number | null` to `EditProjectFormProps`.
  - Added `formattedProjectNumber` computed value: `companyProjectNumber != null ? 'JOB-${n}' : '#${n}'` — same pattern as `projects/[projectId]/page.tsx:60–62`.
  - Replaced hardcoded `value="—"` with `value={formattedProjectNumber}` on the disabled Project No. input.
- `app/[orgSlug]/projects/[projectId]/edit/page.tsx`: passes `projectNumber={project.projectNumber}` and `companyProjectNumber={project.companyProjectNumber}` to `EditProjectForm`.

### X2 — Back-link no longer uses .replace() string surgery
- `messages/en.json`: added `"backToProjectDetail": "← Back to Project"` in the `projects` namespace (alongside the existing `backToList: "← Back to Projects"`).
- `app/[orgSlug]/projects/[projectId]/edit/page.tsx`: replaced `tProjects("backToList").replace("Projects", "Project")` with `tProjects("backToProjectDetail")` in the non-DRAFT guard. Mirrors how the inquiry edit page uses `t("backToInquiry")`.

### X4 — Contractor Details vs Contractor & Consultant Details
**No code change.** `sectionContractorDetails` in `messages/en.json` already reads `"Contractor & Consultant Details"` in both the `projects` namespace (line 179) and the `inquiries` namespace (line 234). All four forms and the inquiry view use `{t("sectionContractorDetails")}` — there is no hardcoded "Contractor Details" string in any rendered JSX. The only occurrence of the shorter form is in a code comment (`inquiries/[inquiryId]/page.tsx:66`). Item is a no-op for code; human may want to update the comment.

### X7 — Two Stage-12 cosmetic follow-ups
- `app/[orgSlug]/admin/components/loading.tsx`: replaced `border-amber-200 bg-amber-50` on the animate-pulse skeleton placeholder with `border-border bg-border/20` (design-system colors, matching the other skeleton elements in that file).
- `app/[orgSlug]/projects/[projectId]/design/add-wall/add-wall-form.tsx`: added `dark:border-red-700/50 dark:bg-red-950/30` to the error banner `<div>` and `dark:text-red-400` to the error text paragraph. Restores the dark-mode variants that were noted as dropped in the Stage 12 integration review.

### PV1 — Project wizard breadcrumb (verify-only, no code)
`project-wizard-breadcrumb.tsx:54–62` uses `pathname.startsWith(step.href)` combined with `!steps.slice(1).some((s) => pathname.startsWith(s.href))` for step 0 — exactly the fix Stage 14 Batch D applied. **Fix is present and correct.** Closes on the human's own visual verification against `test.easeetool.com`.

---

## What was reused
- `orgHref` / `tProjects("backToInquiry")` pattern from `inquiries/[inquiryId]/edit/page.tsx` — used as the model for X2's `backToProjectDetail` key.
- `projects/[projectId]/page.tsx:60–62` formatting pattern for `companyProjectNumber ?? projectNumber` — reused verbatim for X1.
- `bg-border` skeleton color from existing elements in `admin/components/loading.tsx` — used for X7 amber replacement.

---

## Automated coverage added
**`tests/e2e/stage15.spec.ts`** — 3 tests, all passing:
1. `L1 — inquiry list: first page shows ≤ 10 rows when total > 10` — count invariant; self-skips when DB has ≤ 10 records.
2. `PL1 — project list: first page shows ≤ 10 rows when total > 10` — same.
3. `C10 — inquiry create: form submits successfully with Address Line 2 empty` — navigation invariant (redirect away from /new); uses `page.request` for authenticated API call (not `request` fixture which lacks HttpOnly cookies).

**Verify command:** `PLAYWRIGHT_BASE_URL=https://quotation-system-c327r9njh-vistra-indias-projects.vercel.app npx playwright test tests/e2e/stage15.spec.ts --reporter=line`
**Result:** `3 passed (36.9s)`

---

## Manual checks performed and observed results
All checks run against `https://quotation-system-c327r9njh-vistra-indias-projects.vercel.app` via Playwright automation (Playwright used as the browser, not a dev server):

| Item | Check | Observed |
|---|---|---|
| **V3** | Inquiry detail page — "Destination Country" label count | `0` — field is gone from Card 1 ✓ |
| **X1** | Project edit form — disabled project number input value | `"#101"` (real value, not `—`) ✓ |
| **X2** | Verified via code | `tProjects("backToProjectDetail")` in page.tsx:79, key `"← Back to Project"` in en.json ✓ |
| **X4** | Code grep | No hardcoded "Contractor Details" in any rendered JSX — no-op confirmed ✓ |
| **X7 (amber)** | Code: `border-amber-200 bg-amber-50` replaced with `border-border bg-border/20` | Changed ✓ |
| **X7 (dark:)** | Code: dark: variants added to add-wall error banner | Changed ✓ |
| **C10 (behavioral)** | Form submits without Address Line 2 → redirect away from /new | PASS — redirected to `/acme-glass/inquiries/{id}` ✓ |

---

## SQL mirror conclusion
No `prisma.<model>.<method>` call shape changes in this batch. Changing `pageSize` changes the `take` value passed to an existing query, not the call signature or the shape of data returned. No update to `by-page.sql` required.

---

## Deliberately left alone for later batches
- **C1–C9, PC1, PC2** (Batch D): label renames, layout restructure, placeholder removal — did NOT touch.
- **V1, V2, V4, V5** (Batch E): inquiry detail header layout, budget formatting — did NOT touch.
- `lib/format-currency.ts` — did NOT create (Batch E creates it).
- Any other files outside the Batch A file set.

---

## Deployment notes
First push errored immediately (P1002 advisory lock — known transient from concurrent parallel builds on the shared dev DB). Empty `ci: retrigger Vercel build` commit resolved it. Second build succeeded in 52s.

Build log confirmed 135+ output items (a full compile, not a stale/incomplete build). Health check: `{"status":"ok","database":"connected"}`.
