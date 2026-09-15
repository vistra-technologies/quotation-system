# Stage 21 — worklog

Stage target: `quotation-system-docs/development-cycles/stage-21/stage-21.md` (+ per-track task files
under `.../stage-21/tasks/`). Profile: `.engineering/stage-21/profile.md`.

`release/stage-21` cut from `master` @ `7e47da4`, 2026-09-15.

Run instruction: devs may reach out to the architect if unclear on task execution.

---

## Work items

| ID | Track | Task(s) | Depends on | Status | Branch | Detail |
|---|---|---|---|---|---|---|
| T0.1 | 0 | S21-0.1 token mapping | — | planned | `feature/s21-t0-foundation` | |
| T0.2 | 0 | S21-0.2 padding trim | — | planned | `feature/s21-t0-foundation` | |
| T0.3 | 0 | S21-0.3 CSS grid shell | 0.1 | planned | `feature/s21-t0-foundation` | |
| T0.4 | 0 | S21-0.4 draft-state reducer/context (hard gate, highest risk) | — | planned | `feature/s21-t0-foundation` | |
| T0.5 | 0 | S21-0.5 ContextMenu primitive | — | planned | `feature/s21-t0-foundation` | |
| T0.6 | 0 | S21-0.6 unsaved-changes modal | 0.4 | planned | `feature/s21-t0-foundation` | |
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
