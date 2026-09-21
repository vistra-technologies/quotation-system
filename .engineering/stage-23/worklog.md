# Stage 23 — worklog

## Status

- **Phase:** implement — Batches 1, 2, 3, 4, 6 merged. Next: Batch 5 (submit/recompute — last engine batch),
  then Batch 7 (e2e + docs, stage close-out).
- **Branch:** `release/stage-23` @ `42952cc`
- **Active work item:** none yet — about to dispatch developer for Batch 5.
- **Carry-forwards:** (a) review-4 MINOR: KPI rounding drift (entries can sum 1e-4 off `totalPartitionSqm`) -
  Batch 7 adds a Known-limitations note to stage-23.md. (b) review-4: a partition with `design: null` makes
  the builder return FAILED - Batch 5's 13b submit check must catch it first as a legible 400/422.
  (c) Batch 2/3/6 leftover unverified: fresh-org /controls check, SuperAdmin hard-delete-with-calcs, and
  SuperAdmin PATCH/DELETE 409s (all need SuperAdmin creds — `SUPERADMIN_*_PASSWORD` are Vercel Secrets,
  confirmed un-pullable by agents across 3 separate batches now). **Flagged to the human directly** —
  their call whether to share creds or have them rotated for agent use before Batch 7's e2e pass, or accept
  code-inspection + shared-unit-test coverage as sufficient for the SuperAdmin surface this stage.
  (d) review-5-opus-checkpoint MINOR: `lib/data/partitions.ts`'s `createPartition()` is a dead export with
  no `invalidateProjectCalculation()` call of its own — harmless (zero call sites) but flag/delete before a
  future stage wires it up. (e) note for Batch 5: if its summary loader derives wall ordering from
  `Room.sides` rather than Partition rows, a sides-reorder-only PATCH would need invalidation too
  (cosmetic-only risk, not a correctness one). (f) review-6 MINORs (dev's discretion, non-blocking): an
  avoidable org/FormulaSet lookup on PATCHes with no guardable field change; 409 message names only the
  first removed key; `prisma/seed.ts`'s `componentType.upsert` sits outside the Batch 6 guard (not an API
  path, not actionable — no prod org has `activeFormulaSetId` set from a seed run yet).
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

## Activity log (Batch 5 entry — see below for detail; Status block above still says "Next: Batch 5",
to be updated by the next dispatch/reviewer once this is reviewed and merged)

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
