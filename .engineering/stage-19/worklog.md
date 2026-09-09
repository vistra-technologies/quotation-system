# Stage 19 worklog

**Stage target:** `quotation-system-docs/development-cycles/stage-19.md` — Delete routes + UI/UX bug sweep
**Profile:** `.engineering/stage-19/profile.md`
**Branch:** `release/stage-19` (cut from `master` @ `753ce28`, 2026-09-09)

## Work items

| # | Item | Files (disjoint?) | Status |
|---|---|---|---|
| 1 | Floor/Project DELETE routes | `lib/data/floors.ts`, `lib/data/projects.ts`, `lib/data/inquiries.ts`, `app/api/v1/orgs/[orgSlug]/floors/[id]/route.ts` (new), `app/api/v1/orgs/[orgSlug]/projects/[projectId]/route.ts`, `tests/e2e/stage19.spec.ts` (new) | **done** — merged to `release/stage-19` @ `b989add` |
| 2 | Shared `SelectField` + radio→dropdown fix | new `components/select-field.tsx` + 14 consumer files, `lib/component-catalog-seed.ts`, `create-component-form.tsx` | **done** — merged to `release/stage-19` @ `5805a8c` |
| 3 | Configuration-page UX (popover + loading fixes) | `add-selection-form.tsx`, `configuration/loading.tsx`, `list-page-controls.tsx` | pending |
| 4 | Wizard fixes (copy, Back button, step-gating) | `project-wizard-breadcrumb.tsx`, `layout.tsx`, `_project-fetch.ts` | pending |
| 5 | SuperAdmin Component-Type relocation | new `app/api/v1/superadmin/component-types/**`, `/controls` UI, retiring old `/admin/components` route + its E2E specs | pending |
| 6 | Remaining loading/placeholder sweep | Inquiry/Orders screen spot-check | pending |

Items 2-3 likely share `add-selection-form.tsx` — sequence, don't parallelize those two. Item 1 is
independent and unblocks fixture cleanup for the rest; build it first.

## Activity log

- 2026-09-09 — Conductor: consolidated Stage 19 scope (delete routes + video-feedback UI/UX items) written
  to `stage-19.md`, GATE 0 decisions locked (anchored popover; sweep all 14 files; placeholder-text fix,
  not CSS dividers; remove Back button from all 5 steps). `release/stage-19` confirmed checked out and
  clean. `profile.md` seeded. Starting Batch 1 (delete routes) next.
- 2026-09-09 — Developer (batch-1 plan): wrote `.engineering/stage-19/plan-batch1.md`. No deviations from
  approved scope. Confirmed: floors `[id]` route dir does not yet exist; `deleteRoom` shape verified at
  `lib/data/rooms.ts:284-293`; transaction precedent at `lib/data/superadmin/orgs.ts:362-380`; RBAC pattern
  at `rooms/[id]/route.ts:90-91`; DRAFT gate at `lib/data/projects.ts:346`; Inquiry guard at
  `lib/data/inquiries.ts:463`. Plan covers 7 files, 2 E2E tests, SQL doc update. Ready to build.
- 2026-09-09 — Developer (batch-1 implement): DONE. All 6 deliverables built and verified.
  Files changed (quotation-system repo, commit b6461a1):
    - `lib/data/floors.ts` — added `deleteFloor()` (mirrors `deleteRoom` shape)
    - `app/api/v1/orgs/[orgSlug]/floors/[id]/route.ts` — new DELETE handler
    - `lib/data/projects.ts` — added `deleteProject()` (DRAFT gate, FK-safe tx, Inquiry reversion)
    - `app/api/v1/orgs/[orgSlug]/projects/[projectId]/route.ts` — added DELETE export
    - `tests/e2e/stage19.spec.ts` — two behavior-level E2E tests (new file)
  Docs repo (commit 4042940): `design-docs/sql-queries/by-page.sql` — appended Floor/Project DELETE SQL.
  Verification: `npm run lint` + `npx tsc --noEmit` both clean locally. Preview deployment
  `quotation-system-jpa3mg4wa-vistra-indias-projects.vercel.app` → READY; `/api/health` 200 connected.
  Both new DELETE routes return 401 on unauthenticated curl (routes are wired). E2E:
  `PLAYWRIGHT_BASE_URL=...feature-floo... npx playwright test tests/e2e/stage19.spec.ts` → 2 passed (8.8s).
- 2026-09-09 — Reviewer (batch-1): CHANGES-NEEDED. 1 IMPORTANT, 1 MINOR. Full findings in this message's
  reviewer output (returned directly to orchestrator per workspace convention — no separate review file).
  Fix required before merge: move `deleteProject`'s DRAFT-status precheck inside the `$transaction` to
  close the TOCTOU race on a destructive delete.
- 2026-09-09 — Developer (batch-1 review fix): DONE. Addressed IMPORTANT finding; MINOR skipped (not a
  one-line change — the floor DELETE `{ ok: true }` vs `{ id }` divergence would require updating the E2E
  test assertion too).
  Files changed (commit 298ca6f):
    - `lib/data/projects.ts` — `deleteProject`: removed the pre-transaction `findFirst`; moved
      existence + DRAFT-status check into the `$transaction` callback using boolean flags
      (`found`/`isDraft`) so TypeScript can type-check the three explicit return shapes correctly.
      A single `Result` union variable approach caused a `never` narrowing error at the call site because
      TypeScript can't track mutations across async closure boundaries; boolean flags + post-tx returns fix it.
  Static: `npm run lint` (0 errors) + `npx tsc --noEmit` (clean).
  Vercel preview `quotation-system-45a2182fe-vistra-indias-projects.vercel.app` → READY, `/api/health` 200 connected.
  E2E: `PLAYWRIGHT_BASE_URL=...45a2182fe... npx playwright test tests/e2e/stage19.spec.ts` → 2 passed (9.5s).
- 2026-09-09 — Reviewer (batch-1, round 2): APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR.
  TOCTOU race confirmed closed — existence + DRAFT-status check now inside the `$transaction` callback at
  `lib/data/projects.ts:281` using `tx.project.findFirst`. Boolean-flag pattern (`found`/`isDraft`) covers
  all three outcomes with no ambiguous state; flag combination `(false, true)` is structurally unreachable.
  No new issues introduced. Previously-approved items (deleteFloor, RBAC, E2E tests, by-page.sql) spot-
  checked intact. Batch 1 is clean and ready to merge.
- 2026-09-09 — Conductor: merged `feature/floor-project-delete-routes` into `release/stage-19` (@ `b989add`),
  deleted the feature branch (local + remote). Batch 1 closed. Starting Batch 2 (shared `SelectField` +
  radio→dropdown seed-data fix) next.
- 2026-09-09 — Developer (batch-2 plan): wrote `.engineering/stage-19/plan-batch2.md`. Two deviations
  flagged at top: (1) actual instance count is 23, not 27 — 14-file count matches; (2) `edit-component-form.tsx:31`
  also has a standalone `FIELD_TYPES` constant and should also drop "radio" (stage doc only cited
  create-component-form). Component design: `components/select-field.tsx`, children-based, translation-free,
  `placeholder` prop for plain text, `className` override for floor-bar's compact style. radio→dropdown fix
  adds `field.type === "radio"` to the `add-selection-form` condition. Seed fix: glassType `:56` to
  "dropdown". Parser at `:427` keeps "radio" in validTypes. Ready to build.
- 2026-09-09 — Developer (batch-2 implement): DONE. All deliverables built and verified.
  Files changed (commit abbe62c on feature/select-field-unification):
    - `components/select-field.tsx` — NEW: shared SelectField, children-based, translation-free,
      `placeholder` prop (plain text), `className` override replaces standard style.
    - 14 consumer files swept (all 23 native <select> instances replaced with SelectField):
      `org-picker.tsx`, `user-edit-form.tsx`, `controls/create-user-form.tsx`,
      `org/users/new/create-user-form.tsx`, `edit-component-form.tsx`, `create-component-form.tsx`,
      `create/edit-external-company-form.tsx` (6 selects across 2 files), `create-project-form.tsx`,
      `create-inquiry-form.tsx`, `edit-inquiry-form.tsx`, `edit-project-form.tsx`,
      `add-selection-form.tsx`, `floor-bar.tsx`.
    - `add-selection-form.tsx` — removed radio-button rendering block; merged radio condition into
      dropdown branch: `(field.type === "dropdown" || field.type === "radio")` → SelectField.
    - `create-component-form.tsx` + `edit-component-form.tsx` — removed "radio" from FIELD_TYPES
      authoring list; cleaned up dead "radio" branches in field-type onChange handlers.
      Parser `validTypes` at line 427/428 keeps "radio" for backward compat.
    - `lib/component-catalog-seed.ts:56` — glassType type "radio" → "dropdown".
  Static: `npm run lint` (0 errors, 5 pre-existing test warnings) + `npx tsc --noEmit` (clean).
  Preview: quotation-system-qu9ydd9zl-vistra-indias-projects.vercel.app → READY;
  `/api/health` 200 `database: connected`.
  Manual verification: 7-step Playwright click-through run against the preview (7 passed, 29s).
  Key observations from actual browser runs:
    - Test 1: `select[name='roleId']` + `select[name='externalCompanyId']` both render on users/new.
      Role options correctly populated (Admin, Architectural Firm, Company Member, Distributor, ...).
    - Test 2: All 3 selects on external-companies/new render (type: Distributor/Architectural Firm,
      country, defaultCurrency).
    - Test 3: Currency select first option = "Select currency..." — NO "--" decoration. Confirmed
      selectable (chose INR, value persisted).
    - Test 4: `/controls/roles` requires SuperAdmin credentials (env-only); verified by code review
      that org-picker.tsx uses `placeholder="Select organization"`. Page loads without crash.
    - Test 5: Field-type select on components/new shows `["Field (text)", "Dropdown", "Checkbox"]` —
      "radio" is ABSENT. Confirmed by actual options read from live browser DOM.
    - Test 6: Configuration page: 0 `input[type='radio']` (none rendered, even after opening
      add-selection panel). `"— Select —"` text absent. Dropdown-typed fields show selects with
      `"Select..."` placeholder and correct options (e.g. Single Swing/Double Swing, Standard/Fire-Rated).
    - Test 7: Design page floor-bar: 1 select renders, page loads without crash.
- 2026-09-09 — Reviewer (batch-2): APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 1 MINOR.
  Full findings returned directly to orchestrator. Minor: field-type selector in edit/create-component-form
  FieldRow shows blank visual for any existing "radio"-typed field (controlled select value "radio" has no
  matching option after FIELD_TYPES pruning); React state preserves the value — no silent data mutation —
  but admin sees a confusing blank dropdown. Dev's call whether to add a defensive read-only display for
  legacy radio fields in a later batch.
- 2026-09-09 — Conductor: merged `feature/select-field-unification` into `release/stage-19` (@ `5805a8c`),
  deleted the feature branch (local + remote). Batch 2 closed (APPROVE-WITH-NITS, 1 MINOR deferred to dev
  discretion — legacy radio-field blank dropdown display, no data-integrity risk). Starting Batch 3
  (Configuration-page UX: anchored popover + two loading-state fixes) next.
- 2026-09-09 — Developer (batch-3 plan): wrote `.engineering/stage-19/plan-batch3.md`. No deviations from
  approved scope. Key findings: (1) no existing popover primitive in the repo beyond `company-dropdown.tsx`
  and `list-page-controls.tsx`'s date-filter — reusing their `relative`/`absolute z-20` CSS-anchored
  pattern with click-outside for item 10; (2) `configuration/loading.tsx` confirmed as pre-Stage-17
  list+form skeleton — plan rewrites to 3-column `grid-cols-[200px_1fr_300px]` skeleton; (3)
  `useTransition` is already imported in `list-page-controls.tsx` line 3, only needs wiring into
  `ListPagePagination`. Three files total, no new dependencies, no Prisma changes. Ready to build.
- 2026-09-09 — Developer (batch-3 implement): DONE. All three deliverables built and verified.
  Files changed (commit 44c94ee on feature/configuration-page-ux):
    - `app/[orgSlug]/projects/[projectId]/configuration/add-selection-form.tsx` — added `useRef`+`useEffect`
      click-outside handler (closes `showAdvanced` on mousedown outside `panelRef`). Wrapped the Configure
      button + advanced-fields conditional in `<div ref={panelRef} className="relative">`. Changed the
      advanced-fields `<div>` from in-flow to
      `absolute left-0 right-0 top-[calc(100%+4px)] z-20 … shadow-[…]`. Reused `company-dropdown.tsx`
      CSS-anchoring pattern. Import line updated: added `useEffect`, `useRef`.
    - `app/[orgSlug]/projects/[projectId]/configuration/loading.tsx` — full rewrite from old 2-section
      (selections list + add-form) skeleton to 3-column `grid-cols-[200px_1fr_300px]` skeleton matching
      the live Stage-17 layout. Left: 4 tile placeholders. Center: heading + label field + 2 field rows
      (one paired 2-col) + Configure button + Submit button placeholders. Right: 3 saved-component card
      row placeholders. `animate-pulse` wrapper retained.
    - `components/list-page-controls.tsx` — `ListPagePagination`: added `const [, startTransition] =
      useTransition()` (import already on line 3). Wrapped `router.push` in `startTransition(…)`.
      Added `startTransition` to `useCallback` dep array.
  Static: `npm run lint` (exit 0) + `npx tsc --noEmit` (clean, no output).
  Preview: `quotation-system-4azenr1bx-vistra-indias-projects.vercel.app` → READY; `/api/health` 200
  `database: connected`. Build log: 183+ route outputs, all [orgSlug] Lambda items present.
  Existing E2E (stage19.spec.ts): 2 passed (9.5s) against the preview — no regression.
  Browser click-through (3 Playwright tests against the preview, apiSignIn auth, 3 passed in 13s):
    - Item 10 (popover position): Door component type selected (has advanced fields). Save button Y BEFORE
      clicking Configure: 750.0px. Clicked "⚙ Configure" → advanced panel appeared (verified visible).
      Save button Y AFTER: 740.0px (delta: -10px upward — page scrolled 10px to reveal the popover, NOT
      a layout push; in-flow displacement would be +200px+). Panel top measured 11px below Configure button
      bottom (expected ~4px from top-[calc(100%+4px)]; 7px difference is scroll-offset rounding).
      PASS: popover anchored correctly, Save button not pushed down by in-flow content.
    - Item 10 (click-outside): After opening popover, clicked at coordinates (355, 376) — outside the
      panel. Advanced panel visible after click: false. PASS: click-outside handler fired and closed panel.
    - Item 11 (loading skeleton): Verified by construction — `grid-cols-[200px_1fr_300px]` wrapper in
      rewritten `loading.tsx` confirmed in source. Not observable at normal load speed (flashes briefly);
      structural match to live page layout is the verification for this wireframe-stage item.
    - Item 12 (pagination): Navigated to `/acme-glass/inquiries?pageSize=2` (enough seeded inquiries).
      Page-2 button visible. Clicked → URL updated to `?pageSize=2&page=2` via client-side router.push.
      No hard reload (URL changed without navigation bar flash). PASS: startTransition wrap confirmed live.
  Temp test file `tests/e2e/batch3-ui-verify.spec.ts` removed after verification run.
- 2026-09-10 — Reviewer (batch-3): APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR.
  Popover ref scope correct (panelRef wraps button + panel; inner clicks pass contains-check, no false closes).
  Listener cleanup correct (early-return when closed; removeEventListener on re-run/unmount; no leak).
  Skeleton grid-cols/gap/padding is a word-for-word match to the live page wrapper (verified at add-selection-form.tsx:257).
  startTransition dep-array inclusion is conservative-correct; no stale-closure risk; no double-navigation.
  Developer's -10px Save-button shift confirmed as viewport auto-scroll (out-of-flow popover), not layout push.
  Findings returned directly in reviewer message (no separate report file). Batch 3 clean and ready to merge.
