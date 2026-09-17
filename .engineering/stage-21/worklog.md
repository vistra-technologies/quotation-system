# Stage 21 — worklog

Stage target: `quotation-system-docs/development-cycles/stage-21/stage-21.md` (+ per-track task files
under `.../stage-21/tasks/`). Profile: `.engineering/stage-21/profile.md`.

`release/stage-21` cut from `master` @ `7e47da4`, 2026-09-15.

Run instruction: devs may reach out to the architect if unclear on task execution.

---

## Work items

| ID | Track | Task(s) | Depends on | Status | Branch | Detail |
|---|---|---|---|---|---|---|
| T0.1 | 0 | S21-0.1 token mapping | — | approved | `feature/s21-t0-foundation` | |
| T0.2 | 0 | S21-0.2 padding trim | — | approved | `feature/s21-t0-foundation` | |
| T0.3 | 0 | S21-0.3 CSS grid shell | 0.1 | approved | `feature/s21-t0-foundation` | |
| T0.4 | 0 | S21-0.4 draft-state reducer/context (hard gate, highest risk) | — | approved | `feature/s21-t0-foundation` | |
| T0.5 | 0 | S21-0.5 ContextMenu primitive | — | approved | `feature/s21-t0-foundation` | |
| T0.6 | 0 | S21-0.6 unsaved-changes modal | 0.4 | approved | `feature/s21-t0-foundation` | |
| A1 | A | S21-A1 floor bar | Track 0 | merged | `feature/s21-trackA-left-rail` | 9de0573 |
| A2 | A | S21-A2 collapsible room groups | Track 0 | merged | `feature/s21-trackA-left-rail` | 9de0573 |
| A3 | A | S21-A3 partition rows + preview | Track 0 | merged | `feature/s21-trackA-left-rail` | 9de0573 |
| A4 | A | S21-A4 inline add-room form | Track 0 | merged | `feature/s21-trackA-left-rail` | 9de0573 |
| B1 | B | S21-B1 empty state | Track 0 | merged | `feature/s21-trackB-layout-mode` | 019aa6e |
| B2 | B | S21-B2 room header + floorplan | Track 0 | merged | `feature/s21-trackB-layout-mode` | 019aa6e |
| C1 | C | S21-C1 wall details inline convert (retires add-wall) | Track 0, B2 | merged | `feature/s21-trackC-right-rail` | a608c9d |
| C2 | C | S21-C2 saved components rail | Track 0, D2 | merged | `feature/s21-trackC-right-rail` | a608c9d |
| C3 | C | S21-C3 door height slider | C2 | merged | `feature/s21-trackC-right-rail` | a608c9d |
| D1 | D | S21-D1 configure-mode shell | Track 0 | merged | `feature/s21-trackD-configure-mode` | 28ea78c |
| D2 | D | S21-D2 wall canvas | D1 | merged | `feature/s21-trackD-configure-mode` | 28ea78c |
| D3 | D | S21-D3 multi-select + panel menu | D2, 0.5 | merged | `feature/s21-trackD-configure-mode` | 28ea78c |
| D4 | D | S21-D4 door context menu | D3 | merged | `feature/s21-trackD-configure-mode` | 28ea78c |
| INT | — | Integration wiring (design-workspace.tsx consolidation) | A, B, D | merged | `feature/s21-integration-wiring` | 874cbdc |
| FIX | — | Final labels fix (Track C review findings) | C | merged | `feature/s21-final-workspace-labels` | a06459d |

Track 0 is solo/serial internally (no file conflicts expected across its 6 tasks, but it's small enough
to run as one dev pass rather than parallelize further). GATE A: Track 0 fully reviewed+merged into
`release/stage-21` before any of A/B/C/D starts. Within Track 0, 0.4 is the single biggest risk (draft
state model) — flag immediately if the reducer contract can't stay append-only-compatible with all four
tracks' anticipated actions per their task files.

---

## Activity log

- 2026-09-15 — orchestrator: scaffolded `.engineering/stage-21/` (`profile.md`, this file), cut and
  pushed `release/stage-21` off `master` @ `7e47da4`. Starting Step 1 triage → Track 0 dispatch.
- 2026-09-15 — developer (T0): plan written for all 6 Track 0 tasks (S21-0.1–0.6). See
  `.engineering/stage-21/plan-track0.md`. Branch `feature/s21-t0-foundation` cut from
  `release/stage-21` and pushed. Key contract in the plan: draft-state reducer action union
  (`DraftAction`, 18 action types), context API surface (`DraftContextValue`), and the
  append-only compatibility rule (Tracks A–D add cases without touching
  `design-workspace.tsx`). One pre-flagged decision: `ConfirmDialog` three-button extension
  vs. a dedicated component — plan proposes extending with optional `thirdAction` prop;
  reviewer should confirm or redirect before T0.6 implementation. T0.1–0.6 status: planned.
- 2026-09-15 — developer (T0): all 6 Track 0 tasks implemented. Commit `68136bc` on
  `feature/s21-t0-foundation`. Vercel preview READY:
  https://quotation-system-fciy7yl50-vistra-indias-projects.vercel.app (alias:
  quotation-system-git-feature-s21-7d1b0d-vistra-indias-projects.vercel.app).
  Health check: `{"status":"ok","database":"connected"}`. Design route 200.
  lint: 0 errors / 5 pre-existing test-file warnings. tsc --noEmit: clean.
  Files changed: app/globals.css, design-draft-context.tsx (new),
  design-workspace.tsx, configure-mode.tsx, saved-components-rail.tsx,
  panel-list.tsx, wall-canvas.tsx, types.ts, confirm-dialog.tsx,
  components/context-menu.tsx (new), messages/en.json, layout.tsx + 5 wizard pages.
  Notable decisions taken: `pendingRoomNameEdits: Record<string,string>` added to
  DraftState for deferred room renames (Track B S21-B2 compatibility); `thirdAction`
  optional prop on ConfirmDialog (backward-compatible); Escape key capture:true on
  ContextMenu to intercept before Configure-mode handler.
  T0.1–0.6 status: ready for review.
- 2026-09-15 — reviewer (round 1): CHANGES-NEEDED. 3 IMPORTANT / 3 MINOR. See
  `.engineering/stage-21/review-track0.md`. Architecture is sound — draft isolation
  confirmed, frozen contract confirmed, SET_ROOM_NAME/pendingRoomNameEdits implemented
  correctly, MAKE_EQUAL_WIDTH/SPLIT/UNITE sum invariants exact. Three blockers require
  fixes before GATE A clears: (1) SET_PARTITION_WIDTH proportional rescale rounding can
  save wrong widthMm to DB — apply last-panel-absorbs-remainder fix; (2) ConfirmDialog
  primary button changed red→green, breaking existing destructive-action dialogs — add
  confirmVariant prop defaulting to "danger"; (3) toggleDoor replace-with-different-
  component removes door instead of replacing it — two-dispatch fix in saved-components-rail.
- 2026-09-15 — developer (T0): round-2 fixes. Commit `b8189c8`. All 3 IMPORTANT + 3 MINOR
  findings addressed: SET_PARTITION_WIDTH last-panel remainder fix; confirmVariant prop
  (default "danger"); toggleDoor double-dispatch; SPLIT_PANEL type:"glass"; cancellation
  token on enterConfigureMode; busyPleaseWait key removed.
- 2026-09-15 — reviewer (round 2): APPROVE. 0 CRITICAL / 0 IMPORTANT / 0 MINOR. See
  `.engineering/stage-21/review-track0.md`. All 6 findings verified resolved — sum
  invariant traced for 4 edge cases, ConfirmDialog default/layout/caller impact confirmed,
  toggleDoor double-dispatch React batching confirmed (no flash), cancellation token
  pattern correct. GATE A clears. Tracks A–D may proceed.
- 2026-09-15 — reviewer (Track B, round 1): CHANGES-NEEDED. 4 IMPORTANT / 3 MINOR. See
  `.engineering/stage-21/review-trackB.md`. Draft-defer logic in `room-name-input.tsx` is
  structurally correct; SVG miter geometry confirmed equivalent to mockup's CSS clip-path;
  B1 functional wiring confirmed complete. Four IMPORTANT blockers: (1) Discard doesn't reset
  room name input — local `value` state stale after context cleared, re-dirties draft on next
  blur; (2) tooltip direction wrong for bottom/left/right edges — always renders above; (3)
  legend partition swatch is solid color, not diagonal stripe per mockup; (4) tooltip content
  unmet AC (missing positional prefix + panel count) — requires fix or formal deviation
  registration in stage-21.md.

- 2026-09-15 — reviewer (Track A, round 1): CHANGES-NEEDED. 1 IMPORTANT / 2 MINOR. See `.engineering/stage-21/review-trackA.md`. Backend (PATCH route + renameFloor DAL) clean — tenancy/auth pattern matches codebase exactly, duplicate-label mapping correct. Partition preview matches mockup CSS to the pixel. Floor bar inline-form UX, delete gating, and i18n all correct. One IMPORTANT blocker: all partition rows unconditionally styled as active (border-primary + bg-primary-softer) — missing selectedPartitionId prop on RoomListProps means every row always looks selected; fix requires adding the optional prop and a conditional class. Two MINOR: hardcoded "+ Add Room" string bypasses t("newRoom"), silent room-delete failure shows no user error. Integration deferred items (onSelectPartition/onFloorRenamed/onRoomDeleted wiring) acknowledged, not flagged.

- 2026-09-15 — reviewer (Track B, round 2): APPROVE-WITH-NITS. 0 IMPORTANT / 1 new MINOR. See `.engineering/stage-21/review-trackB.md`. All 4 IMPORTANT findings verified resolved: Guard 2 render-time pattern safe (loop traced — stable after 1 re-render, no infinite cycle); tooltipTransform traced for all 4 edges, directions correct; legend gradient CSS matches mockup line 518; panel count sourced from design.panels confirmed available in collection route (listPartitionsByRoom has no select restriction, route passes full row through). One new MINOR: types.ts PartitionRow.design comment now misleading since tipFor() reads it — update the comment. MINOR 5/6 (frozen file button style, SVG stroke vs outline) remain open follow-ups for Track 0 before release/stage-21 merges.
- 2026-09-15 — reviewer (Track A, round 2): APPROVE. All 3 findings from round 1 resolved. See `.engineering/stage-21/review-trackA.md` round-2 section. selectedPartitionId ternary verified: undefined === partition.id always false, all rows neutral by default until workspace.tsx wires the prop. i18n key swap confirmed. Delete-error state and render confirmed, consistent with floor-bar pattern.
- 2026-09-15 — developer (Track D): D1–D4 implemented, 4 commits pushed to `feature/s21-trackD-configure-mode`. See `item-trackD.md` for full detail. Commits: a900550 (D1), 21b8a4b (D2), db96528 (D3), a412970 (D4). Vercel preview READY: https://quotation-system-9gu91u66y-vistra-indias-projects.vercel.app. Health check: `{"status":"ok","database":"connected"}`. Bundle verified (all Track D action types + translation keys confirmed in production JS chunk 09_caindjr9fp). Design page loads correctly with all Track D translations. No Exclude/Include anywhere. No unit-toggle anywhere. Sum invariant: computeSumPreservingWidths() uses last-absorbs-remainder to guarantee exact sum preservation. DraftAction append-only: added SET_PANEL_WIDTHS_MAP only. design-workspace.tsx not touched. Auth limitation on feature preview URL (cookie domain mismatch on *.vercel.app) prevents Playwright e2e login — pre-existing infrastructure constraint, not a Track D regression. Track D ready for review.
- 2026-09-15 — developer (Track D, round-2 fixes): 3 review findings addressed in commit `28ea78c`. (1) IMPORTANT: computeSumPreservingWidths — removed Math.max(1,…) from intermediates, added lastValue < 1 infeasibility check; repro case [1000,2,1]+997 now returns null instead of writing sum 1004. (2) MINOR: isContiguousSelection — single-panel returns false; added -1 guard for missing IDs. (3) MINOR: removed dead en.json keys hintNone/hintPanel/hintEdge. Pushed to feature/s21-trackD-configure-mode.
- 2026-09-15 — reviewer (Track D, round 1): CHANGES-NEEDED. 1 IMPORTANT / 2 MINOR. See `.engineering/stage-21/review-trackD.md`. Architecture is sound — draft isolation confirmed, scope removals (Exclude/Include, unit toggle) confirmed absent everywhere, design-workspace.tsx untouched, SET_PANEL_WIDTHS_MAP reducer sets isDirty via mutatePanels, door hinge mirroring correct, door onContextMenu stopPropagation correct, both context menus on Track 0 primitive. One blocker: computeSumPreservingWidths() applies Math.max(1,…) to intermediate non-target elements before computing the adjustment, which inflates scaledSum above newNonTargetTotal when small panels are present; the last absorber then gets clamped to 1 and cannot compensate, breaking the exact-sum invariant. Unreachable with panels >= ~200mm (practical floor for glass), but the invariant must be exact per spec. Fix: remove Math.max(1,…) from intermediate scaled elements; check final absorber >= 1 and return null if not. Two MINOR: isContiguousSelection deviates from verbatim mockup spec (returns true for single-panel, missing indices.length guard — no functional impact); hintNone/hintPanel/hintEdge become orphaned dead keys in messages/en.json.

- 2026-09-16 — reviewer (integration wiring pass, round 1): CHANGES-NEEDED. 1 IMPORTANT / 1 MINOR. See `.engineering/stage-21/review-integration.md`. All 4 prop-wiring gaps from item-trackA.md traced in full. Three gaps clean: enterConfigureMode signature matches RoomList onSelectPartition exactly; handleFloorRenamed spreads only label, preserves rooms; handleRoomDeleted last-room edge case correct (selectedRoomId/viewMode/layoutSideSelection all cleared, remaining-room path traced through RoomList call order). One IMPORTANT blocker: selectedPartitionId={state.partitionId} passes a non-null id in Layout mode because the draft reducer has no action that clears partitionId after Back — ghost green highlight persists on last-configured partition in the left rail whenever not in Configure mode. Fix: selectedPartitionId={viewMode === "configure" ? state.partitionId : null}. One MINOR: onFloorDeleted not wired (pre-existing Track A gap, not in the 4-concern scope of this diff; workspace.floors retains deleted floor in state — no crash path found, but stale until reload).

- 2026-09-16 — reviewer (integration wiring pass, round 2): APPROVE. 0 CRITICAL / 0 IMPORTANT / 0 MINOR. See `.engineering/stage-21/review-integration.md` round-2 section. Both round-1 findings verified resolved: (1) viewMode === "configure" guard confirmed against correct variable/value — same expression used at line 359 for center-column conditional, exact match; (2) handleFloorDeleted sequencing traced — React 18 batching ensures floors + selectedFloorId update in one render (no stale mid-render), canDelete guard in FloorBar guarantees remaining.length >= 1 so onSelectFloor always has a valid target. No new issues in commit 874cbdc.

- 2026-09-16 — reviewer (Track C, round 1): CHANGES-NEEDED. 0 CRITICAL / 2 IMPORTANT / 3 MINOR. See `.engineering/stage-21/review-trackC.md`. Track C's own files (convert-side-form.tsx, layout-mode-panel.tsx, saved-components-rail.tsx, page.tsx) are correct and fulfill S21-C1/C2/C3 AC. Auth/tenancy preservation confirmed via route trace (named reviewer obligation met). Partition name immediate-PATCH confirmed architecturally correct for Layout mode (not a draft violation). add-wall route deletion confirmed clean. Two IMPORTANT bugs require a fix commit to design-workspace.tsx before engineering:test: (1) right-rail h2 shows "Saved Components" in Layout mode — should be "Wall Details" (mockup line 2017); (2) "{side} wall selected" sub-text is missing in Layout mode when a wall is selected (mockup line 2033). Both were deferred by prior tracks as "integration-wiring pass to address" but were not fixed there. Three MINOR: wallTitle/autoLabel format deviates from mockup verbatim pattern; stale add-wall comment in project-wizard-breadcrumb.tsx.

- 2026-09-16 — reviewer (final labels fix): APPROVE-WITH-NITS. 0 CRITICAL / 0 IMPORTANT / 1 MINOR. See `.engineering/stage-21/review-final-labels.md`. All 4 findings from review-trackC.md confirmed resolved: heading 3-state branch correct, sub-text gated on layoutSideSelection !== null (index-0 safe), sideName() re-exported (not reinvented), next-intl {side} interpolation correct, wallTitle/autoLabel format matches mockup verbatim, null guards preserved. One MINOR nit: sub-text uses sideName() (positional: Top/Right/Bottom/Left) while panel title uses side.label (stored value) — could diverge if labels are user-custom; consistent with existing tipFor() tooltip pattern, no functional impact. Stage 21 ready for engineering:test.

- 2026-09-16 — tester: FAIL. 1 IMPORTANT / 1 MINOR. See `.engineering/stage-21/bugs-1.md`. Tested against
  `test.easeetool.com` (`de65771`) after the orchestrator confirmed `release/stage-21` -> `staging` merge
  and re-point; login confirmed working correctly on this stable alias (the feature-branch cross-subdomain
  cookie issue does not reproduce here). Lint/tsc clean (tsc's 2 `add-wall` errors were stale local `.next`
  cache noise, not source errors — cleared). Full manual pass of Layout mode, Configure mode, draft/save
  model, multi-select, doors, tenancy, and the wizard-padding sweep. Added a committed Playwright suite
  (`tests/e2e/stage21-design.spec.ts`, 7 tests: 6 passing, 1 `test.skip()`'d as a confirmed regression case
  for the one IMPORTANT finding) covering draft isolation, Save/Discard round-trip, the width-sum invariant
  across a full chained operation sequence, and cross-org tenancy. Found B-1 (IMPORTANT): Layout-mode wall
  tooltip is clipped by the center card's `overflow-hidden` ancestor for left/right walls — confirmed via
  computed geometry (right-wall tooltip's right edge lands ~120px past the card's own right edge), a gap
  in Track B's tooltip-direction review rather than a new regression. B-2 (MINOR): stale comment in
  `floor-bar.tsx` claims `design-workspace.tsx` doesn't wire `onFloorRenamed`/`onFloorDeleted`, though the
  integration-wiring pass added both. All test-created project records (`e2e-tester-stage21-*`,
  `e2e-stage21-*`) were deleted; confirmed zero remain via a final `GET /projects` sweep. No local dev
  server was started at any point (all verification against the deployed preview). Regression suite left
  uncommitted in the working tree at this point — flagged for the fix pass to pick up. Human approved a
  fix pass on `feature/s21-fix-b1-b2-test-findings` (off `release/stage-21`).
  clipped by center-column `overflow-hidden` ancestor) / 1 MINOR (B-2: stale `floor-bar.tsx` comment). See
  `.engineering/stage-21/bugs-1.md`. Regression suite `tests/e2e/stage21-design.spec.ts` written (6 passed,
  1 `test.skip()`'d for B-1) but left uncommitted in the working tree — flagged for the fix pass to pick up.
  Human approved a fix pass on `feature/s21-fix-b1-b2-test-findings` (off `release/stage-21`).
- 2026-09-16 — developer (fix pass, B-1/B-2): both findings fixed, commit `7f8ec42` pushed to
  `feature/s21-fix-b1-b2-test-findings`. See `.engineering/stage-21/item-fix-b1-b2.md` and
  `plan-fix-b1-b2.md` for full detail. B-1: `room-floor-plan.tsx`'s `tooltipTransform()` now renders
  left/right tooltips inward (over the room interior) instead of outward past the SVG's own box, so they
  stay inside the center card's `overflow-hidden` bounds — top/bottom untouched (already correct). Chose
  flip-direction over a `ContextMenu`-style portal (rationale in plan file). B-2: `floor-bar.tsx`'s
  `onFloorRenamed`/`onFloorDeleted` JSDoc updated to reflect `design-workspace.tsx` now wires both.
  Also committed `tests/e2e/stage21-design.spec.ts` (previously uncommitted tester artifact) with the B-1
  case un-skipped. `npx tsc --noEmit` clean; `npm run lint` 0 errors (same 6 pre-existing warnings,
  none in touched files). Per the hard no-local-testing rule, full e2e verification needs to run against
  this branch's own Vercel preview — I don't have Vercel MCP tools this session, so I couldn't poll
  deployment READY or discover the preview URL myself (an alias-guess attempt didn't resolve). Asked
  orchestrator to confirm READY for commit `7f8ec42` and share the URL so `npm run test:e2e` can target it
  via `PLAYWRIGHT_BASE_URL`. Status: DONE_WITH_CONCERNS pending that confirmation.
- 2026-09-16 — developer (fix pass, verification): orchestrator confirmed deployment READY at
  `https://quotation-system-3p4imydju-vistra-indias-projects.vercel.app`. Ran
  `PLAYWRIGHT_BASE_URL=<preview> npx playwright test tests/e2e/stage21-design.spec.ts` — **7/7 passed**,
  including the un-skipped B-1 regression case. Also ran an ad-hoc manual sanity check (temp spec file,
  deleted after use, not committed) hovering the left and right wall bars at 1440px and 1180px viewports:
  tooltip bounding box stayed fully inside the floor-plan card at both widths in both cases (e.g. 1440px
  right tooltip right-edge 991 vs card right-edge 1062; 1180px left tooltip left-edge 559 vs card left-edge
  534), confirmed both by geometry assertions and by reading the screenshots. Verified no leftover test
  data: a second temp script (deleted after use) signed in as `admin`/vistra and listed
  `GET /api/v1/orgs/vistra/projects` — zero `e2e-stage21-*` or `manual-b1-check-*` projects remained (the
  manual-check test's own inline delete + the suite's `afterAll` hooks both fired correctly). No shared
  credentials or seeded records were touched. Working tree is clean except the (gitignored)
  `.engineering/stage-21/worklog.md` update. Status: DONE.
- 2026-09-16 — reviewer (fix pass, B-1/B-2): APPROVE-WITH-NITS. 0 CRITICAL / 0 IMPORTANT / 5 MINOR. See
  `.engineering/stage-21/review-fix-b1-b2.md`. B-1 fix verified correct at the geometry level (all four
  edge cases traced; top/bottom untouched), B-2 comment verified accurate against
  `design-workspace.tsx:367-368`, un-skipped e2e case verified non-vacuous (card locator unambiguous,
  polygon index correct, boundingBox is unclipped so it really fails pre-fix). Diff hygiene clean —
  3 files, no scope creep. `tsc --noEmit` and `npm run lint` re-run locally: clean / 6 pre-existing
  warnings. Nits are the dev's discretion; the one worth taking is recording the inward-tooltip mockup
  deviation in stage-21.md's Deviations register (recorded as D-6 by the orchestrator).

- 2026-09-16 — tester (re-test, fix-batch verification): PASS. 0 CRITICAL / 0 IMPORTANT / 0 MINOR. See
  `.engineering/stage-21/bugs-2.md`. Tested against `test.easeetool.com` / `vistra.test.easeetool.com`
  (`1591ee9`). B-1 confirmed fixed: committed suite (`tests/e2e/stage21-design.spec.ts`, 7/7 passing incl.
  the un-skipped tooltip-bounds case) plus an independent manual geometry+screenshot check at 1440px/1180px
  (both left/right wall tooltips fully inside the card at both widths). B-2 confirmed fixed via code read
  (`floor-bar.tsx` JSDoc no longer stale). Spot-checked the now-inward tooltip for new overlap against room
  header/legend/right-rail — none found. Lightweight regression pass (draft isolation, Save/Discard,
  multi-select make-equal/unite, sum invariant, tenancy, Layout-mode heading) all green via the same suite
  run. All test-created records deleted (temp project + suite's own `e2e-stage21-*`); confirmed zero
  leftover via `GET /projects`. No local dev server used.

---

## Batch 3 Bug Fixes — implementation plan (feature/s21-fix-batch-3)

Branch: `feature/s21-fix-batch-3` off `staging` @ `9ca45dc`. Spec: `.engineering/stage-21/bugs-3.md`.

### Overlap-pair grouping

| Pair | Bugs | Files |
|---|---|---|
| A | 1 & 2 | `configuration/add-selection-form.tsx` |
| B | 3 & 4 | `design/room-list.tsx` (3), `design/new-room-form.tsx` (4), `design/design-workspace.tsx` (3 - remove h2) |
| C | 7 & 9 | `design/design-workspace.tsx` (both) |
| D | 8 & 11 | `design/convert-side-form.tsx` (8a), `design/layout-mode-panel.tsx` (8b), `design/configure-mode.tsx` (11) |
| E | 2 & 10 | `saved-components-rail.tsx` — Bug 10 removes pencil icon from Design rail; Bug 2 is config-page scroll (separate file); no shared component confirmed |
| F | 6 (standalone) | `design/layout-mode-panel.tsx` — inline confirm → ConfirmDialog |

### Per-bug changes

| Bug | File(s) | Change |
|---|---|---|
| 1 | `add-selection-form.tsx` | Add `min-h-[calc(100vh-160px)]` to outer grid div |
| 2 | `add-selection-form.tsx` | Right column: `overflow-y-auto max-h-[calc(100vh-180px)]` for independent scroll |
| 3 | `room-list.tsx` + `design-workspace.tsx` | Move "+ Add Room" zone ABOVE "Rooms" h2 — reorder in room-list.tsx; remove h2 from workspace, move into room-list |
| 4 | `new-room-form.tsx` | Submit button = icon-only small square matching cancel × button; input `flex-1` |
| 5 | `room-floor-plan.tsx` | viewBox `-6 -6 212 212` so outer polygon corners don't touch SVG clip boundary |
| 6 | `layout-mode-panel.tsx` | Replace inline confirmingRemove row with `ConfirmDialog` (same pattern as delete-room in room-list.tsx) |
| 7 | `design-workspace.tsx` | `handleSideConverted`: detect if converted side is now PLAIN → clear `layoutSideSelection` |
| 8a | `convert-side-form.tsx` | Add editable label field (initialized from `autoLabel`); pass user-entered label to server |
| 8b | `layout-mode-panel.tsx` | `autoLabel` format: slugify to `{room}-{side}-wall` kebab-case |
| 9 | `design-workspace.tsx` | `doEnterConfigureMode`: after LOAD_PARTITION, if panels have no glass, dispatch `SET_GLASS` with first glass selection |
| 10 | `saved-components-rail.tsx` | Remove `✎` pencil from ComponentSection; add info/eye icon button with config popover (config: Record<string,value> from SelectionRow) |
| 11 | `configure-mode.tsx` | Width/Height stat card: read-only display + edit-icon toggle → confirm-icon; `editingDimension: "width" \| "height" \| null` state |
| 12 | `saved-components-rail.tsx` | `toggleDoor`: default height = `wallHeightMm` (was `0.85 * wallHeightMm`); slider `min={0}` (was `MIN_DOOR_HEIGHT_MM`) |
| 13 | `components/toast.tsx` + `design-workspace.tsx` | Enhance Toast with slide-in-from-right animation; `useToast()` in workspace, show on `handleSubmitDesign` success |

### Bug 10 surface check
`design/saved-components-rail.tsx` is NOT shared with `configuration/add-selection-form.tsx` — the config page uses its own `SelectionGroup` subcomponent that has no pencil icon (the entire row IS the edit action, which is functional and intentional). Bug 10 fix is `saved-components-rail.tsx` only.

### Not changing
- `configure-constants.ts`: `MIN_DOOR_HEIGHT_MM` / `DEFAULT_DOOR_HEIGHT_RATIO` kept (bug 12 changes the *usage* of these, not the constants themselves — they may still be valid for other callers)
- Slider `min` for door height: changed inline in `saved-components-rail.tsx` from `{MIN_DOOR_HEIGHT_MM}` to `{0}`
