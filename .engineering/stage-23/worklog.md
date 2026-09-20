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
  recommendation untouched. No product code touched. Committed on `feature/s23-plan` (`ca41bb2`), pushed.
  Status: DONE.

- **developer · Batch 1 — schema + migration (2026-09-21).** Branch `feature/s23-b1-schema-migration`, cut
  fresh off `origin/release/stage-23` (this predates `feature/s23-plan`'s merge, so this branch's copy of
  `plan.md`/this worklog doesn't carry the D-40 correction yet — no impact on Batch 1, which doesn't touch
  the summary shape). Per `plan.md`'s Batch 1 section:
  - `prisma/schema.prisma`: added `FormulaSet` (platform-level, `@@unique([name, version])`, immutable per
    version), `Organization.activeFormulaSetId` (+ `Restrict` relation), `Project.formulaSetId` (+
    `Restrict` relation, pinned at creation, never rewritten by `updateProject()`), `ProjectCalculation`
    (1:1 with `Project` via `@unique` on `projectId`, `Cascade` from `Project`/`Organization`, `Restrict`
    from `FormulaSet`, `materialList` defaulted to `'[]'` per D-37, `@@index([organizationId])`).
  - `prisma/migrations/20260921000001_add_formula_sets/migration.sql`: hand-written, mirroring the style of
    `20260919000001_add_project_config_snapshot` and `20260911000001_add_component_type_org_config` (table
    creates, unique/index creates, then FK `ALTER TABLE`s). Purely additive — new table + nullable FK
    columns on `Organization`/`Project` — no backfill in this migration (Batch 2 owns populating existing
    rows via seed/backfill script).
  - Did **not** fold in F-1 (v1 design-parser removal) — out of scope per the dispatch and stage doc.
  - **Reused:** the two migrations above as style templates; no other new code.
  - **Verify:** `npx prisma generate` — clean. `npx tsc --noEmit` — clean for all app/lib code; the only
    errors are pre-existing `TS1127` syntax errors inside `node_modules/use-intl/dist/types/core/types.d.ts`
    (confirmed via `git stash` to reproduce identically — same 188 errors — with schema.prisma reverted, so
    unrelated to this change). `npm run lint` — clean; the only output is 4 pre-existing `no-explicit-any`
    errors in `.engineering/stage-22/prod-recon-readonly.ts` and pre-existing warnings in unrelated e2e spec
    files, none touched by this batch. **No local DB / Vercel preview verification performed for this
    dispatch** — the task instructions scoped verification to local generate/tsc/lint only, and explicitly
    flagged there is no live dev DB to apply the migration against yet (devops applies it out-of-band per
    the stage doc's caveat). Not claiming end-to-end (migration-applied, app-boots-against-new-columns)
    verification.
  - Committed `4c954d6` on `feature/s23-b1-schema-migration`, pushed.
  Status: DONE_WITH_CONCERNS (see "no live DB" caveat above — matches the dispatch's own expectation, not a
  new concern, but flagging per the return contract).
