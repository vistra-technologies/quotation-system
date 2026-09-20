# Stage 23 — worklog

## Status

- **Phase:** implement — Batch 1 done, awaiting review
- **Branch:** `release/stage-23` (cut fresh from `origin/master` @ cf130ca, 2026-09-21) @ `48563e5`
- **Active work item:** Batch 1 reviewed — APPROVE-WITH-NITS (0 critical/important, 3 minor, see
  `review-1.md`). Next: devops applies the migration to the dev Neon DB out-of-band (via
  `prisma migrate deploy` on `DATABASE_URL_UNPOOLED`, per review-1.md's MINOR-3 — not pasted SQL, so
  `_prisma_migrations` gets the row), then Batch 2 (starter-catalog swap + seed + backfill).
- **Latest artifacts:** `plan.md` (local, untracked per `.gitignore` convention — regenerate by reading
  worklog history if a fresh checkout is missing it), `diff-b1.patch` (local, untracked).
- **Stage target:** `quotation-system-docs/development-cycles/stage-23.md` — Formula Set engine + data model
- **Tier:** near-serial, substantial (per profile.md: 1 → 2 → 4 → 3 → 6 → 5 → 7, batches 3∥4 and 6∥3–5)
- **Gate:** RESOLVED 2026-09-21. A1 (door aggregation) is locked as **D-40**: `doors[]` hangs off the
  **wall**, not the room (corrects D-27/D-31); identical doors aggregate **within a wall only**, never
  across walls. Found by the orchestrator comparing `stage-23.md` against the finished
  `design-docs/mockups/summary-poc.html` (which implements per-wall doors); human ruled for the mockup.
  Docs repo commit `5531121` (pushed) fixes `stage-23.md`, `stage-24.md`, `04-data-model.md`,
  `03-subsystems.md`, `07-roadmap-open-questions.md`, `development-cycles/README.md`, and
  `08-decisions-and-changelog.md`. `plan.md` corrected to match (`feature/s23-plan`, merged).

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

- **reviewer · Batch 1 review round 1 (2026-09-21).** Reviewed `4c954d6` (schema + migration) against
  `plan.md` Batch 1 and `stage-23.md` Batch 1 / D-20 / D-37. **Verdict: APPROVE-WITH-NITS** —
  0 CRITICAL, 0 IMPORTANT, 3 MINOR. Independently ran `prisma validate`/`generate`, `tsc --noEmit`,
  `npm run lint`, `npm run test:unit` (39/39) and verified the hand-written SQL byte-matches
  `prisma migrate diff --from-empty --to-schema --script` output. Minors: (1) `updatedAt` DB default Prisma
  wouldn't emit — matches the Stage 20 migration's precedent, leave as-is; (2) use `migrate diff` (DB-free)
  to mechanically verify future hand-written migrations; (3) the out-of-band dev apply must go through
  `prisma migrate deploy` on `DATABASE_URL_UNPOOLED`, and the migration file must not be edited afterwards
  (checksum). No blockers — Batch 2 may proceed. See `review-1.md`.

## devops — out-of-band migrate deploy (Batch 1 -> dev DB), 2026-09-21
- STUB: about to run `npx prisma migrate deploy` against dev Neon endpoint `ep-dark-term-ai0ufj4k`
  (DATABASE_URL overridden to DATABASE_URL_UNPOOLED value, mirroring scripts/build.mjs) to apply
  `20260921000001_add_formula_sets`. Pre-check: `prisma migrate status` confirms it as the only
  pending migration; datasource resolved to `ep-dark-term-ai0ufj4k-pooler...` confirming dev, not prod.

- **RESULT: applied cleanly.** Ran `npx prisma migrate deploy` with `DATABASE_URL` overridden in-process
  to the `DATABASE_URL_UNPOOLED` value (mirroring `scripts/build.mjs`'s exact override, no shell
  interpolation of the secret — set via a Node child-process env object, temp file holding the value
  deleted immediately after). Datasource line during the deploy showed
  `ep-dark-term-ai0ufj4k.c-4.us-east-1.aws.neon.tech` (no `-pooler` suffix), confirming the override took
  effect and confirming dev target (matches profile.md's dev endpoint `ep-dark-term-ai0ufj4k`; production
  is the unrelated `ep-little-paper-aipm0o0i`, never touched).
  - `prisma migrate status` before: 25 found, `20260921000001_add_formula_sets` pending. After: "Database
    schema is up to date!" (all 25 applied).
  - Verified via direct `pg` query (pooled `DATABASE_URL`, read-only):
    - `_prisma_migrations` has a `finished_at`-populated row for `20260921000001_add_formula_sets` (per
      review-1.md MINOR-3, this is what prevents `staging`'s later auto-migrate from re-running the SQL
      and hitting a P3009 "already exists").
    - `FormulaSet` and `ProjectCalculation` tables exist.
    - `Organization.activeFormulaSetId` and `Project.formulaSetId` columns exist.
    - Sanity read on existing data (no regression from the additive migration): `Project` count 710,
      `Organization` count 6 — both readable, additive migration confirmed non-destructive.
  - Did not run `prisma db seed` or any backfill (Batch 2's job). Did not touch production. Did not paste
    raw SQL anywhere (per MINOR-3, went through `migrate deploy` only).
  - Did not separately hit `/api/health` on a feature-branch preview since no Batch-1+ feature branch is
    pushed yet to verify against; the direct DB check above is the stronger, more specific evidence for
    this batch (same reasoning review-1.md gave for why DB-free static checks were preferred over an
    unmigrated-DB preview hit at review time).
- **Outcome:** dev DB (`ep-dark-term-ai0ufj4k`) is now ready for Batch 2+ feature-branch previews to use
  the new `FormulaSet`/`ProjectCalculation` tables and FK columns.
