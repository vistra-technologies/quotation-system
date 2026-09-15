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
| D1 | D | S21-D1 configure-mode shell | Track 0 | pending | | |
| D2 | D | S21-D2 wall canvas | D1 | pending | | |
| D3 | D | S21-D3 multi-select + panel menu | D2, 0.5 | pending | | |
| D4 | D | S21-D4 door context menu | D3 | pending | | |

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
