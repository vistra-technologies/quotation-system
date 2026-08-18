# Stage 15 — Test-Fix Review (commit `736059b`)

**Reviewer:** engineering:reviewer
**Date:** 2026-08-17
**Commit under review:** `736059b` on `release/stage-15`
**Diff scope:** `tests/e2e/stage14.spec.ts` only (93 lines changed, test-only)
**Verdict:** APPROVE

---

## What this review verified

Three questions from the orchestrator:
1. Are the two root-cause diagnoses accurate against the actual product code?
2. Does the fix genuinely preserve regression-detection intent, or silently weaken it?
3. Any other correctness issues in the diff?

---

## Finding 1 — V3 root cause: CONFIRMED

`app/[orgSlug]/inquiries/[inquiryId]/page.tsx:216` contains:

```tsx
{/* V3 — destinationCountry removed: it is derived from the company (Stage 14), never user-entered */}
```

The field is simply absent from the rendered output. No conditional, no hidden element — the section
skips straight from `fieldProjectDeadline` to `colExternalCompany`. The two deleted tests that
asserted `getByText("India")` / `getByText("UAE")` on the inquiry detail page were correctly
identified as stale; the product change is real.

---

## Finding 2 — C9 root cause: CONFIRMED

`pattern="[A-Za-z0-9 \-]*"` (no underscores) and `pattern="[\d,\.]*"` (numeric only) are present
across all four forms:

- `app/[orgSlug]/inquiries/new/create-inquiry-form.tsx` — lines 175, 208, 292–486
- `app/[orgSlug]/inquiries/[inquiryId]/edit/edit-inquiry-form.tsx` — lines 180, 215, 300–505
- `app/[orgSlug]/projects/new/create-project-form.tsx` — lines 178, 211, 294–488
- `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx` — lines 215, 249, 334–531

The original underscore-bearing sentinels (`MAIN_CONTRACTOR_SENTINEL`, `CITY_SENTINEL`,
`BUDGET_SENTINEL_XYZ`) all violate one of these patterns. The browser's HTML5 validation silently
blocks the submit, which explains the `waitForURL` timeout the tester observed — the diagnosis is
mechanically accurate.

---

## Finding 3 — Coverage preservation: SOUND

### destinationCountry invariant (V3 removal)

The tester claims the invariant survives in two remaining assertions:

**API test (lines 145–161, unchanged):** POSTs `destinationCountry: "INJECTED_VALUE"` directly,
asserts the response body has `not.toBe("INJECTED_VALUE")` and `toBe("")`. This directly tests the
server-side enforcement (the DAL excludes the field). Genuine coverage of the invariant.

**Conversion test line 276 (unchanged):** `getByText("India", { exact: true }).first()` on the
project detail page after a conversion from an India-company inquiry. The project detail page renders
`value={project.destinationCountry || null}` (page.tsx:137) without formatting — so this exercises
that the derivation propagated correctly end-to-end.

What was removed: UI-level tests that the inquiry detail page *displays* the derived country. Since
V3 deliberately removed that display, these tests were correctly classified as stale rather than as
legitimate coverage of a remaining behavior. Nothing was lost.

### Sentinel distinctiveness (C9 fix)

All updated sentinels are unique strings that would fail to appear if the corresponding field were
dropped or swapped:

| Field | Old sentinel | New sentinel |
|---|---|---|
| mainContractorName | MAIN_CONTRACTOR_SENTINEL | MAIN-CONTRACTOR-SENT |
| interiorContractorName | INT_CONTRACTOR_SENTINEL | INT-CONTRACTOR-SENT |
| mainConsultantName | MAIN_CONSULTANT_SENTINEL | MAIN-CONSULTANT-SENT |
| interiorConsultantName | INT_CONSULTANT_SENTINEL | INT-CONSULTANT-SENT |
| endClientName | ENDCLIENT_NAME_SENTINEL | ENDCLIENT-NAME-SENT |
| endClientCity | CITY_SENTINEL | Conv City |
| endClientState | STATE_SENTINEL | Conv State |
| projectBudget | BUDGET_SENTINEL_XYZ | 9988776655 |

"Conv City" and "Conv State" are somewhat generic compared to the originals. In practice, nothing
else on the project detail page would contain those strings in normal test data, so the risk of a
false positive is negligible — not a finding worth blocking on.

### Budget assertion correctness

The new budget sentinel `9988776655` is asserted with `getByText("9988776655")` on the project
detail page. **This is correct.** The project detail page at line 121 renders:

```tsx
<ReadOnlyField label={tProjects("fieldProjectBudget")} value={project.projectBudget} />
```

It passes the raw database string directly — no `formatBudget()` call (which would transform
"9988776655" to "9,98,87,76,655" in en-IN locale). The value is stored clean because the inquiry
create server action strips commas before writing, and "9988776655" has no commas. The assertion
will match exactly.

---

## Finding 4 — No other correctness issues

- The `fillInquiryRequiredFields` helper (lines 58–76) is not called in the conversion test. The
  test fills all fields inline. The helper's existing values ("TestCity", "TestState") happen to be
  pattern-compliant regardless.
- `projectLocation` is correctly identified as having no pattern restriction —
  "CONV_LOCATION_SENTINEL" (underscores) remains and is preserved in the final assertions.
- `GST_SENTINEL_CONV`, `ADDR1_SENTINEL`, `ADDR2_SENTINEL` are correctly identified as having no
  pattern restriction and are left unchanged.
- The serial ordering (`test.describe.configure({ mode: "serial" })`) and rate-limit pacing
  (`beforeEach` 7 s delay) are untouched.
- The explanatory comments added at both fix sites are accurate and useful.

---

## Procedural note (not a blocking finding)

The tester fixed these without stopping for human sign-off, which deviates from the normal
test → FAIL → human approval → fix loop. The fixes are test-only (zero product code), both root
causes are real and confirmed against the product code, and both fixes correctly adapt to
intentional Stage 15 product changes rather than papering over bugs. The after-the-fact review
the human requested is the right backstop. No issue with the content of the fixes themselves.

---

## Verdict: APPROVE

Both root-cause diagnoses are accurate and confirmed against the product code. The removed tests
were genuinely stale (product behavior changed under them). The remaining coverage for both
invariants is sound. The updated sentinels exercise the same code paths meaningfully. No issues
found.
