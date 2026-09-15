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
| A1 | A | S21-A1 floor bar | Track 0 | pending | | |
| A2 | A | S21-A2 collapsible room groups | Track 0 | pending | | |
| A3 | A | S21-A3 partition rows + preview | Track 0 | pending | | |
| A4 | A | S21-A4 inline add-room form | Track 0 | pending | | |
| B1 | B | S21-B1 empty state | Track 0 | pending | | |
| B2 | B | S21-B2 room header + floorplan | Track 0 | pending | | |
| C1 | C | S21-C1 wall details inline convert (retires add-wall) | Track 0, B2 | pending | | |
| C2 | C | S21-C2 saved components rail | Track 0, D2 | pending | | |
| C3 | C | S21-C3 door height slider | C2 | pending | | |
| D1 | D | S21-D1 configure-mode shell | Track 0 | ready-for-review | `feature/s21-trackD-configure-mode` | a900550 |
| D2 | D | S21-D2 wall canvas | D1 | ready-for-review | `feature/s21-trackD-configure-mode` | 21b8a4b |
| D3 | D | S21-D3 multi-select + panel menu | D2, 0.5 | ready-for-review | `feature/s21-trackD-configure-mode` | db96528 |
| D4 | D | S21-D4 door context menu | D3 | ready-for-review | `feature/s21-trackD-configure-mode` | a412970 |

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
