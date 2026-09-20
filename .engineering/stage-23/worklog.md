# Stage 23 — worklog

## Status

- **Phase:** implement — starting
- **Branch:** `release/stage-23` (cut fresh from `origin/master` @ cf130ca, 2026-09-21)
- **Active work item:** none yet — about to dispatch developer for the implementation plan
- **Latest artifacts:** `profile.md` (stage-prep, 2026-09-20)
- **Stage target:** `quotation-system-docs/development-cycles/stage-23.md` — Formula Set engine + data model
- **Tier:** near-serial, substantial (per profile.md: 1 → 2 → 4 → 3 → 6 → 5 → 7, batches 3∥4 and 6∥3–5)
- **Gate:** RESOLVED 2026-09-21. A1 (door aggregation) is locked as **D-40**: `doors[]` hangs off the
  **wall**, not the room (corrects D-27/D-31); identical doors aggregate **within a wall only**, never
  across walls. Found by the orchestrator comparing `stage-23.md` against the finished
  `design-docs/mockups/summary-poc.html` (which implements per-wall doors); human ruled for the mockup.
  Docs repo commit `5531121` (pushed) fixes `stage-23.md`, `stage-24.md`, `04-data-model.md`,
  `03-subsystems.md`, `07-roadmap-open-questions.md`, `development-cycles/README.md`, and
  `08-decisions-and-changelog.md`. **`plan.md`'s Batch 4/5 sections still describe the old per-room
  shape and need a small revision before Batch 4 starts** — next dispatch.

## Activity log

- **developer · plan (2026-09-21).** Wrote `plan.md` (per-batch files/reuse/verify for Batches 1,2,4,3,6,5,7).
  **Flagged a deviation:** the dispatch/`profile.md` gate ("Batch 4 needs human sign-off on the
  `summary` JSONB shape + D-24") is stale — `stage-23.md` documents a same-day re-scope that already
  locks the shape (D-27) and D-24 (closed, revised twice); the stage doc's own `⛔ GATE` section names
  only **A1** (door-row aggregation) as open, settled externally via `summary-poc.html` sign-off
  (another agent building it — not touched here). Did not re-propose a shape/D-24 answer, to avoid
  misrepresenting an already-locked decision as newly open; see plan.md's top section for the full
  reasoning. **Triage recommendation:** serial, one developer, per-batch feature branch + review loop —
  not a parallel work-item split (Batch 3/6 share `lib/formula-compat.ts`, and stage size doesn't
  justify worktree overhead). No product code touched this dispatch.
  Status: DONE. See `plan.md`.

- **developer · plan.md correction (2026-09-21).** Fixed stale door-shape wording in `plan.md`'s Batch 4/5
  sections per the human's D-40 ruling (doors hang off the **wall**, not the room; aggregate within a wall
  only, never across walls; wall with no doors emits `doors: []`; rooms carry no door list). Also fixed the
  Batch 4 gate-status paragraph (A1 is now CLEARED, not pending) and a stale Batch-4 unit-test line ("3
  identical doors across 2 walls → 1 row qty 3", which was wrong even under the old room-based reading — the
  stage doc's actual example splits 2/1 across two walls into two rows). Batches 1/2/3/6/7 and the triage
  recommendation untouched. No product code touched. Status: DONE.
