# Stage 26 worklog — Summary page (KPIs + material list), Recompute, PDF export

## Status block

- **Phase:** implement complete (2026-09-24) — all batches merged into `release/stage-26` @ `81eea0c`, docs closed out (docs repo `ace2d37`). Handing off to `engineering:test`.
- **Stage target:** `quotation-system-docs/development-cycles/stage-26.md` (Gate 0 approved 2026-09-24;
  docs repo commit `5c5a6ff`).
- **Branch:** `release/stage-26`, cut from `master` @ `69ec0b3` (2026-09-24, after Stage 25's production
  promotion — see Sequencing constraint in stage-26.md).
- **Profile:** `.engineering/stage-26/profile.md`.
- **Batch 0:** DONE. Human signed off `.engineering/stage-26/mockup-batch0.html` 2026-09-24 with two
  decisions, now locked in stage-26.md as S26-8 (Recompute: disabled+tooltip, not hidden, when not DRAFT)
  and S26-9 (PDF header drops formula set name/version).
- **Batch 1:** DONE. R1 checkpoint complete — `review-b1-1.md` CHANGES-NEEDED → fix round (`e663f01`) →
  `review-b1-2.md` APPROVE (mutation-tested). Merged into `release/stage-26` via merge commit, feature
  branch deleted, pushed to origin.
- **Active work item:** Batches 2-5 (Summary page UI, Recompute button, PDF export, Inventory name fix) —
  per stage-26.md's non-default cadence these get ONE combined R2 review after all four land, not per-batch.
- **Batch 2:** DONE (implementation, not yet reviewed). Pushed `feature/s26-b2-summary-page` @ `f306c7d`;
  Vercel preview READY, e2e (`stage26-summary-page`, `stage26-calculation-api` regression) both pass. See
  Activity log entry below for full detail. Not yet merged into `release/stage-26`.
- **Batch 3:** DONE (implementation, not yet reviewed). Committed to `feature/s26-b2-summary-page` @
  `9f081e3` (same branch as Batch 2, per dispatch instructions), pushed; Vercel preview READY at
  `https://quotation-system-i9zd22eml-vistra-indias-projects.vercel.app` (dpl_GYmaaAyMJZLWbVsRZ3RhHPpVJyuj),
  `/api/health` OK. New `tests/e2e/stage26-recompute.spec.ts` (2 tests) pass; regression re-run of
  `stage26-summary-page` (1 test) + `stage26-calculation-api` (4 tests) also pass — 7/7 total. Not yet
  merged into `release/stage-26`.
- **Batch 4:** DONE (implementation, not yet reviewed). Committed to `feature/s26-b2-summary-page` @
  `697b51d` (same branch as Batches 2-3), pushed; first Vercel build (`dpl_89uDvJAKGihCkpRPxhSH2eFw4ym1`)
  errored on an unrelated transient Turbopack/Google-Fonts network flake in `app/layout.tsx`'s Nunito import
  (a file Batch 4 never touches — confirmed by diffing against the prior batch's clean build log, which has
  zero font-related lines); `npx vercel redeploy` of the same commit succeeded cleanly on the first retry,
  proving the flake wasn't code-caused. Redeployed preview READY at
  `https://quotation-system-3oh1hi9i2-vistra-indias-projects.vercel.app`, `/api/health` OK, build log
  confirms `/[orgSlug]/projects/[projectId]/summary` and `/api/v1/.../calculation` routes present at commit
  `697b51d`. New `tests/e2e/stage26-pdf-export.spec.ts` (1 test) passes; regression re-run of
  `stage26-recompute` (2) + `stage26-summary-page` (1) + `stage26-calculation-api` (4) also pass — 8/8 total
  across the run. Not yet merged into `release/stage-26`.
- **Batch 5:** DONE. Committed to `feature/s26-b2-summary-page` @ `f75a97e` (same branch as Batches 2-4),
  pushed. See Activity log entry below.
- **R2 review:** APPROVE-WITH-NITS (`review-r2-1.md`) — 0 CRITICAL/IMPORTANT, 5 MINOR. M1 flagged as
  "fix before merge"; M2-M5 developer's call.
- **R2 fix round:** DONE. M1 and M3 fixed (`4482f93`, pushed to `feature/s26-b2-summary-page`); M2/M4/M5
  left as noted limitations. See Activity log entry below.
- **Next:** Re-review of the R2 fix round, then merge `feature/s26-b2-summary-page` → `release/stage-26`.

## Work items

| Batch | Description | Status |
|---|---|---|
| 0 | Mockup additions (Recompute button placement, non-standard page states, PDF header layout, footer) — human sign-off required | done |
| 1 | Calculation read API + shared view helpers | done |
| 2 | Summary page UI | not started |
| 3 | Recompute button (depends on Stage 25 problem popup) | not started |
| 4 | PDF export | not started |
| 5 | Inventory name fix (data) | done |

## Activity log

*(agents append their own thin entries below, in order)*

- **Batch 0 — developer.** Built `.engineering/stage-26/mockup-batch0.html`, a standalone throwaway HTML
  mockup (no real component code touched) covering the four gaps in `summary-page-final.html`:
  1. Recompute button placement (left of Export PDF in the existing `.action-row`) + idle/running
     (spinner+disabled)/not-DRAFT (disabled+tooltip) states.
  2. Two non-standard page states: "submitted, no calculation row yet" (empty-state + back-to-Design link,
     no Recompute) and "old FAILED row" (error banner with example `errorDetail` + Recompute, no tables).
  3. Rough PDF header layout (org, project+projectNumber, external company/end client, formula set
     name+version, Computed at) on an A4-ratio sheet placeholder.

- **Batch 1 — developer.** Implemented per `.engineering/stage-26/plan-b1.md` exactly, no deviations.
  - New `GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation/route.ts` — same
    `getApiSession`/`ApiAuthError` auth pattern as the sibling `.../projects/[projectId]/route.ts` GET;
    404 for both "project not found/wrong org" and "no calculation row yet."
  - New `getProjectCalculationForRead(session, projectId)` in `lib/data/calculations.ts` — reused the
    existing `Db`/tenancy-check idiom from `loadCalculationInput()` in the same file; explicit `select`
    (no `materialByRoom`) on top of `lib/prisma.ts`'s existing global client-level omit.
  - New Prisma-free `lib/summary/view.ts`: `rebuildDoorKpis()` (S26-3 — regroups
    `summary.floors[].rooms[].walls[].doors[]` by `(category, doorType)` at read time, since the stored
    `SummaryKpis.doorsByType` only groups by `doorType`), `buildMaterialSections()` (groups `materialList`
    by slot, titled from `ConfigSnapshot`, array-slot lines into one "Shared materials" section), and
    `formatGlassLabel`/`formatThickness`/`formatAreaM2`/`formatUnit`. Two spots the stage doc leaves open
    were resolved with the plan's stated defaults (documented inline in the file): missing-snapshot-slot
    section ordering (first-seen order), and `formatUnit`'s "pc"/"pcs" rule (added an optional `quantity`
    param to `formatUnit`, since ordinary-English singular/plural needs the row's own quantity — the
    plan's prose says this but its TS signature sketch omitted the param; flagging that the implemented
    signature is `formatUnit(unit, quantity?)`, not exactly `formatUnit(unit)` as sketched).
  - Reused: `getApiSession`/`ApiAuthError` (`lib/api-auth.ts`), `apiUnauthorized`/`apiForbidden`/
    `apiNotFound`/`apiServerError` (`lib/api-error.ts`), `SessionData` (`lib/session.ts`), `Summary`/
    `MaterialListLine`/`DoorRow` types (`lib/summary/types.ts`), `ConfigSnapshot` (`lib/config-snapshot.ts`).
  - Tests: `tests/unit/summary-view.test.ts` (Node test runner, 299 assertions total in the suite incl.
    pre-existing files) — covers the two stated invariants (door-quantity sum preserved;
    material-line-count preserved across sections) plus the formatting helpers.
    `tests/e2e/stage26-calculation-api.spec.ts` (Playwright, Tier-1 API-only pattern from
    `inventory-api.spec.ts`) — T1 401 unauth, T2 404 cross-org, T3 404 no-calculation-row, T4 200 +
    `materialByRoom` absent from the raw response text + shape assertions on a real submitted acme-glass
    project built via the API (project → floor → room → sides-convert wall → Selection → design PATCH →
    submit-design).
  - Docs: `quotation-system-docs/design-docs/sql-queries/by-page.sql` — new heading for the GET route
    under the existing submit-design/recompute section, committed+pushed to the docs repo (`main` @
    `16e8c6d`) alongside this batch, per root CLAUDE.md's same-change rule.
  - Verify: `npm run lint` clean (new files; 4 pre-existing unrelated errors in
    `.engineering/stage-22/prod-recon-readonly.ts`, not touched here). `npx tsc --noEmit` clean.
    `npm run test:unit` 299/299 pass. Pushed `feature/s26-b1-calculation-api` (commit `b757b9b`) → Vercel
    preview `https://quotation-system-3sr28athp-vistra-indias-projects.vercel.app` (deployment
    `dpl_7xuH9mAwcoBKp34zopX42BU65trR`) reached READY; build log confirms
    `ƒ /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation` registered. Ran
    `PLAYWRIGHT_BASE_URL=<preview> npx playwright test stage26-calculation-api --workers=1` against that
    preview: 4/4 passed (T1-T4). Test data (throwaway DRAFT projects) self-cleaned via the spec's
    `afterAll` DELETE calls. No local server was started.
  - Status: **DONE**. No blockers, no new decisions beyond the two already flagged in the plan and
    reiterated above.
  4. Restored "← Back / Next: Quotation →" footer, reusing the current placeholder page's classes/copy.
  Reused: CSS tokens/`.btn`/`.action-row`/`.empty-state` classes lifted directly from
  `quotation-system-docs/ui-mockups/finalized/summary-page-final.html`; footer markup/copy from
  `app/[orgSlug]/projects/[projectId]/summary/page.tsx`. Guessed items (icon choice, exact copy, PDF field
  arrangement) are called out inline in the file's yellow "Guessed" notes for the human to confirm/override.
  No code, no npm installs, no server started. **Status: awaiting human sign-off before Batch 2-4 code.**

- **Batch 1 — developer (plan).** Wrote `.engineering/stage-26/plan-b1.md`, no code yet. Plan: new route
  `app/api/v1/orgs/[orgSlug]/projects/[projectId]/calculation/route.ts` (GET, reuses the auth/tenancy pattern
  from `app/api/v1/orgs/[orgSlug]/projects/[projectId]/route.ts`); a new read helper
  `getProjectCalculationForRead()` in `lib/data/calculations.ts`; `materialByRoom` omission relies on
  `lib/prisma.ts`'s existing client-level global `omit` plus an explicit `select` (belt-and-braces); new
  Prisma-free `lib/summary/view.ts` (door-KPI rebuild, material-section grouping, glass/thickness/area/unit
  formatting) following `lib/summary/types.ts`'s existing convention; unit tests in
  `tests/unit/summary-view.test.ts`; API tests in `tests/e2e/stage26-calculation-api.spec.ts` (Playwright
  hitting the route live, same Tier-1 pattern as `tests/e2e/inventory-api.spec.ts`, run against the pushed
  branch's Vercel preview per root `CLAUDE.md` rule 7 — no local server/DB). Plan is faithful to stage-26.md
  Batch 1 and S26-1..S26-9; two spots where the stage doc leaves a literal detail open (material-section
  ordering for a slot code missing from the snapshot; `"pc"` vs `"pcs"` singular/plural rule) are called out
  explicitly in the plan with the default I'll take, not silently decided. Verify: none yet — plan only, no
  code written, no command run. **Status: DONE (plan only) — awaiting review before implementation.**

- **Batch 1 — reviewer (R1, round 1).** Verdict **CHANGES-NEEDED** — 0 CRITICAL / 1 IMPORTANT / 3 MINOR.
  Report: `.engineering/stage-26/review-b1-1.md`. The IMPORTANT finding is test-only: the door-KPI invariant
  isn't checked against stored `kpis.doorsByType` as stage-26.md requires. Route auth/tenancy and
  `materialByRoom` exclusion confirmed OK. tsc/eslint/unit tests verified clean locally.

- **Batch 1 — developer (fix round, R1 findings).** Commit `e663f01` on `feature/s26-b1-calculation-api`.
  Addressed all 4 findings in `review-b1-1.md`:
  - **IMPORTANT (fixed):** added a new test in `tests/unit/summary-view.test.ts` that builds a `Summary`
    with the real `buildSummary()` (`lib/summary/index.ts`), using two doors sharing `doorType: "Simple
    Glass"` under `category: "Single"`/`"Double"` (the real `cloisons` merge case). Asserts (a) the
    `rebuildDoorKpis()` total equals the sum of the stored `kpis.doorsByType[].quantity`, and (b) the
    rebuild returns 2 rows where the stored KPI collapsed to 1.
  - **MINOR 1 (fixed):** corrected the stale "pre-seed" comment in `lib/summary/view.ts`'s
    `buildMaterialSections` to describe the actual lazy-section-creation behavior.
  - **MINOR 2 (fixed):** added an ordering test in `tests/unit/summary-view.test.ts` asserting the full
    section order (snapshot-matched in snapshot order → unmatched in first-seen order → Shared last) with
    the unmatched slot deliberately seen before the snapshot-matched ones in the input.
  - **MINOR 3 (fixed):** extracted `orDash(value: string | null): string` in `lib/summary/view.ts`;
    `formatGlassLabel` now calls it. Exported for Batches 2/4 to reuse on door category/type fields instead
    of inlining `?? "—"` or misusing `formatGlassLabel`.
  Reused: existing `buildSummary`/`SummaryInput` fixture patterns from `tests/unit/summary-builder.test.ts`
  (door selection/design fixture shape) rather than inventing a new one.
  Verify: `npx tsc --noEmit` clean; `npm run lint` clean on both changed files (pre-existing unrelated
  errors/warnings elsewhere in the repo untouched); `npm run test:unit` 303/303 pass
  (`summary-view.test.ts` 21/21, up from 17). Pushed `e663f01`; Vercel preview
  `quotation-system-lmpuxgtpr-vistra-indias-projects.vercel.app` built `Ready` and `/api/health` returned
  `database: "connected"` — no route/UI depends on `view.ts` yet (Batch 2 not built), so this confirms a
  clean build, which is the relevant check for a pure-logic-file change. **Status: DONE.**

### Reviewer — Batch 1 re-review (R2) · 2026-09-24
Verdict **APPROVE** · 0 CRITICAL / 0 IMPORTANT / 0 MINOR new; all 4 R1 findings verified fixed (door-KPI
test confirmed on real `buildSummary()` + mutation-checked). Report: `review-b1-2.md`.

- **Batch 2 — developer (plan).** Wrote `.engineering/stage-26/plan-b2.md`, no code yet. Plan: rewrite
  `app/[orgSlug]/projects/[projectId]/summary/page.tsx` (Server Component, keeps existing redirect/
  step-gating block, adds an `internalFetch` call to Batch 1's `GET .../calculation` route, branches into
  the 3 non-redirect states); new `summary-tables.tsx` (client, KPI + Material List tables, per-section
  click-to-sort, built on Batch 1's `rebuildDoorKpis`/`buildMaterialSections`/formatting helpers); new
  `action-row.tsx` (client, Export PDF + Recompute buttons per the signed-off `mockup-batch0.html`
  layout/states, S26-8 disabled+tooltip when not DRAFT — both buttons inert, no `onClick`, for Batch 3/4 to
  wire). Two things flagged at the top of the plan as worth surfacing even though neither changes
  stage-26.md's scope: (1) chose to have Batch 2 build the full `action-row.tsx` component now (states
  only, no behavior) rather than Batch 3 building it from scratch, since the layout/DRAFT-gating is already
  approved and building it once is less rework; (2) the page fetches calculation data server-side and
  hands it to one client-island table component, an implementation-level choice not dictated by any doc.
  Reuses `fetchProjectDetail`/`ProjectDetail` (`_project-fetch.ts`), `internalFetch`, `orgHref`, and
  Batch 1's route + `lib/summary/view.ts` exports; app shell (sidebar/topbar/stepper) needs no new code —
  already provided by the existing `layout.tsx`/`wizard-page-shell.tsx`. New Playwright spec
  `tests/e2e/stage26-summary-page.spec.ts` planned, following `stage25-b2-pill-relock.spec.ts`'s
  `apiSignIn`/`orgUrl` pattern against a real submitted `cloisons` project. Verify (planned): lint +
  tsc locally, no new local-only unit test needed (sort glue is trivial, extracted+tested only if it grows
  non-trivial during implementation), e2e run against the pushed branch's Vercel preview per root CLAUDE.md
  rule 7. **Status: DONE (plan only) — awaiting review before implementation.**

- **Batch 2 — developer (implementation).** Built per `.engineering/stage-26/plan-b2.md`, no further
  deviations beyond the two already flagged in the plan.
  - Rewrote `app/[orgSlug]/projects/[projectId]/summary/page.tsx` (Server Component): kept the existing
    401/403 redirect, `notFound()`, and the partitionCount/designSubmittedAt step-gating redirect verbatim;
    added an `internalFetch` call to Batch 1's `GET .../calculation` route and branched into the 3
    renderable states (404 → "no calculation yet" empty-state + Back-to-Design link; 200 FAILED → error
    banner with `errorDetail` + `ActionRow` with `showExport={false}`; 200 OK → `ActionRow` +
    `SummaryTables` + a meta-footer with the real `formulaSet.name`/`version` + `Computed at` via a small
    inline `Intl.DateTimeFormat` — no existing date+time convention found in the app, so a local formatter
    was added, matching the plan's fallback note). Restored the `← Back` / `Next: Quotation →` footer
    verbatim from the placeholder it replaced.
  - New `action-row.tsx` (client): Recompute (outline) + Export PDF (primary) buttons, right-aligned,
    matching `mockup-batch0.html`'s idle/not-DRAFT+tooltip states (S26-8). Both `type="button"`, no
    `onClick` — inert per the plan, for Batch 3/4 to wire.
  - New `summary-tables.tsx` (client island): a generic `LedgerSection` (sortable `<tbody>` — header row,
    data rows, optional Total row) reused for a two-section KPI table (glass: `Glass Type`/`Thickness`/
    `Area`, default sort Area desc, Total row from the stored `kpis.totalPartitionSqm` per S26-7; doors:
    `Door Type`/`Category`/`Qty` via `rebuildDoorKpis()`, default sort Qty desc, Total = summed integer
    count) and an N-section Material List table (one `<tbody>` per `buildMaterialSections()` entry, Name
    column header = `section.title`, columns Code/Name/Requirement/Per Unit Qty/Item Qty, independent
    per-section sort state, no Total row). Wide/stacked layout via
    `grid-cols-1 min-[1180px]:grid-cols-[minmax(340px,5fr)_minmax(0,8fr)]` (Tailwind v4 arbitrary
    breakpoint variant, same 1180px literal `wizard-page-shell.tsx` already uses). Null `configSnapshot`
    falls back to `{ componentTypes: [] }` per the plan.
  - Reused (no rewrite): `fetchProjectDetail`/`ProjectDetail` (`_project-fetch.ts`), `internalFetch`
    (`lib/internal-fetch.ts`), `orgHref` (`lib/orgHref.ts`), Batch 1's `GET .../calculation` route shape,
    and every `lib/summary/view.ts` export (`rebuildDoorKpis`, `buildMaterialSections`, `formatGlassLabel`,
    `formatThickness`, `formatAreaM2`, `formatUnit`, `orDash`) — no new formatting helpers added there.
    Existing Sage Ease Tailwind tokens (`border-border`, `bg-bg-card`, `bg-status-failed-bg`/
    `text-status-failed-text`, etc.) reused from `app/globals.css` and sibling pages
    (`_inventory-list.tsx`, `controls/orgs/page.tsx`). App shell (sidebar/topbar/stepper) needed no new
    code — already provided by `layout.tsx`/`wizard-page-shell.tsx`.
  - No new decisions beyond the two flagged in the plan. Confirmed no new/changed Prisma call in this
    batch (the page reads via Batch 1's API route, not Prisma directly) — `by-page.sql` left untouched,
    as the plan predicted.
  - Tests: no new unit tests (sort-toggle logic is trivial `Array.prototype.sort` glue inside the client
    component, as scoped in the plan — did not grow non-trivial branching during implementation). New
    `tests/e2e/stage26-summary-page.spec.ts` (Playwright): builds a submitted `cloisons` project via the
    API (GLASS + two DOOR selections in different categories — Single/Double — on a 3-section partition),
    asserts both tables render, door rows show both categories, the rendered Material List row count
    equals a parallel `GET .../calculation` call's `materialList.length`, and the page text contains
    neither `"null"` nor `"mm mm"`.
  - Verify: `npm run lint` clean (new/changed files only — same 4 pre-existing unrelated errors in
    `.engineering/stage-22/prod-recon-readonly.ts`, untouched here). `npx tsc --noEmit` clean (one generic
    type error in `summary-tables.tsx`'s `nextSort` helper found and fixed during implementation — made it
    generic over `T` instead of `unknown`). Pushed `feature/s26-b2-summary-page` (commit `f306c7d`) →
    Vercel preview `https://quotation-system-h8bkdihlj-vistra-indias-projects.vercel.app`
    (`dpl_Gs9XAdmRvSiB2xD94chNtW9pbiRd`, alias
    `quotation-system-git-feature-s26-3c3c85-vistra-indias-projects.vercel.app`) reached READY; build log
    confirmed `Cloning ... Commit: f306c7d` and both
    `ƒ /[orgSlug]/projects/[projectId]/summary` and
    `ƒ /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation` registered. Ran
    `PLAYWRIGHT_BASE_URL=<preview> npx playwright test stage26-summary-page --workers=1` against that
    preview: 1/1 passed. Also re-ran Batch 1's `stage26-calculation-api` spec against the same preview as a
    regression check: 4/4 passed. Test data (throwaway DRAFT projects) self-cleaned via the spec's
    `afterAll` DELETE calls. No local server was started.
  - Status: **DONE**. No blockers.

- **Batch 3 — developer (plan).** Wrote `.engineering/stage-26/plan-b3.md`, no code yet. Plan: wire
  `action-row.tsx`'s Recompute button to `POST .../recompute` following the exact fetch/status-branching
  pattern already established by `design-workspace.tsx`'s `handleSubmitDesign` (Stage 25 Batch 9) — 401/403
  → `redirectToLogin`, 422 → open `ProblemPopup` (no `onNavigateToPartition`, confirmed the component
  already falls back to real `<Link>` cross-page nav), 409 → inline conflict message (not a popup/error
  screen), 200 → `router.refresh()`. Adds `orgSlug`/`projectId`/`isSubdomain` props to `ActionRow`, sourced
  in `page.tsx` via `detectIsSubdomain()` (same helper `design/page.tsx` already calls). Confirmed the
  `recompute` route's actual 409/422/200 response shapes by reading the route file directly rather than
  assuming. Reuses `redirectToLogin` (`design/login-redirect.ts`), `ProblemPopup`
  (`_problem-popup.tsx`, Stage 25 Batch 9, unmodified), `detectIsSubdomain` (`lib/orgHref.ts`). New e2e
  `tests/e2e/stage26-recompute.spec.ts` planned: clean-DRAFT recompute changes `computedAt`; recompute after
  deactivating a depended-on `InventoryItem` opens the popup with stored figures unchanged. One
  implementation-level (non-design) choice flagged: `ActionRow` itself owns the fetch/popup state rather
  than a new wrapper component — within Batch 2's already-approved file boundaries, not a scope change. No
  other deviations from stage-26.md Batch 3 / S26-8. **Status: DONE (plan only) — awaiting review before
  implementation.**

- **Batch 3 — developer (implementation).** Wired `action-row.tsx`'s Recompute button exactly per
  `plan-b3.md`: `useState` for `recomputing`/`report`/`conflictMessage`, `useRouter` from `next/navigation`,
  `handleRecompute()` — 401/403 → `redirectToLogin(orgSlug, isSubdomain)` (reused, unmodified), 422 with a
  valid `CalculationProblemReport` body → `setReport()` opens `<ProblemPopup title="Recompute failed" ...>`
  (no `onNavigateToPartition`, per the component's own documented Summary-page fallback), malformed 422 body
  → generic conflict message, 409/other `!res.ok` → `setConflictMessage(body.error ?? ...)` rendered inline
  (`role="alert"`, `text-text-muted` token — confirmed present in `app/globals.css`'s existing usages, no new
  color), 200 → `router.refresh()`. Button `disabled={!isDraft || recomputing}`, label/icon swap to
  "Recomputing…" + `animate-spin` while in flight. `page.tsx`: added `detectIsSubdomain(orgSlug)`,
  parallel-awaited via `Promise.all` alongside the existing `fetchProjectDetail` call; threads
  `orgSlug`/`projectId`/`isSubdomain` into both `<ActionRow>` call sites (FAILED-row and OK-row states).
  Reused: `redirectToLogin`/`loginHref` (`design/login-redirect.ts`), `ProblemPopup`/`ProblemPopupProps`
  (`_problem-popup.tsx`, untouched), `detectIsSubdomain` (`lib/orgHref.ts`), the recompute route's already-
  documented 401/403/404/409×3/422/200 contract (`recompute/route.ts`, read directly, not assumed). No
  deviations from the plan.
  - New e2e: `tests/e2e/stage26-recompute.spec.ts` — two tests against a fresh submitted `cloisons` project
    per test (same floor/room/sides/selection/design-PATCH/submit-design sequence as
    `stage26-summary-page.spec.ts`): (1) clean-DRAFT Recompute click → button shows "Recomputing…" → re-
    enables → a parallel `GET .../calculation` shows a later `computedAt` than before the click; (2)
    deactivate the GLASS selection's `GLASS-ACGSK-01` InventoryItem (`PATCH .../inventory/[itemId]`,
    `{active: false}`) → Recompute click → `[role="dialog"]` opens with a `[data-testid="problem-row"]` and
    "Fix your inventory" text → on-screen Material List row count and a follow-up `GET .../calculation`'s
    `computedAt`/`materialList.length` are unchanged from before the click (stored row untouched, no
    `router.refresh()` on the 422 path) → item reactivated immediately after the assertion (also covered by
    `afterAll` as a backstop) so the shared `cloisons` catalog isn't left broken for a concurrently-running
    spec.
  - Verification: `npm run lint` (clean on all touched files — 4 pre-existing errors elsewhere in
    `.engineering/stage-22/prod-recon-readonly.ts`, unrelated) and `npx tsc --noEmit` (clean, no output)
    locally. Committed to `feature/s26-b2-summary-page` @ `9f081e3`, pushed. Vercel preview
    `https://quotation-system-i9zd22eml-vistra-indias-projects.vercel.app`
    (`dpl_GYmaaAyMJZLWbVsRZ3RhHPpVJyuj`) reached READY; `/api/health` → `{"status":"ok","database":
    "connected",...}`. Ran `PLAYWRIGHT_BASE_URL=<preview> npx playwright test stage26-recompute --workers=1`:
    2/2 passed. Re-ran `stage26-summary-page` + `stage26-calculation-api` as regression: 5/5 passed (7/7
    total across the run). Test data self-cleaned via each spec's `afterAll` DELETE/reactivate. No local
    server was started at any point (`npx vercel inspect`/`ls` used for polling, not a deploy action).
  - Status: **DONE**. No blockers. Not yet merged into `release/stage-26` — awaiting the combined R2 review
    of Batches 2-5.

- **Batch 4 — developer (plan).** Wrote `.engineering/stage-26/plan-b4.md`, no code/npm installs yet. Plan:
  `package.json` gains `jspdf@^4.2.1`/`jspdf-autotable@^5.0.8` (current majors, confirmed via `npm view`;
  peer-dep compatible); new Prisma-free/jsPDF-free `lib/summary/pdf-rows.ts` (reuses every Batch 1
  `lib/summary/view.ts` export — no re-derivation — to build fixed-default-order `PdfTable`/
  `PdfHeaderFields` data, plus a `resolveClientField()` helper for the "external company or end client"
  branch); new `lib/summary/pdf.ts` (the only file importing `jspdf`/`jspdf-autotable`, both dynamically
  imported inside `generateSummaryPdf()` — loaded only on Export click per S26-5); `action-row.tsx` gains
  the wired Export handler + new props; `page.tsx` gains a second parallel `internalFetch(".../me")` call
  for `orgName` and computes the filename/client-field inputs. Confirmed the PDF header has **no formula
  set name/version** anywhere (S26-9) — only org name, project name+projectNumber, external company/end
  client, Computed at. Two implementation-level decisions flagged at the top of the plan (not scope
  deviations): (1) the extra `/me` fetch for org name, since no existing fetched data carries it; (2)
  external-company-wins-over-end-client precedence when a project somehow has both. Fonts: decided to keep
  built-in Helvetica (WinAnsi covers the real `cloisons`/French data today) and recorded Arabic/non-Latin
  UAE-distributor names as a known limitation, per the stage doc's own "record as a known limitation"
  option — no TTF embed. Tests planned: `tests/unit/pdf-rows.test.ts` (pure data-shaping, no jsPDF import,
  mirrors Batch 1's invariant-style tests) and `tests/e2e/stage26-pdf-export.spec.ts` (Playwright
  `page.waitForEvent("download")`, filename regex, non-empty file size, reusing
  `stage26-summary-page.spec.ts`'s project-setup helpers verbatim). Verify (planned): lint + tsc locally,
  `npm run test:unit`, push + Vercel preview `READY`, e2e against that preview per root CLAUDE.md rule 7,
  plus a regression re-run of the three existing Stage 26 e2e specs since `action-row.tsx`/`page.tsx` are
  edited again. **Status: DONE (plan only) — awaiting review before implementation.**

- **Batch 4 — developer (implementation).** Followed `plan-b4.md` exactly. `npm install jspdf@^4.2.1
  jspdf-autotable@^5.0.8` — `npm audit` after install shows 18 pre-existing advisories (next, prisma,
  postcss, expr-eval, etc., all present before this install), **zero** attributable to `jspdf`/
  `jspdf-autotable` (confirmed via `npm audit --json` filtered on package name) — no HIGH/CRITICAL flag
  needed per the plan's stop condition. `lib/summary/pdf-rows.ts`: `PdfHeaderFields`, `resolveClientField()`
  (external company wins, "—" fallback), `PdfTable`, `buildKpiPdfTables()` (Total row from
  `summary.kpis.totalPartitionSqm`/summed door quantity, never a sum of rounded body rows — S26-7), and
  `buildMaterialPdfTables()` (one table per `buildMaterialSections()` entry, no Total row), all built on
  Batch 1's `lib/summary/view.ts` exports unmodified. `lib/summary/pdf.ts`: the sole jsPDF/jspdf-autotable
  import site, both dynamically imported inside `generateSummaryPdf()`. **One deliberate deviation from the
  plan's literal API description** (not a scope/behavior change): used jspdf-autotable's standalone
  `autoTable(doc, options)` function export rather than the `doc.autoTable()` prototype method the plan
  described — read `node_modules/jspdf-autotable/dist/jspdf.plugin.autotable.mjs` and confirmed the
  prototype method is only auto-attached when a global `window.jsPDF` exists (script-tag usage), which a
  bundled ESM dynamic import never sets up, so `doc.autoTable()` would silently be `undefined` in this
  Next.js bundle. The standalone function still sets `doc.lastAutoTable` as a side effect (`drawTable()`
  assigns it unconditionally), so the finalY-chaining/footer-second-pass logic in the plan works unchanged.
  Header layout matches the plan's 2x2 meta grid (org name/PROJECT SUMMARY/rule/Project+Client row/Computed
  at row) — **confirmed via grep of `pdf.ts`, `pdf-rows.ts`, and `action-row.tsx`: zero references to
  `formulaSet`/`FormulaSet` anywhere in the export path; `calc.formulaSet` in `page.tsx` is only read for
  the on-screen meta-footer, never passed into `<ActionRow>`'s PDF props** (S26-9 satisfied). `action-row.tsx`:
  new optional props (only required when `showExport`), `handleExport()` dynamically imports both
  `pdf-rows`/`pdf`, reuses the existing `conflictMessage` UI for failures, `exporting` state disables the
  button + swaps label to "Generating…" (mirrors the Recompute pattern). `page.tsx`: added a second
  parallel `internalFetch(".../me")` call for `orgName` (falls back to `orgSlug` on failure, same fallback
  `me/route.ts` itself uses), `resolveClientField()`, a 3-line local `yyyyMmDd()` helper for the filename,
  reuses the existing `dateTimeFmt` for `computedAtLabel`. `tsc --noEmit` was clean both before and after
  this batch's edits (checked incrementally).
  - New unit tests: `tests/unit/pdf-rows.test.ts` — `buildKpiPdfTables` (row count/order ties to
    `sqmByGlassType`/`rebuildDoorKpis`, Total rows read the stored KPI not a body-row sum),
    `buildMaterialPdfTables` (total row count across tables === `materialList.length`, no Total row on any
    table, section order matches `buildMaterialSections()`, plus one real-`buildSummary()`-fixture
    integration case), `resolveClientField` (all four precedence cases). `npm run test:unit`: 314/314 pass.
  - New e2e: `tests/e2e/stage26-pdf-export.spec.ts` — reuses `stage26-summary-page.spec.ts`'s setup sequence
    verbatim (project → floor → room → sides → GLASS+DOOR selections → design PATCH → submit-design), then
    clicks Export PDF while awaiting `page.waitForEvent("download")` (real browser download, no mocking),
    asserts `suggestedFilename()` matches `^summary-\d+-\d{4}-\d{2}-\d{2}\.pdf$` and the downloaded file's
    byte size is `> 0`.
  - Verification: `npm run lint` and `npx tsc --noEmit` clean on all touched/new files (repo-wide lint shows
    only the same 4 pre-existing `.engineering/stage-22/prod-recon-readonly.ts` errors + pre-existing
    warnings elsewhere, none in this batch's files). `npm run test:unit`: 314/314 pass. Committed to
    `feature/s26-b2-summary-page` @ `697b51d`, pushed. **First Vercel build
    (`dpl_89uDvJAKGihCkpRPxhSH2eFw4ym1`) errored** — `Turbopack build failed ... Module not found:
    @vercel/turbopack-next/internal/font/google/font` inside `app/layout.tsx`'s Nunito import chain, a file
    this batch never touches. Diffed against Batch 3's own clean build log (zero font-related lines) to rule
    out a code cause, then ran `npx vercel redeploy` of the same commit — **succeeded on the first retry**
    with no code change, confirming a transient Google-Fonts-fetch network flake in the build sandbox, not a
    regression from this batch. Redeployed preview
    `https://quotation-system-3oh1hi9i2-vistra-indias-projects.vercel.app`
    (`dpl_6u8JCff264wv88frKeqVyJzC4KTc`) reached READY; `/api/health` → `{"status":"ok","database":
    "connected",...}`; build log confirms `/[orgSlug]/projects/[projectId]/summary` and
    `/api/v1/.../calculation` routes present, same commit `697b51d`. Ran
    `PLAYWRIGHT_BASE_URL=<preview> npx playwright test stage26-pdf-export --workers=1`: 1/1 passed. Re-ran
    `stage26-recompute` + `stage26-summary-page` + `stage26-calculation-api` as regression: 7/7 passed (8/8
    total across the run). No local server was started at any point.
  - Status: **DONE**. No blockers, no open concerns. Not yet merged into `release/stage-26` — awaiting the
    combined R2 review of Batches 2-5.

- **Batch 5 — developer.** Trivial-tier data fix in `prisma/inventory/cloisons-inventory.ts`: renamed the
  three GLASS_PROFILE seed items so the display name no longer repeats the code — `"U Profile I LUF-01"` →
  `"U Profile"`, `"I Profile I10 PDL"` → `"I Profile"`, `"L Profile I LUO-01"` → `"L Profile"` (the `code`
  field itself is unchanged). Grepped the repo for the exact old strings first to confirm formatting before
  editing; grepped again afterward across `tests/` and the whole repo — no test or other file referenced
  these strings, so nothing else needed updating. Per the stage doc, production data correction (via Stage
  25's Inventory edit popup) and recompute of existing projects are explicitly the human's job, out of scope
  here — no prod DB access was used or attempted.
  - Verify: `npx tsc --noEmit` clean (no output). `npm run lint`: 4 pre-existing errors, all in
    `.engineering/stage-22/prod-recon-readonly.ts` (a gitignored scratch file untouched by this batch,
    unrelated to the seed change) — no new lint issues introduced.
  - Committed `f75a97e` on `feature/s26-b2-summary-page`, pushed to origin (same branch as Batches 2-4, per
    dispatch instructions, so it's included in the combined R2 diff). No Vercel preview e2e run for this
    batch — pure data-literal change with no route/UI/migration implications, per dispatch instructions.
  - Status: **DONE**. No blockers.

- **R2 review (Batches 2-5), round 1 — reviewer.** Verdict **APPROVE-WITH-NITS** — 0 CRITICAL / 0 IMPORTANT
  / 5 MINOR. All locked decisions (S26-1, S26-3..S26-9) checked in the code and passing. tsc and lint on
  changed files are clean, unit tests 314/314 pass, and npm audit shows no jspdf advisories. M1 (a PDF
  section title can end up alone at a page bottom) is recommended before merge. Report:
  `.engineering/stage-26/review-r2-1.md`.

- **R2 fix round — developer.** Addressed `review-r2-1.md` findings, committed `4482f93` on
  `feature/s26-b2-summary-page`, pushed.
  - **M1 (fixed, required):** `lib/summary/pdf.ts`'s `drawTable()` now checks, before drawing the section
    title, whether `startY + 60` (title + head row + one body row) fits above `pageHeight - PAGE_MARGIN`;
    if not, it calls `doc.addPage()` and resets `startY = PAGE_MARGIN` first, so the title is never
    orphaned on the page before its table.
  - **M2 (not fixed, no code issue):** reviewer confirmed the PDF's row order is correct per spec (fixed
    stored order, not the on-screen sort); only `plan-b4.md`'s prose claim was inaccurate. No code change
    needed; leaving the plan doc as-is since it doesn't affect behavior or future readers materially.
  - **M3 (fixed, cheap):** `.../summary/page.tsx`'s calculation fetch now branches on `calcRes.status`:
    only a real `404` renders the existing empty-card "no calculation yet" state; any other non-OK status
    (e.g. a `500`) now `throw`s so `app/global-error.tsx` handles it instead of misleadingly telling the
    user to resubmit the design.
  - **M4 (left as known limitation):** server-side UTC date formatting (both "Computed at" and the PDF
    filename) is consistent with existing practice elsewhere in the app (`app/organizations/page.tsx`)
    and isn't a regression from this batch. Fixing it (org-timezone formatting + client-side filename
    date) is a small but real behavior change beyond the review's "nit" framing — noted here rather than
    folded into a nit-chase; worth a follow-up ticket if the human wants org-local times.
  - **M5 (left as known limitation):** `summary-tables.tsx`'s per-section sort state not growing after a
    Recompute adds a new material section is a rare edge case (only hit when Inventory/formula-set
    composition changes mid-session) with a one-reload workaround. Left as-is per the reviewer's own
    "take it only if you're already in the file" framing.
  - **Verification:** `npx tsc --noEmit` clean; `npx eslint` on both changed files clean; `npm run
    test:unit` 314/314 pass. Pushed `4482f93`; polled the resulting Vercel preview
    (`https://quotation-system-qsiuaub1x-vistra-indias-projects.vercel.app`) to `READY` via
    `npx vercel inspect`, confirmed `/api/health` returns `database: "connected"`. Re-ran e2e against that
    fresh preview (`PLAYWRIGHT_BASE_URL=<preview> npx playwright test ... --workers=1`):
    `stage26-pdf-export` (1), `stage26-summary-page` (1), `stage26-calculation-api` (4),
    `stage26-recompute` (2) — 8/8 pass, matching the R2 developer's original full regression set.
  - Status: **DONE**.

---

## Activity log — devops (2026-09-24): Stage 26 promoted to test environment

- **Role:** devops
- **Task:** Merge `release/stage-26` into `staging` and verify on `test.easeetool.com`.
- **Pre-merge state:** `staging` @ `69ec0b3` (Stage 25 close-out), `release/stage-26` @ `38f2389` (one commit ahead of `81eea0c` — the "worklog status - implement complete" commit). Fast-forward possible: `staging` is an ancestor of `release/stage-26`.
- **Merge:** `git merge --ff-only origin/release/stage-26` onto local `staging`, then `git push origin staging`. Clean fast-forward, no conflicts. `staging` pushed to `origin` @ `38f2389`.
- **Migrations:** None — Stage 26 is code-only. Confirmed: no new migration files in the diff vs. prior staging head.
- **Deployment:** `dpl_BzpbyAse6AWptpu5FuniY48ss8Ko` built from commit `38f2389` on `staging`. Build time: 1m 10s. State: **READY**.
- **Aliases on deployment:** `test.easeetool.com`, `*.test.easeetool.com`, `quotation-system-git-staging-vistra-indias-projects.vercel.app`. `test.easeetool.com` auto-follows the `staging` branch (dashboard assignment) — no manual re-point needed.
- **Health check:** `GET https://test.easeetool.com/api/health` → 200 `{"status":"ok","database":"connected","healthCheckRows":0}`.
- **Route verification:**
  - `/api/v1/orgs/[orgSlug]/projects/[projectId]/calculation` — confirmed via live fetch: `x-matched-path` = `/api/v1/orgs/[orgSlug]/projects/[projectId]/calculation`, 401 (auth-gated, route present).
  - `/[orgSlug]/projects/[projectId]/summary` — confirmed via live fetch: `x-matched-path` = `/[orgSlug]/projects/[projectId]/summary`, 200 with login redirect (route present, `data-dpl-id="dpl_BzpbyAse6AWptpu5FuniY48ss8Ko"` in HTML confirms correct deployment).
- **Status:** DONE — `test.easeetool.com` is now serving Stage 26 @ `38f2389`. Ready for `engineering:test`.

- **tester (round 1)** - PASS - 0 CRITICAL / 0 MAJOR / 0 MINOR (2 informational notes) - see `.engineering/stage-26/bugs-1.md`. New tests on `feature/s26-tests` @ e84873d.
