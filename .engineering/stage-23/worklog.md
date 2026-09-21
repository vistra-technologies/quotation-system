# Stage 23 — worklog

## Status

- **Phase:** implement — **all 7 batches merged, Stage 23 is code-complete.** `release/stage-23` has not
  yet been merged to `staging`/`master` — that's the next step (human-gated, per CLAUDE.md's branching
  rules), not another implement dispatch.
- **Branch:** `release/stage-23` @ (Batch 7 not yet merged in — developer's branch
  `feature/s23-b7-e2e-docs` @ `aea1ee6`, pushed, e2e-verified against its own preview, ready to merge)
- **Active work item:** none — Batch 7 done. Next action: merge `feature/s23-b7-e2e-docs` →
  `release/stage-23` → `staging` (verify on `test.easeetool.com`) → human approval → `master`.
- **Carry-forwards — all resolved or accepted in Batch 7:**
  (a) RESOLVED (documented): KPI rounding drift — accepted as a Known limitation in `stage-23.md`, not a
  code fix (see the doc's rationale).
  (b) RESOLVED in Batch 5.
  (c) RESOLVED in Batch 7 — SuperAdmin creds provided (`devadmin`); all 3 items now have real e2e coverage
  in `tests/e2e/stage23-summary.spec.ts`'s SuperAdmin-only describe block, verified passing against the
  branch's own preview: fresh-org `/controls` catalog + D-22/D-38 pin works end-to-end (proven by actually
  submitting a design against it); the D-36 guard 409s from all three DAL paths (org PATCH, SuperAdmin
  PATCH, SuperAdmin DELETE); org hard-delete-with-calculations cascades cleanly (explicit before/after
  `ProjectCalculation` count, not just "the delete didn't error").
  (d) RESOLVED in Batch 7 — dead `createPartition()` export deleted from `lib/data/partitions.ts`.
  (e) RESOLVED in Batch 5.
  (f) Left as documented follow-ups (dev's discretion, explicitly non-blocking per review-6) — not
  fixed, not forgotten.
  (g) RESOLVED in Batch 7 — one-line fix in `lib/summary/index.ts` (malformed-but-non-null snapshot now
  fails cleanly as `FAILED` instead of a raw `TypeError`), plus the missing "design is malformed" unit
  case added to `tests/unit/calculations-preflight.test.ts`.
- **Latest artifacts:** `plan.md`, `plan-b7.md` (local, untracked), `diff-b1.patch`..`diff-b6.patch`,
  `review-1.md`..`review-7.md` (local, untracked), `retro.md`.
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

- **developer · Batch 5 — submit-design pipeline + recompute (2026-09-21).** Branch `feature/s23-b5-submit`
  (cut off `release/stage-23` @ 42952cc). Per `plan.md`'s Batch 5 section + addendum:
  - `lib/data/calculations.ts` (new): shared `loadCalculationInput()` (project pin + formula set body +
    configSnapshot + Floor/Room/Partition tree + Selections -> `SummaryInput`), `writeCalculation()`
    (upsert `ProjectCalculation` on `projectId`, `materialList` always `[]`, D-37), and
    `checkDesignReadyForSubmit()` — the 13b data check.
  - **Carry-forward (b) addressed:** `checkDesignReadyForSubmit()` runs BEFORE `buildSummary()` in
    `submitDesign()` and walks the raw design tree itself (null design / no `sections[]` / null-or-blank
    `selectionId` / a `selectionId` that doesn't resolve to a loaded Selection), so a null/incomplete design
    can never reach the builder from a normal submit and can never surface as an opaque FAILED. Verified live
    on the preview: a wall with unassigned cells -> 422 naming the partition + each cell
    (`"partition \"Wall A\" (...), cell ...: no selection assigned"`), nothing written.
  - **Carry-forward (e) addressed — chose direct-from-Partition-rows, not Room.sides:** the loader orders
    `Partition` by `partitionNumber` (the existing convention, see `lib/data/partitions.ts`'s
    `listPartitionsByRoom()`), never touching `Room.sides`. `Partition` has no `orderIndex` of its own;
    `partitionNumber` is already a stable, indexed ordering key, so this sidesteps the sides-reorder
    invalidation gap structurally rather than adding a new invalidation hook for it.
  - `lib/data/projects.ts`: `submitDesign()` rewritten to run 13b, then `buildSummary()`, then write the
    calculation + stamp `designSubmittedAt` in one transaction (explicit return-type union to keep the
    discriminated-result narrowing sound under `prisma.$transaction`'s inference). Two distinct blocked
    outcomes per stage doc step 2 vs step 4: a 13b violation writes nothing (422); a builder-level FAILED
    (13b passed, e.g. a blank org-required field) still writes the FAILED row but blocks the
    `designSubmittedAt` stamp (422). New `recomputeProject()`: DRAFT-only + (has `designSubmittedAt` OR an
    existing calculation) per D-23, no 13b preflight (an old null-selectionId cell must produce a written
    FAILED row, never a crash — verified live), never touches `designSubmittedAt`.
  - New `POST .../recompute` route; submit-design route maps the new outcomes to 409 (no formula
    set/snapshot pinned — defensive) / 422 (13b / build failure).
  - `lib/api-error.ts`: added `apiUnprocessable()` (422) — didn't exist yet.
  - `tests/unit/calculations-preflight.test.ts` (new, 8 cases): `checkDesignReadyForSubmit()` — fully
    assigned (no violations), null design, no-sections, empty-sections, null selectionId, blank-string
    selectionId, unresolved selectionId, multi-partition/multi-violation collection.
  - `design-docs/sql-queries/by-page.sql` (docs repo, commit `8a57d64`, pushed to `main`): documented the
    shared loader/writer SQL shapes for both submit-design and the new recompute route.
  - **Verified locally:** `npx tsc --noEmit` clean; `npm run lint` clean (only pre-existing errors in
    `.engineering/stage-22/prod-recon-readonly.ts` and pre-existing e2e warnings, none introduced);
    `npm run test:unit` 113/113 pass (8 new + all prior).
  - **Verified on preview** (pushed `feature/s23-b5-submit` @ `e89ceae`, Vercel deployment
    `https://quotation-system-otwcrw2co-vistra-indias-projects.vercel.app`, polled to READY via
    `gh api .../commits/.../status` + `.../deployments/.../statuses`, confirmed `/api/health` 200
    `database: "connected"`): built a real project end-to-end (floor -> room -> wall-via-sides-convert ->
    glass Selection -> assign selectionIds) against the shared dev DB (org `vistra`, seeded admin creds) —
    - submit with 0 partitions -> 400 (unchanged existing behavior);
    - submit with unassigned cells -> 422 naming partition+cell, nothing written;
    - submit once assigned -> 200, `designSubmittedAt` set;
    - recompute -> 200, `summary.floors[].rooms[].walls[].glass[]`/`doors: []` present, `wallLabel`/
      `roomLabel`/`floorLabel` populated, `kpis.totalPartitionSqm` (2.4) = sum of the three glass rows'
      `areaM2` (0.7992+0.7992+0.8016), `materialList: []`, identical to the submit-time summary, and
      `designSubmittedAt` left unchanged;
    - recompute on a project flipped to `CONFIRMED` (via a direct guarded dev-DB script, mirroring
      `prisma/e2e-db-helper-cli.ts`'s pattern — no API route can change status yet) -> 409, reverted to
      DRAFT after;
    - recompute on a never-submitted/never-computed DRAFT project -> 409;
    - after directly nulling one cell's `selectionId` (simulating stale data) and recomputing -> 200 with a
      written `FAILED` row naming the cell, no crash, no "Unassigned" anywhere;
    - nulling `configSnapshot` directly then submitting -> clean 409, not a crash;
    - cross-org: signed in as `acme-glass`'s admin, hit both routes with `vistra`'s projectId under the
      `acme-glass` org-slug URL -> 404 on both;
    - renaming the `GLASS` ComponentType's `code` to prove snapshot isolation was attempted live but is
      structurally blocked by Batch 6's reserved-code guard (400) before it could reach the slot-guard path —
      verified by code inspection instead: `lib/summary/index.ts`'s resolution walk reads only
      `snapshot.componentTypes` (frozen at project creation), never a live `ComponentType` query, so a code
      rename cannot affect an existing project's result; Batch 4's own unit tests already cover "component
      type is not in the project's config snapshot."
    - All throwaway verification projects/selections deleted afterward via the same guarded dev-DB script
      (`cleanup-projects` op — cascaded calc/selection/partition/room/floor/project deletes); confirmed
      deleted (re-read errored `RecordNotFound`). The one direct-DB status flip (DRAFT->CONFIRMED) was
      reverted to DRAFT before that project was itself deleted. No shared seed data or credentials touched.
  - No local dev server/build was run; the scratch verification script
    (`.engineering/stage-23/b5-verify.ts`, gitignored, deleted after use) only shelled a one-off `tsx`
    process against the guarded dev Neon endpoint (same allowlist pattern as
    `prisma/e2e-db-helper-cli.ts`/`prisma/db-target-guard.ts`), matching the existing e2e-suite convention
    for states no API route can produce (project status transition; there is still no status-change route
    this stage) — never touched production.
  Status: DONE. Files: `lib/data/calculations.ts` (new), `lib/data/projects.ts`, `lib/api-error.ts`,
  `app/api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design/route.ts`,
  `app/api/v1/orgs/[orgSlug]/projects/[projectId]/recompute/route.ts` (new),
  `tests/unit/calculations-preflight.test.ts` (new); docs repo
  `design-docs/sql-queries/by-page.sql` (commit `8a57d64`).

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

- **developer · Batch 2 — starter-catalog swap + slots-only formula set + seed + backfill (2026-09-21).**
  Branch `feature/s23-b2-catalog-seed`, cut off `release/stage-23` @ `21cc967`. Per `plan.md`'s Batch 2
  section and `stage-23.md`'s Batch 2 / D-34 / D-35 / D-38:
  - `lib/component-catalog-seed.ts` — rewrote `COMPONENT_TYPE_DEFS`/`COMPONENT_TYPE_ORG_CONFIG_DEFS` to the
    real `cloisons` two-type catalog (GLASS "Partition": category→glassType→thickness dropdown chain +
    3 advanced profile fields depending on glassType; DOOR: category→doorType). No `PROFILE_STOP` slot
    (D-35). Every field a `summaryParams` value will reference is `required: true`. Comments document that
    `RESERVED_COMPONENT_TYPE_CODES` shrinking to `{GLASS, DOOR}` is accepted (Batch 6's guard is the real
    protection). Confirmed the `valueMap` write/read path (`lib/types/field-options-config.ts`,
    `lib/validate-field-options-config.ts`, `lib/parse-field-config.ts`) already fully supports this shape
    (built Stage 20) — no plumbing changes needed.
  - `prisma/formula-sets/glass-partition-standard-v1.json` (new) — `{ NOTE: [...], slots: { GLASS, DOOR },
    formulas: [] }` per D-38; NOTE documents v1's formula-free status, the v2-repoint plan, and the
    no-PROFILE_STOP decision (D-35).
  - `prisma/seed-formula-sets.ts` (new) — `loadFormulaSetDocs()` (JSON import, NOTE stripped before
    storage) + `seedFormulaSets()`: create-only upsert on `(name, version)`; an existing row's body is
    verified by a deterministic `stableHash()` and never overwritten on mismatch (logged + skipped, per
    decision #1's immutability rule). Exports `ACTIVE_FORMULA_SET_NAME` as the single source both
    `seed.ts` and `createOrganizationWithDefaults()` look up by.
  - `prisma/seed.ts` — wired in `seedFormulaSets()` + a create-only `activeFormulaSetId` backfill loop over
    `allOrgs`; made both `ComponentTypes:` count lines informational (legacy `PROFILE_STOP` rows on
    pre-existing orgs make a fixed "expected" figure meaningless — matches the blast-radius table).
  - `lib/data/superadmin/orgs.ts` — `createOrganizationWithDefaults()` resolves the seeded set (by name,
    highest version) before the transaction and pins `activeFormulaSetId` on org create; throws (caught by
    the existing catch block, returned as `{ ok: false, reason: "unknown_error" }`, never an uncaught
    rejection) if no set exists yet.
  - `prisma/backfill-formula-set-pins.ts` (new) — modelled on `prisma/backfill-config-snapshots.ts`:
    dry-run default, `--write` required, `--project=<id>` filter (org pass always runs org-wide regardless,
    since it's cheap/idempotent/NULL-conditional), `prisma/db-target-guard.ts` import, two passes (orgs
    then projects, so a project whose org gets backfilled in the same run is still picked up), full
    dry-run/real-run parity in the report. **Caught and fixed a real bug before ever running it**: the
    first draft's org-pass called `updateMany()` unconditionally and only branched on `dryRun` when
    reporting the result — an actual write under a claimed dry run. Restructured to check `dryRun` and
    `continue` before the query.
  - `package.json` — added `"backfill:formula-pins": "tsx prisma/backfill-formula-set-pins.ts"`.
  - `tests/unit/formula-set-document.test.ts` (new, 12 tests) — JSON parses; `formulas === []`; no
    `numericType`/`PROFILE_STOP` anywhere in `slots`; NOTE block present and mentions formula-free/v2/
    PROFILE_STOP; every slot has a `role`; `requiredParams` present and empty; every slot code + every
    `summaryParams` value exists in the new starter catalog; every `summaryParams`-referenced key is
    `required: true`; `expr-eval` absent from `package.json`; `seedFormulaSets.ts`'s `loadFormulaSetDocs`/
    `stableHash` behave as documented.
  - `tests/e2e/superadmin-component-types.spec.ts` — reworked the "list seeded types" test to assert the
    *current* `COMPONENT_TYPE_DEFS` code list (imported, not hardcoded) plus a conditional `PROFILE_STOP`
    check (present only if the org still has the legacy row) — passes on both the shared dev DB
    (`acme-glass` keeps its legacy row) and a genuinely fresh DB.
  - `tests/e2e/subdomain-navigation.spec.ts` — updated the seed-data doc comment to explain `vistra`'s
    3-type count is a pre-Stage-23 legacy artifact, not the current starter catalog.
  - **Reused:** `prisma/backfill-config-snapshots.ts` (CLI/report shape), `prisma/db-target-guard.ts` (guard
    import), the existing `lib/types/field-options-config.ts`/`lib/validate-field-options-config.ts`/
    `lib/parse-field-config.ts` valueMap plumbing (Stage 20, unmodified), the existing `prisma/seed.ts` org
    loop and `createOrganizationWithDefaults()` transaction (extended, not restructured).
  - **Verify (local):** `npm run lint` — clean (only pre-existing unrelated errors/warnings in
    `.engineering/stage-22/prod-recon-readonly.ts` and untouched e2e/tsx files). `npx tsc --noEmit` — clean
    (only the same pre-existing 188 `use-intl` `.d.ts` errors as Batch 1's baseline, 0 from this change).
    `npm run test:unit` — 51/51 (was 39 before Batch 1's review; +12 new). `npx prisma generate` — clean.
  - **Verify (dev DB, read-only/dry-run only — no `--write`, no `prisma db seed`):** ran
    `npm run backfill:formula-pins` (dry run) directly against the real dev DB (`.env.local`'s
    `DATABASE_URL`, endpoint `ep-dark-term-ai0ufj4k` — confirmed via the guard's own printed target line):
    connected successfully (proves the migration is live and the new columns/table are queryable), reported
    0 orgs/0 projects (informational — the guard doesn't gate the counts, it gates the endpoint) and then
    failed loudly with `No FormulaSet found for name "glass-partition-standard"` — the **expected** state,
    since `prisma db seed` hasn't been re-run against dev with this code yet. Also smoke-tested the guard's
    fail-closed paths directly (empty `DATABASE_URL` → abort; a non-dev endpoint → abort naming it; an
    `npm_config_project` env var mismatch → abort naming the swallow). **Deliberately did NOT run
    `npx prisma db seed` or any `--write`** against the shared dev DB — flagging this clearly per the
    dispatch's instruction, since other in-flight stage work depends on that DB's current state. This is
    the recommended next step (by devops or whoever reviews this batch) before the full functional
    acceptance checklist (fresh org via `/controls`, cascading dropdowns, backfill `--write`) can run.
  - **Verify (preview):** pushed `feature/s23-b2-catalog-seed` @ `66233dd`. No Vercel MCP tool was available
    in this dispatch's toolset, so polled via `gh api repos/.../commits/<sha>/status` (Vercel bot posts a
    commit status) and `gh api repos/.../deployments/<id>/statuses` for the actual preview URL — build
    reached `Deployment has completed` (success) at
    `https://quotation-system-63q9xx1xn-vistra-indias-projects.vercel.app`. `GET /api/health` → 200,
    `{"status":"ok","database":"connected",...}`. **Not verified on preview:** the `/controls` fresh-org
    creation flow and cascading-dropdown UI check — no SuperAdmin credentials available in this environment
    (`TEST_SA_USERNAME`/`TEST_SA_PASSWORD` unset locally), and this ad-hoc per-branch preview URL has no
    `*.test.easeetool.com` subdomain alias for org-scoped page testing per CLAUDE.md's branching doc
    (subdomain routing only applies to the stable staging alias). Also note: even with credentials, org
    creation on this preview would currently fail loudly (by design — `createOrganizationWithDefaults()`
    now requires an `activeFormulaSetId` lookup that returns nothing until dev is seeded), so that
    end-to-end UI check can't fully pass until the seed step above runs regardless.
  - Committed `66233dd` on `feature/s23-b2-catalog-seed`, pushed.
  Status: DONE_WITH_CONCERNS — code, local verification, and DB-guard/dry-run verification are complete and
  green; the DB write (`prisma db seed`) needed for full functional acceptance is explicitly left as a
  flagged next step rather than run inline, and the `/controls` UI check couldn't be performed without
  SuperAdmin credentials.

- **developer · Batch 7 — E2E + docs reconciliation, stage close-out (2026-09-21).** Branch
  `feature/s23-b7-e2e-docs` (cut off `release/stage-23` @ `57dd2f4`, Batch 5's merge). Per `plan-b7.md`:
  - `tests/e2e/stage23-summary.spec.ts` (new): submit → summary matches D-27/D-40's shape (per-wall
    `glass[]`/`doors[]`, populated labels, KPIs) and recompute reproduces it byte-identically without
    touching `designSubmittedAt`; submit blocked 422 on an incomplete design (13b), nothing written;
    editing a submitted design through the real `PATCH /partitions/:id` route clears `designSubmittedAt`
    **and** deletes the calculation (previous coverage in `stage23-wiring.spec.ts` only exercised this via
    a DB-inserted calc, never through a real submit); recompute 409s on a never-computed DRAFT and on a
    non-DRAFT project (D-23) via a new guarded `setProjectStatus` DB helper (no route can change status
    yet). **SuperAdmin-only describe block** (skips without `TEST_SA_USERNAME`/`TEST_SA_PASSWORD`, same
    FLAG-B3 convention as `superadmin-orgs.spec.ts`), built around **one throwaway fresh org** so the
    guard tests' formula-set-pointer swap can never race a concurrently-running spec file (unlike
    reusing acme-glass/nordic-walls): item 1 proves the D-34 catalog + D-22/D-38 pin work end-to-end on a
    freshly-created org (create → design → assign real GLASS Selection → submit → OK summary); item 2
    proves the D-36 guard 409s from all three DAL entry points (org-level PATCH, SuperAdmin PATCH,
    SuperAdmin DELETE) on a custom, non-reserved ComponentType wired into a temp formula set, plus one
    non-block (adding a field still succeeds); item 3 proves SuperAdmin hard-delete of an org with a
    project + calculation cascades cleanly, via an explicit before/after `countProjectCalculations` count
    (new DB helper), not just "the delete call returned 200."
  - `tests/e2e/helpers.ts`: extracted `apiSignIn()` — was duplicated verbatim in `stage23-wiring.spec.ts` —
    as a shared export; `stage23-wiring.spec.ts` now imports it and dropped its own copy plus the now-dead
    local `BASE_URL` const. Re-ran `stage23-wiring.spec.ts` after the refactor: 7/7 still pass.
  - `tests/e2e/db-helpers.ts` + `prisma/e2e-db-helper-cli.ts`: two small guarded ops — `setProjectStatus`
    (test-only, no route exists) and `countProjectCalculations` (the explicit cascade-delete proof above).
  - **Carry-forward (g) fixed:** `lib/summary/index.ts` — a non-null but malformed `configSnapshot`
    (missing/non-array `componentTypes`) now throws `SummaryFailure` (caught, → `FAILED`) instead of a raw
    `TypeError` escaping `buildSummary()`'s catch. Added a unit case in `tests/unit/summary-builder.test.ts`
    and the missing "design is malformed" (a section with no `cells[]`) 13b case in
    `tests/unit/calculations-preflight.test.ts`.
  - **Carry-forward (d) fixed:** deleted `lib/data/partitions.ts`'s dead `createPartition()` export (zero
    call sites, confirmed by grep; `createPartitionInTx()`, the function every real caller uses via
    `replaceSides()`, is untouched). Updated its doc comment to explain why and to warn a future caller
    to wire `invalidateProjectCalculation()` into any new wrapper, rather than resurrecting this one.
  - **Carry-forward (a) accepted, not fixed:** documented as a Known limitation in `stage-23.md` (KPI
    rounding: `sqmByGlassType[]`/`totalPartitionSqm` are each rounded independently from unrounded
    per-cell sums, so they can differ by up to ~1e-4 m² on an adversarial input — deliberate, per D-27's
    "round once per aggregate" rule, immaterial at BOQ scale).
  - **Carry-forward (f) left as follow-up**, per review-6's own "dev's discretion, non-blocking" framing —
    not touched.
  - Docs repo (`quotation-system-docs`, commit `9bad21e`, pushed to `main`): `by-page.sql` (found and
    fixed two real gaps in the org-creation section that predate Stage 23 — the D-22 `FormulaSet`
    lookup/`activeFormulaSetId` pin and the Stage 20 `ComponentTypeOrgConfig` write were never documented
    there, and a comment still named `PROFILE_STOP` post-D-34), `04-data-model.md`/`03-subsystems.md`
    (status flips, D-34 catalog vocabulary corrections, clarified Stage 23's builder walks only the Cell
    grain), `07-roadmap-open-questions.md` (moved the summary-shape question to Resolved, tally fixed),
    `development-cycles/README.md` (status flag), `stage-24.md` (found and corrected one real drift: it
    assumed a `GET .../projects/:id/calculation` route that doesn't exist — Stage 23 shipped only
    `submit-design`/`recompute`), `TECH_DESIGN.md` (`Last updated` bump), `stage-23.md` (Status flipped to
    Built; full Execution Log written reconciling plan vs. reality across all 7 batches; Deviations
    register closed with "no entries" — the one shape change, D-40, was a decision amendment merged
    *before* Batch 4 was approved, not a deviation found after the fact; Known limitations section added),
    `task-format-retro.md` (developer retro note, including a process gap found: `worklog.md`'s Activity
    log had no entries at all for Batches 3/4/6 — only git history and gitignored `review-N.md` scratch
    files preserved their outcomes, which happened to still be present locally but aren't guaranteed to
    be).
  - **Verify (local):** `npx tsc --noEmit` clean; `npm run lint` clean (only the same pre-existing
    findings as every prior batch, none introduced); `npm run test:unit` 115/115 (was 113 before this
    batch — +2: the malformed-snapshot case and the "design is malformed" 13b case).
  - **Verify (preview):** pushed `feature/s23-b7-e2e-docs` @ `aea1ee6`; polled via
    `gh api repos/.../commits/<sha>/status` → `success`, resolved the deployment's `environment_url` via
    `gh api repos/.../deployments/<id>/statuses`
    (`https://quotation-system-bhafn7x6u-vistra-indias-projects.vercel.app`); `/api/health` → 200
    `database: "connected"`. Ran the full new suite against it with `TEST_SA_USERNAME=devadmin`/
    `TEST_SA_PASSWORD` (sourced from the gitignored `superadmin-creds-DO-NOT-COMMIT.md`, never inlined in
    any tracked file or committed): `stage23-summary.spec.ts` **7/7 pass** (including all 3 previously
    SuperAdmin-blocked items); `stage23-wiring.spec.ts` **7/7 pass** (post-refactor regression check);
    `superadmin-orgs.spec.ts` + `superadmin-component-types.spec.ts` **29/29 pass, 2 Tier-2 skips**
    (staging-only page tests, expected on a per-branch preview) — confirms the shared `apiSignIn` helper
    didn't regress any existing SuperAdmin coverage. No local dev server/build/DB was used at any point.
  - Committed `aea1ee6` on `feature/s23-b7-e2e-docs`, pushed. Not yet merged into `release/stage-23` —
    that merge, then `release/stage-23` → `staging`, is the next step (human-gated per CLAUDE.md).
  Status: DONE. Files: `tests/e2e/stage23-summary.spec.ts` (new), `tests/e2e/helpers.ts`,
  `tests/e2e/stage23-wiring.spec.ts`, `tests/e2e/db-helpers.ts`, `prisma/e2e-db-helper-cli.ts`,
  `lib/summary/index.ts`, `lib/data/partitions.ts`, `tests/unit/summary-builder.test.ts`,
  `tests/unit/calculations-preflight.test.ts`; docs repo (10 files, commit `9bad21e`).
