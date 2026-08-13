# Stage 14 — Worklog

**Stage target (approved):** `../quotation-system-docs/development-cycles/stage-14.md`
**Shared brief:** `.engineering/stage-14/profile.md`
**Working branch:** `release/stage-14` (cut from `staging` @ `3c60f9f`, per the stage doc's deliberate deviation)
**Triage tier:** Large + splittable — the stage doc pre-declares batches A/B/C/D with disjoint file sets.

**Goal (one line):** 14 new nullable Inquiry/Project fields + 3-card form/detail restructure across 6 views,
`destinationCountry` → constrained select w/ conditional GST, conversion propagation — plus 4 independent UI fixes.

**Dependency shape:**
```
Batch A (schema + DAL + i18n) ──► Batch B (Inquiry UI + API)
                              └─► Batch C (Project UI + API)
Batch D (4 UI fixes) ── independent, no dependency on A/B/C
```

---

## Work items

| ID | Item | Depends on | Branch | Status |
|---|---|---|---|---|
| A | Schema migration (14 cols × 2 models), DAL, i18n keys | — | `feature/a-schema-dal-i18n` | pending |
| B | Inquiry track — forms, detail, API routes, actions | A | `feature/b-inquiry-track` | pending |
| C | Project track — forms, detail, API routes, actions | A | `feature/c-project-track` | pending |
| D | 4 UI fixes (pagination, icon actions, confirm dialog, breadcrumb) | — | `feature/d-ui-fixes` | pending |

---

## Activity log

### Orchestrator — Step 0 (orient)
- Confirmed stage 14 is approved (📐 Planned) and `release/stage-14` is checked out at `3c60f9f` (= `staging` tip).
- `profile.md` seeded by a developer agent (Stage 12's brief carried forward + verified against current code).
- Profile agent flagged 3 discrepancies vs. the stage doc — see `profile.md` "Discrepancies found". None are
  design deviations; carried into the plan brief.

### Developer — Planning pass (2026-08-12)
- Read: `profile.md`, `worklog.md`, `stage-14.md`, `AGENTS.md`, key source files
  (`lib/data/inquiries.ts`, `lib/data/projects.ts`, `messages/en.json`, both create/edit forms,
  both detail pages, `actions.ts` files, API route files, `delete-user-button.tsx`,
  `delete-company-button.tsx`, `users/page.tsx`, `external-companies/page.tsx`,
  `project-wizard-breadcrumb.tsx`, `prisma/schema.prisma`).
- **Plan written:** `.engineering/stage-14/plan.md`
- 11 deviations/decisions captured (D1–D11). Key ones for human review:
  - D4: no icon library → inline SVG for pencil/trash
  - D6: confirm message string passed as prop from server-component parent (removes useTranslations from delete buttons)
  - D11: stage doc says "14 columns" but the enumerated list has 15 — implementing all 15 per the list
- B and C confirmed **fully disjoint** (no shared files; A owns all shared upstream files).
- Status: DONE (planning only — no product code written, no branches created).

### Orchestrator — GATE A: deviation check (human, 2026-08-13)

Human ruled on the three items that needed a call. **All three are now settled — do not re-open them:**

| ID | Question | **Human's decision** |
|---|---|---|
| D11 | Stage doc intro says "14 fields", enumerated list adds to 15 | **15 columns.** The enumerated list wins; the intro's "14" is an arithmetic slip (the intro itself says "8 End Client" fields, which makes 15). Batch A migrates all 15 on both models. |
| D4 | No icon library in the codebase; Batch D needs pencil/trash | **Inline SVG, no new dependency.** Hand-rolled 16×16 pencil/trash styled with existing Sage Ease tokens. Do not add `lucide-react` or any icon package. |
| D6 | Confirm-dialog i18n approach | **Prop-driven strings.** Parent server component resolves the message and passes it down as a prop; the dialog stays namespace-agnostic. This intentionally removes `useTranslations` from `DeleteCompanyButton`, and avoids the `clientMessages` silent-hydration trap in `AGENTS.md`. |

D1, D2, D3, D5, D7–D10 in `plan.md` were straight reads of the approved doc / doc typos and needed no gate.

### ⏸ Orchestrator — PAUSED at GATE A (2026-08-13)

**Human paused the run before any code was written.** New finalized UI mockups for **both Inquiry and
Project** are being supplied and **the build must be written from them**.

- `stage-14.md` amended accordingly: a callout at the top of **Scope** makes the mockups the build reference
  for Batches B and C, and **section C is marked superseded** — the mockups are now an *input* to this stage,
  not an artifact updated after the fact. Where mockup and doc wording conflict on presentation, the mockup wins.
- **Blocked:** Batch B (Inquiry track), Batch C (Project track) — both are mockup-driven.
- **Not blocked:** Batch A (schema + DAL + i18n) and Batch D (the 4 UI fixes) — neither depends on the mockups.
- **State on resume:** branch `release/stage-14` @ `3c60f9f`, clean, no feature branches cut, no product code
  written, no migration created. `profile.md` and `plan.md` are current and still valid — the resuming run
  should re-read `plan.md` §B/§C against the delivered mockups and revise those two sections only.

### Developer — Batch A (2026-08-13)

**Role:** developer · **Branch:** `feature/a-schema-dal-i18n` · **Commit:** `edd6ec0`

**What changed:**
- `prisma/schema.prisma` — added 15 nullable columns to both `Inquiry` and `Project` (identical set)
- `prisma/migrations/20260813000001_add_extended_inquiry_project_fields/migration.sql` — ADD COLUMN only migration, applied to Neon dev branch via `migrate deploy`
- `lib/data/inquiries.ts` — extended `CreateInquiryInput`, `UpdateInquiryInput`, `createInquiry()`, `updateInquiry()`, `convertInquiryToProject()` with all 15 fields
- `lib/data/projects.ts` — extended `CreateProjectInput`, `UpdateProjectInput`, `createProject()`, `updateProject()` with all 15 fields
- `messages/en.json` — added 19 new keys (3 section headings + 15 field labels + 1 GST hint) to `inquiries` namespace and independently to `projects` namespace; only those two namespaces touched
- `../quotation-system-docs/design-docs/sql-queries/by-page.sql` — updated createInquiry, updateInquiry, createProject, updateProject, convertInquiryToProject INSERT/UPDATE statements

**15 column names (identical on Inquiry and Project):**
`submissionDate`, `projectDeadline`, `projectBudget`, `mainContractorName`, `interiorContractorName`, `mainConsultantName`, `interiorConsultantName`, `endClientName`, `endClientPhone`, `endClientEmail`, `endClientAddressLine1`, `endClientAddressLine2`, `endClientCity`, `endClientState`, `endClientGstNumber`

**`clientMessages` check:** `inquiries` forwarded by `app/[orgSlug]/inquiries/layout.tsx` (confirmed). `projects` forwarded by `app/[orgSlug]/projects/layout.tsx` (confirmed). No layout changes needed.

**Migration approach:** `migrate dev` blocked by pre-existing drift on `20260811192114_add_company_country_currency` (file checksum mismatch vs DB record — pre-existing, not caused by this branch). Generated SQL via `migrate diff --from-config-datasource --to-schema` (verified: ADD COLUMN only, all nullable, no destructive statements), created migration file manually, applied via `migrate deploy`. Migration applied successfully.

**Verification:**
- `prisma generate` — succeeded
- `tsc --noEmit` — 2 pre-existing errors in `lib/auth.ts` (confirmed pre-existing by stash test); zero new errors from Batch A changes
- `npm run lint` — COULD NOT RUN: `@eslint-community` package missing from `node_modules` (pre-existing environment issue, unrelated to this branch). Code mirrors exact patterns of adjacent DAL code.
- Migration applied to Neon dev branch — confirmed by `migrate deploy` output

**Concerns for reviewer:**
1. Migration was applied via `migrate deploy` rather than `migrate dev` due to pre-existing checksum drift on an earlier migration. The drift is not caused by Batch A. The new migration SQL was verified clean before application.
2. `npm run lint` could not be verified locally — ESLint is broken in this environment due to missing `@eslint-community` dependency. Vercel build will catch any lint issues.

**Status:** DONE_WITH_CONCERNS

### Developer — Mockup planning pass (2026-08-13)

**Role:** developer (planning revision only — no product code written, no branches created)

**What changed:**
- `plan.md` — Deviations section: added D12–D18 (discovered from finalized mockups). D12 and D15 flagged as HUMAN DECISION NEEDED; D13, D14, D16, D17, D18 are straight mockup-wins with no ambiguity.
- `plan.md` — Batch B section: fully rewritten. 3-card layout now matches the actual mockup (2-col grid per card, footer inside Card 3, `currency` → `<select>`, 7 end-client fields required, `submissionDate` required with local-date pre-fill, read-only detail page uses same card structure, separate components kept). No `messages/en.json` touch by B.
- `plan.md` — Batch C section: fully rewritten. Mirrors B (project entity), adds one key (`submitConfigure`) to `projects` namespace in `messages/en.json` only. Disjointness confirmed.
- `plan.md` — B vs C disjointness section: updated. Confirmed fully disjoint; mockup HTML files no longer updated by B/C (they are inputs, not outputs, per stage-14.md).

**Key findings from mockup read:**
- Both mockups show the **same** 3-card layout: Project Information / Contractor Details / End Client Details. Exactly matches the stage doc's three-section grouping in naming and field placement.
- `currency` becomes a `<select>` (INR/AED/USD) per both mockups — not in original plan.
- 7 end-client fields are form-required per mockup (name, phone, email, addr1, addr2, city, state).
- Footer (Cancel + Submit) is **inside Card 3**, not below all cards.
- `submissionDate` is **required** (with `*`) and pre-filled to today.
- `destinationCountry` is **absent from both mockups** — existing field in live forms. Flags D12.
- Company dropdown (`externalCompanyId`) is **absent from both mockups** — existing feature. Flags D15.
- Section heading is "Contractor Details" (shorter) vs. Batch A's "Contractor & Consultant Details"; subtitle clarifies scope. Accept Batch A value to avoid re-touching `messages/en.json`.

**Blocked until human settles:**
- D12: whether `destinationCountry` stays in the form (lean: yes, it's needed for conditional GST)
- D15: whether company dropdown stays in the form (lean: yes, removing it is a regression)

**Status:** DONE (planning only)

### Reviewer — Batch A + D combined review (2026-08-13)

**Role:** reviewer · **Verdict:** APPROVE-WITH-NITS · **Findings:** 0 CRITICAL · 0 IMPORTANT · 1 MINOR
**Report:** returned inline (no file) per system instructions.

One minor finding: `ListPagePagination` in `components/list-page-controls.tsx` retains dead code (`entityLabel` prop, `startRecord`, `endRecord` variables) after the record-count span was removed. No runtime impact; all three list-page callers still pass `entityLabel` unnecessarily. Fix is cosmetic — remove the prop from the interface, drop the two computed vars, update three callers. Can be done in any subsequent batch or a quick follow-up; does not block shipping A+D.

All high-priority items reviewed clean:
- `convertInquiryToProject`: all 15 fields propagated inside the transaction ✓
- DAL inputs/outputs (both models): types, `create`, `update` all correct ✓
- Migration SQL: ADD COLUMN only, all nullable, exact match to schema ✓
- Pagination guard: `if (totalPages <= 1) return null` at correct level ✓
- Breadcrumb fix: step-1 logic resolves `/edit` correctly, no false matches ✓
- `confirm-dialog.tsx`: role/aria-modal/Escape/focus all correct ✓
- i18n keys (`users.deleteConfirm`, `externalCompanies.deleteConfirm`, both `editAction`): verified present with matching param names ✓

### Developer — Nit cleanup (2026-08-13)

**Role:** developer (trivial tier) · **Branch:** `feature/nit-pagination-deadcode` · **Commit:** `7e13363`

Addresses the single MINOR finding from `review-ad.md`: dead code left in `ListPagePagination` after
Batch D removed the record-count text.

- `components/list-page-controls.tsx` — removed `entityLabel` from `ListPagePaginationProps`, its
  destructure, and the unused `startRecord`/`endRecord` computations.
- Removed `entityLabel="…"` from the three `<ListPagePagination>` call sites (inquiries, orders, projects).

**⚠ Correction to the review's finding:** `review-ad.md` said "all three callers still pass it", implying
every `entityLabel` reference was dead. It is in fact a prop on **two different components** in the same
file — the dead one on `ListPagePagination`, and a **live** one on the scope-toggle component that renders
"My {entityLabel}" / "All {entityLabel}" (lines ~266/279/292). Only the `ListPagePagination` one was
removed. A blanket removal of all `entityLabel` references would have broken the scope toggle.

**Verification:** `tsc --noEmit` clean; `npm run lint` = **0 errors, 4 warnings** (down from 7 — the 3
removed are exactly `entityLabel`/`startRecord`/`endRecord`; the 4 remaining are pre-existing, all in
`tests/e2e/`).

**Note:** this agent's run was interrupted before it wrote its own entry; the commit had already landed
and was verified independently by the orchestrator. This entry is orchestrator-written bookkeeping.

### Developer — Revise Batch B/C for post-mockup decisions (2026-08-13)

**Role:** developer (planning revision only — no product code, no branches, no migrations)

**What changed (real plan only):**
- `quotation-system/.engineering/stage-14/plan.md` — targeted in-place edits to the 739-line real plan:
  - **D12** marked SUPERSEDED (2026-08-13) with pointer to D19; old options A/B/C noted as superseded.
  - **D15** marked SETTLED (keep company, role-dependent); verified Stage 13 Batch 5 already implements
    the pattern in both `inquiries/new/page.tsx` (line 46) and `projects/new/page.tsx` (line 44).
  - **D18** corrected: "already required" claim was wrong; `create-inquiry-form.tsx` has no `required`
    on `projectLocation` and labels it "(optional)". D22 added to capture this.
  - **D19–D22** appended after D18: D19 (DAL-level derivation spec), D20 (GST conditional via company
    country, confirmed API already returns `country` — no route changes needed), D21 (no-company path —
    OPEN QUESTION for human, do not code until confirmed), D22 (`projectLocation` required, correction).
  - **Batch B** section revised: files table adds `lib/data/inquiries.ts` + `page.tsx` cast widening;
    dependency note updated; Card 1 layout removes `destinationCountry` row; `destinationCountry` →
    `<select>` + `useState(destinationCountry)` section replaced with company-country GST design
    (`isIndia` state, props widened to carry `country`); verification cases updated.
  - **Batch C** section revised: mirror changes to Batch B; files table adds `lib/data/projects.ts`.
  - **B vs C disjointness** section updated: `lib/data/inquiries.ts` → B, `lib/data/projects.ts` → C,
    still disjoint (different files). No Batch A2 needed.

**Verified facts established by code reads (citations in plan D19–D22):**
- (a) `externalCompanyId`: optional in DB (schema.prisma lines 372, 314) and form (no `required`, action
  line 41 coerces empty to null). No-company path exists → D21 open question.
- (b) External user linked via `User.externalCompanyId String?` (schema.prisma line 102;
  `lib/session.ts` line 13).
- (c) Internal vs external: `session.externalCompanyId !== null`. No role/permission check. Applied in
  `lib/data/inquiries.ts` lines 130, 140; `inquiries/new/page.tsx` line 46.
- (d) Enum: `CompanyCountry { INDIA UAE }` (schema.prisma lines 60–63). Mapping: `INDIA`→`"India"`,
  `UAE`→`"UAE"`. Existing `destinationCountry` values are free-text (no migration needed/planned).
- (e) Role-dependent company dropdown fully implemented in Stage 13 Batch 5. `listExternalCompanies`
  returns full rows including `country` (no `select` clause — `lib/data/external-companies.ts` line 11).
  `getExternalCompanyById` already selects `country` (line 35). No API route changes needed.

**Note on stray file:** A `plan.md` was incorrectly written to `d:\projects\vistra\.engineering\stage-14\`
during this task (wrong path — missing the `quotation-system\` segment). That file is superseded by the
edits to the real plan above. The stray directory was left in place per orchestrator instruction.

**Status:** DONE (planning only)

### Reviewer — Batch B+C integration review (2026-08-13)

**Role:** reviewer · **Verdict:** CHANGES-NEEDED · **Findings:** 0 CRITICAL · 1 IMPORTANT · 3 MINOR
**Report:** `.engineering/stage-14/review-bc.md`

IMPORTANT: `projects/[projectId]/page.tsx` line 110 — raw UUID rendered as "Inquiry No." for converted projects; must be fixed before merge (show "—" at minimum, or join inquiry number fields). Three MINOR stale JSDoc comments that still list `destinationCountry` as an accepted/editable field (inquiries PATCH route, projects POST route, projects PATCH route) — no runtime impact.

All tenancy items clean: `destinationCountry` is not parsed, passed, or stored from any client-supplied value in any of the 4 route files or 2 actions files. DAL company override (session wins over client) intact in both tracks. Derivation correct and identical (`INDIA`→`"India"`, `UAE`→`"UAE"`, no company→`""`). `convertInquiryToProject` undisturbed. Cross-track B/C consistency confirmed. i18n keys and clientMessages wiring verified clean. Date handling correct.

### Developer — B+C review fix (2026-08-13)

**Role:** developer · **Branch:** `feature/bc-review-fixes` · **Commit:** `c5b3e6d` (app) + `e25db0c` (docs)

**IMPORTANT fix — Inquiry No. on project detail/edit pages:**
- `lib/data/projects.ts` `getProjectById` — added `inquiry: { select: { inquiryNumber, companyInquiryNumber } }` to the Prisma include.
- `app/[orgSlug]/projects/[projectId]/_project-fetch.ts` `ProjectDetail` — added `inquiry: { inquiryNumber: number; companyInquiryNumber: number | null } | null`.
- `app/[orgSlug]/projects/[projectId]/page.tsx` — computes `formattedInquiryNumber` using identical format to `app/[orgSlug]/inquiries/[inquiryId]/page.tsx` (`INQ-{companyInquiryNumber}` if non-null, else `#{inquiryNumber}`). Null for no-inquiry projects → renders "—" via `ReadOnlyField`.
- `app/[orgSlug]/projects/[projectId]/edit/edit-project-form.tsx` — added `inquiryNumber: string | null` prop; disabled input now shows real value (or "—" if null).
- `app/[orgSlug]/projects/[projectId]/edit/page.tsx` — computes same formatted number; passes as `inquiryNumber` prop.
- `../quotation-system-docs/design-docs/sql-queries/by-page.sql` — updated `getProjectById` entry to include LEFT JOIN on Inquiry and `ec.country` column.

**MINOR fix — three stale JSDoc comments:**
- `app/api/v1/orgs/[orgSlug]/projects/route.ts` POST body description — removed `destinationCountry`, added note that it is derived server-side.
- `app/api/v1/orgs/[orgSlug]/projects/[projectId]/route.ts` PATCH "Editable" line — removed `destinationCountry`, added "Derived" note.
- `app/api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/route.ts` PATCH update-path description — removed `destinationCountry`, added derivation note.

**Format sourced from:** `app/[orgSlug]/inquiries/[inquiryId]/page.tsx` lines 114–117 (`formattedInquiryNumber` computation).

**Edit form:** fixed — `EditProjectForm` now accepts and displays the real formatted inquiry number.

**Verification:** `tsc --noEmit` — clean (no output). `npm run lint` — 0 errors, 4 warnings (all pre-existing in `tests/e2e/`).

**Status:** DONE

### Reviewer — Fix verification (2026-08-13)

**Role:** reviewer · **Verdict:** APPROVE · **Findings:** 0 CRITICAL · 0 IMPORTANT · 0 MINOR
**Report:** `.engineering/stage-14/review-bc.md` (appended "Fix verification (2026-08-13)" section)

All B+C CHANGES-NEEDED items from prior round confirmed resolved. Inquiry No. join correct (single query, null-safe, format matches inquiry detail page). Three JSDoc fixes are comment-only — no executable code changed. Tenancy/derivation property intact. Stage 14 is clear for handoff to `engineering:test`.
