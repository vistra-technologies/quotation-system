# Stage 23 — implementation plan (developer, first dispatch)

## Deviations / things to flag up front

1. **The Batch-4 sign-off gate described in the dispatch is stale — the approved stage doc has already
   resolved it.** The dispatch instructions (and `profile.md`, written at stage-prep 2026-09-20 morning)
   say Batch 4 needs human sign-off on the `ProjectCalculation.summary` JSONB shape and D-24. But
   `development-cycles/stage-23.md` **itself documents a same-day re-scope** (2026-09-20) that already
   settles both: the summary shape is locked as **D-27** (with a worked JSON example under "Summary output
   shape") and D-24 is marked "(revised twice)" and closed — slots carry `role` + `summaryParams`, glass
   params = `glassType`/`thickness`, door params = `category`/`doorType`, no `width`/`handing` params. The
   stage file's own gate section (`⛔ GATE — what is still open before Batch 4`) says explicitly: **"One
   item. A1 — door row aggregation (ASSUMED)."** — settled by the human reviewing
   `design-docs/mockups/summary-poc.html`, which **another agent is building right now; I must not touch
   it.** OPEN-A/B/C and D-24 are listed as already **CLOSED**.
   **What I'm doing about it, per the dispatch's own instruction to flag rather than silently follow a
   stale doc:** I am **not** re-proposing a summary shape or a D-24 answer for sign-off below, because
   restating an already-locked decision as a fresh "proposal" would misrepresent the stage doc's actual
   state to the human and risks re-litigating something closed. Instead, Batch 4's plan below treats D-27's
   shape and D-24's slot contract as **given** (cited from the stage doc), and the only open item ahead of
   Batch 4 is **A1**, which resolves externally via the mockup sign-off already in flight — not by this
   plan. If the orchestrator/human wants me to treat the shape/D-24 as still open despite the doc, that's a
   real conflict between the dispatch brief and the approved target and needs a decision, but my read is
   that the stage doc (dated the same day, explicitly re-scoped, with a "GATE" section naming exactly one
   remaining unknown) is the newer, authoritative state.
2. No other deviations found. The plan below follows the stage file's batch blocks, file lists and locked
   decisions as written.

## Triage tier recommendation

**Serial, one developer, dev⇄reviewer loop per batch — not a parallel work-item split.** The stage file
itself calls out 3∥4 and 6∥3–5 as *possible* parallelism, but:
- Batch 3 and Batch 4 both import/depend on `lib/formula-compat.ts`'s `keysReferencedBySet()` — Batch 3
  creates that file (step 1), Batch 4 doesn't import it directly today but Batch 6 (which can run "beside"
  3–5) explicitly must import the **same** export from Batch 3's file (D-36) rather than re-implement it.
  Running 3 and 6 as literally concurrent worktrees risks exactly the kind of drift D-36 is written to
  prevent, for a stage sized at ~23–28h total (not large enough to be worth the branch-merge overhead of
  disjoint worktrees for a solo developer).
- Batch 4 is explicitly gated (A1, pending an external mockup sign-off) — starting it in parallel with
  Batch 3 today would mean building against an assumed default that might flip, which is manageable (one
  function, per the gate note) but adds no real speed since Batch 5 needs *both* 3 and 4 done before it can
  proceed anyway.
- File sets are not fully disjoint: Batch 3 and Batch 6 both touch `lib/formula-compat.ts` (3 creates it,
  6 extends it), which is a collision risk for genuinely parallel worktrees, not just a dependency.

Net: the "near-serial, substantial" tier from `profile.md` is correct. I'll run 1 → 2 → 4 → 3 → 6 → 5 → 7
as one developer, per-batch feature branches (`feature/s23-b<n>-*`), each reviewed and merged into
`release/stage-23` before the next starts.

---

## Batch 1 — Schema + migration

**Files:** `prisma/schema.prisma` (modify), `prisma/migrations/2026092XXXXXXX_add_formula_sets/migration.sql` (new, hand-written).

**Plan:**
- Add `model FormulaSet { id, name, version Int, body Json, publishedAt DateTime?, createdAt, updatedAt }`
  with `@@unique([name, version])`. No `organizationId` (platform-level).
- `Organization.activeFormulaSetId String?` + relation `Restrict`.
- `Project.formulaSetId String?` + relation `Restrict`.
- `model ProjectCalculation { id, organizationId, projectId @unique, formulaSetId, computedAt, status,
  errorDetail?, summary Json, materialList Json, createdAt, updatedAt }` — `project` and `organization`
  `onDelete: Cascade`, `formulaSet` `Restrict`, `@@index([organizationId])`.
- Hand-write the migration SQL mirroring `20260919000001_add_project_config_snapshot`'s style (checked:
  exists at `prisma/migrations/20260919000001_add_project_config_snapshot/`). Do not run
  `prisma migrate dev` locally (no local DB) — write the SQL by hand against the schema diff and let devops
  apply it out-of-band to the dev Neon DB per the stage doc's caveat.
- Do **not** fold in F-1 (v1 design-parser removal) — stage doc says default is no, `db-helpers.ts` needs
  the v1 seed row for Stage 22 tests.

**Reuse:** existing migration `20260919000001_add_project_config_snapshot` as the style template; no other
new code.

**Verify:** `npx prisma generate` + `npx tsc --noEmit` + `npm run lint` locally. Push `feature/s23-b1-*`,
poll Vercel to `READY`, hit `/api/health` (expect `database: "connected"` — note: migration only applies
once devops runs it out-of-band on dev, so health-endpoint DB connectivity, not schema correctness, is what
this proves before that happens). Confirm existing project list/detail/create routes still work on the
preview (this migration is additive — nullable FKs — so nothing should break even pre-migration on shared
dev DB... but flag to reviewer that the preview will 500 on any Prisma call touching the new columns until
devops applies the migration; this is expected and matches the stage doc's caveat).

---

## Batch 2 — Starter-catalog swap + slots-only formula set + seed + backfill

**Files:** `lib/component-catalog-seed.ts` (rewrite), `prisma/formula-sets/glass-partition-standard-v1.json`
(new), `prisma/seed-formula-sets.ts` (new), `prisma/seed.ts` (modify), `prisma/backfill-formula-set-pins.ts`
(new), `package.json` (modify — new script), `tests/unit/formula-set-document.test.ts` (new),
`tests/e2e/superadmin-component-types.spec.ts` + `tests/e2e/subdomain-navigation.spec.ts` (modify).

**Plan:**
- Rewrite `COMPONENT_TYPE_DEFS` / `COMPONENT_TYPE_ORG_CONFIG_DEFS` in `lib/component-catalog-seed.ts` to the
  two `cloisons` types (GLASS, DOOR) per the "real starter catalog" table in the stage doc, using the
  `valueMap` shape the org-config helper already supports (per the stage doc, currently only ever exercised
  with flat `{ options }` — will need to actually read `setComponentTypeOrgConfig`/
  `createOrganizationWithDefaults()` write path to confirm `valueMap` round-trips before trusting it).
- Author `prisma/formula-sets/glass-partition-standard-v1.json`: `{ slots: { GLASS: { role: "glass",
  requiredParams: [], summaryParams: { glassType: "glassType", thickness: "thickness" } }, DOOR: { role:
  "door", requiredParams: [], summaryParams: { category: "category", doorType: "doorType" } } },
  formulas: [] }` plus the `NOTE` header block (v1 is formula-free, v2 is the same `name`, profiles are
  deliberately unbilled / no PROFILE_STOP slot).
- `prisma/seed-formula-sets.ts`: read the JSON, upsert on `(name, version)`, create-only — never update an
  existing `(name, version)`'s `body` (log+skip on hash mismatch, per #1 immutability).
- Wire into `prisma/seed.ts`'s `main()`: call the catalog seed with the new defs, call the formula-set seed,
  set every seeded org's `activeFormulaSetId`. Make the `COMPONENT_TYPE_DEFS.length × orgs` count lines
  informational only (existing orgs keep `PROFILE_STOP`, so the raw count no longer matches an "expected"
  figure). Confirm the seed never deletes `PROFILE_STOP` rows or existing `ComponentTypeOrgConfig` values.
- `prisma/backfill-formula-set-pins.ts`, modelled on `prisma/backfill-config-snapshots.ts` (confirmed
  present): dry-run default, `--write` required, `--project=<id>` single-row mode, imports
  `prisma/db-target-guard.ts` (confirmed present), prints counts, idempotent (touches only NULLs), reports
  rejects without writing. Two passes: orgs with null `activeFormulaSetId` → seeded set; projects with null
  `formulaSetId` → their org's set.
- `package.json`: add `"backfill:formula-pins": "tsx prisma/backfill-formula-set-pins.ts"`.
- Unit tests (`tests/unit/formula-set-document.test.ts`): JSON parses, `formulas === []`, no `numericType`
  anywhere, every slot code + `summaryParams` value exists in the new catalog defs, every referenced key is
  `required: true` in the starter catalog schema, every slot has a `role`, no `PROFILE_STOP` slot, no
  `expr-eval` in `package.json`.
- Update the two e2e specs per the blast-radius table (assert the seeded def list, not 3 hardcoded codes /
  update the "3 component types" assertion).

**Reuse:** `prisma/backfill-config-snapshots.ts` (shape/CLI conventions), `prisma/db-target-guard.ts` (guard
import), existing `lib/component-catalog-seed.ts` structure (rewritten in place, not replaced with a new
file), existing `prisma/seed.ts` org loop.

**Verify:** lint/tsc/`test:unit` locally. Push, verify on preview: seed a **fresh** org via `/controls` →
two new types with working cascading dropdowns in Add Component (proves the `valueMap` write path); re-run
`prisma db seed` on dev (devops/CLI) → existing orgs' `PROFILE_STOP` and configs untouched; backfill
dry-run then `--write` on dev prints counts, `Failures: 0`, re-run reports 0 remaining; guard aborts without
`EXPECT_ENDPOINT`; two seed runs → one `FormulaSet` row for `(name, version)`; e2e specs green.

---

## Batch 4 — Summary builder module (run before Batch 3, per the solo-dev order)

**Gate status:** **CLEARED (2026-09-21).** A1 (door row aggregation) is resolved and locked as **D-40**,
correcting D-27/D-31: `doors[]` hangs off the **wall**, alongside that wall's `glass[]` — never the room.
Identical doors aggregate **within the same wall only**; doors on different walls never merge, even when
identical. A wall with no doors emits `"doors": []`; `rooms[]` carries no door list at all.

**Files:** `lib/summary/index.ts` (new, `buildSummary(input) → SummaryResult`), `lib/summary/types.ts`
(new), `tests/unit/summary-builder.test.ts` (new).

**Plan:**
- Pure-TS, Prisma-free module. Input: `{ formulaSetBody, snapshot: ConfigSnapshot, floors: [...], selections:
  [...] }` (exact shape per stage doc Batch 4 step 1) → `{ status, errorDetail?, summary, materialList: [] }`
  (materialList always `[]`, D-37).
- Resolution walk: `cell.selectionId → Selection.componentTypeId → snapshot.componentTypes[].id → code →
  slot`. Never reads a live `ComponentType` row — reuses only the **types** from `lib/config-snapshot.ts`
  (`ConfigSnapshot`), not its Prisma-touching functions.
- Glass rows: one per glass cell in `sections[].cells[]` (uses `lib/partition-design.ts`'s `DesignCellV2`
  shape for reference, but this module takes plain data, not parsed-design objects directly — the caller
  in Batch 5 does the Prisma/parsing work and hands this module plain floors/rooms/partitions/cells).
  `widthMm` = section width, `heightMm` = `cell.heightMm`, `areaM2` = product/1e6 at 4dp, tagged
  `(glassType, thickness)` via `summaryParams` (D-32 — GLASS `category` never read).
- Door rows: on the **wall** whose section contains the door cell (D-31/D-40), in that wall's own `doors[]`
  alongside its `glass[]`, `widthMm` = section width (D-29), `handing` from `cell.hinging` (`left→LH`,
  `right→RH`, absent→LH, D-28, never null), `category`/`doorType` raw via `summaryParams` (D-30), then
  aggregate identical rows **within that wall only** (D-40) — never across walls, even when identical. A
  wall with no doors emits `doors: []`; rooms carry no door list.
- KPIs: `totalPartitionSqm` glass-only; `sqmByGlassType` by raw pair; `doorsByType` by `doorType`; sum
  unrounded, round once.
- Failures: null `selectionId` → `FAILED` naming partition+cell (D-33, no "Unassigned" path at all); a
  blank value for an org-`required: true` key → `FAILED`; blank for non-required → `null` in the row, never
  a crash, never `"undefined"`.
- Only the four role-param names are literals, and only as `summaryParams` map keys — never a direct
  `config` read, never a ComponentType `code` literal.

**Reuse:** `ConfigSnapshot` type from `lib/config-snapshot.ts`; `DesignCellV2`'s `hinging` field shape from
`lib/partition-design.ts` as the reference for what "the design document" looks like (confirmed both files
exist).

**Unit tests:** the full list in the stage doc's Batch 4 section (plain glass wall, transom worked example,
two glass types, two thicknesses, category-doesn't-affect-grouping, two identical doors on the **same**
wall → one row `quantity: 2`, three identical doors split 2/1 across **two different** walls → two rows
(`quantity: 2` under wall A, `quantity: 1` under wall B — never one merged row of 3, D-40), hinging
LH/RH/absent, blank non-required → null, blank required → FAILED, missing snapshot key → null not throw,
null selectionId → FAILED naming cell no Unassigned, missing componentTypeId → FAILED, materialList always
`[]`, determinism).

**Verify:** lint/tsc/`test:unit` locally (all pure TS, no DB). Static checks: `grep -rn "prisma" lib/summary/`
empty; no `lib/data/*` import; `grep -rn "expr-eval\|materialCode\|numericType"` empty; `grep -rn
"Unassigned"` empty; `grep -rn "PROFILE_STOP\|handedness\|O/S"` empty.

---

## Batch 3 — Creation-time wiring + invalidation paths

**Files:** `lib/formula-compat.ts` (new), `lib/data/projects.ts`, `lib/data/inquiries.ts`,
`lib/data/partitions.ts`, `lib/data/rooms.ts`, `lib/data/floors.ts`, `lib/data/selections.ts`,
`lib/data/superadmin/orgs.ts` (all modify), plus the two create routes (map new error to 409).

**Plan:**
- `lib/formula-compat.ts`: `keysReferencedBySet(setBody, code)` = `requiredParams[].key ∪
  Object.values(summaryParams)`; `checkStructuralCompatibility(setBody, snapshot)` — pure, no Prisma,
  handles a null snapshot cleanly (returns incompatible, doesn't throw). **This is the single export Batch
  6 must import, never re-derive (D-36).**
- `createProject()` (confirmed at `lib/data/projects.ts` ~L254, already loads `configSnapshot` in its
  `$transaction`) and `convertInquiryToProject()` (confirmed at `lib/data/inquiries.ts` ~L452): after the
  snapshot load, read the org's `activeFormulaSetId` + set body, run the check, throw typed errors on
  failure (`FORMULA_SET_INCOMPATIBLE` / `NO_ACTIVE_FORMULA_SET`), else write `formulaSetId`. Routes map both
  to 409 with detail. `updateProject()` untouched (never writes the pin).
- `createOrganizationWithDefaults()` (confirmed `lib/data/superadmin/orgs.ts` ~L98): set
  `activeFormulaSetId` by looking up the seeded `(name, version)`; fail org creation loudly if absent.
- Shared `invalidateProjectCalculation(tx, projectId)` helper: `deleteMany` + clear `designSubmittedAt` if
  non-null. Called from: `updatePartition()` (confirmed ~L201, extending Stage 22's block per D-17 to run
  regardless of current `designSubmittedAt`), `replaceSides()` (confirmed `lib/data/rooms.ts` ~L340),
  `deleteFloor()`/`deleteRoom()` (confirmed ~L137 / ~L284), `updateSelection()` when patch carries `config`
  (confirmed ~L163).
- `deleteProject()`/`deleteOrganization()` (confirmed ~L478 / `superadmin/orgs.ts` ~L341): add
  `projectCalculation` delete before `project` in the explicit cascade lists (belt-and-suspenders alongside
  the `onDelete: Cascade` FK from Batch 1).

**Reuse:** the existing `$transaction` blocks in every listed function (confirmed to exist at the cited
line numbers in the stage doc's "Verified repo facts" table) — this batch extends them, doesn't restructure
them. `lib/config-snapshot.ts`'s `ConfigSnapshot` type for `checkStructuralCompatibility`'s input typing.

**Verify:** lint/tsc locally + unit tests for `checkStructuralCompatibility()` (compatible / missing code /
inactive code / missing summaryParams key / required:false key still compatible / empty requiredParams
compatible / empty snapshot / null snapshot fails cleanly). On preview: 201 with `formulaSetId` set; 409 on
deactivated/renamed slot code; 409 on no `activeFormulaSetId`; inquiry conversion sets the pin; geometry
PATCH deletes calc + clears `designSubmittedAt`, label-only PATCH does neither; same for rooms/sides PATCH,
Floor delete, Room delete, Selection `config` PATCH; project delete with a calc succeeds; SuperAdmin
hard-delete of an org with projects+calcs succeeds; new org via `/controls` has `activeFormulaSetId` set.

---

## Batch 6 — Key-edit + type-lifecycle guard (can run alongside 3–5, but see tier note above)

**Files:** `lib/formula-compat.ts` (modify — add `slotForCode()` + key-diff, **importing**
`keysReferencedBySet()` from Batch 3, not redefining it), `lib/data/components.ts` (modify —
`updateComponentType()` ~L170), `lib/data/superadmin/component-types.ts` (modify —
`updateComponentTypeForOrg()` ~L203, `deleteComponentTypeForOrg()` ~L301), both component-type route files
(modify — map to 409).

**Plan:**
- Add `slotForCode(setBody, code)` + a removed/renamed-key diff to `lib/formula-compat.ts`, reusing the
  Batch-3 `keysReferencedBySet()` export (one definition, ≥2 importers, per D-36's acceptance check).
- In each of the three DAL functions: resolve org's `activeFormulaSetId` → `body.slots[existing.code]`; no
  active set or no matching slot → allow. Otherwise block (409, shared typed error) on: (1) removing/renaming
  a referenced `fieldsSchema` key, (2) changing `code` when the assigned set has a slot with the old code,
  (3) `active: false` or delete on a slot-referenced type. Extend each function's existing `select` to
  include `code`/`fieldsSchema` rather than adding a round-trip (all three already fetch the existing row
  per the stage doc's verified entry-point table).
- Guard lives in the DAL, not the route handler (future callers inherit it); route handlers just map the
  thrown error to 409.
- Document the deliberate non-blocks (label/hint/options/type/required/dependsOn edits, `field-values` PUT,
  new field, reorder, rename type `name`/`categoryId`) as code comments, per the stage doc.

**Reuse:** `keysReferencedBySet()` from Batch 3's `lib/formula-compat.ts` (no re-derivation, D-36); existing
`RESERVED_COMPONENT_TYPE_CODES` check (kept as-is, fires first for reserved codes → 400, before the new
409 guard for non-reserved slot codes).

**Verify:** lint/tsc + unit tests for `keysReferencedBySet()` (summary-only key, empty requiredParams),
`slotForCode()`, key-diff. On preview: SuperAdmin PATCH removing `glassType`/`category` → 409 naming
set+version+slot+param; org-level PATCH same → 409 (separate code path, D-26, asserted separately);
non-reserved slot `code` change → 409; `active: false` → 409 on both routes; SuperAdmin DELETE of a slot
type → 409; allowed edits (label/hint/options/type/required/dependsOn, field-values PUT, reorder) → 200;
org with null `activeFormulaSetId` → unaffected; existing project's summary still computes after an
allowed edit.

---

## Batch 5 — Submit-design pipeline + recompute

**Files:** `lib/data/projects.ts` (modify — `submitDesign()`, new `recomputeProject()`),
`lib/data/calculations.ts` (new, optional shared loader), submit-design route (modify), recompute route
(new).

**Plan:**
- One shared function (in `lib/data/calculations.ts` or inline in `projects.ts` if it doesn't earn its own
  file): load project (pin + `configSnapshot`), `FormulaSet.body`, floors/rooms/partitions (**including
  `Floor.label`/`Room.label`**, per stage doc note) and Selections, call `lib/summary`'s `buildSummary()`,
  upsert `ProjectCalculation` on `projectId` with `formulaSetId`, `computedAt`, `status`, `errorDetail`,
  `summary`, `materialList: []`, `organizationId`.
- `submitDesign()`: add the 13b data check (every cell has non-null `selectionId` resolving to a live
  Selection) *before* building — failure → 422 naming offending partition/cell, nothing written. On success,
  build + write + stamp `designSubmittedAt` in one transaction. A `FAILED` build result is still written but
  submit is blocked (422, no `designSubmittedAt`).
- New `POST .../recompute` route: DRAFT-only, gated per D-23 (project must have a `designSubmittedAt` or an
  existing calculation already — never the first computation), same shared path, does not touch
  `designSubmittedAt`.
- Keep existing "≥1 partition → 400" behavior in `submitDesign()`.

**Reuse:** the confirmed existing `submitDesign()` at `.../submit-design/route.ts` (~L435) and its DAL
counterpart; `lib/summary`'s `buildSummary()` from Batch 4; the `invalidateProjectCalculation` shape isn't
reused here (this is the write path, not the invalidate path) but the same transaction-per-write discipline
from Batch 3 applies.

**Verify:** lint/tsc locally. On preview: successful submit → OK row with computedAt, materialList `[]`,
designSubmittedAt set; summary shape matches D-27 (per-wall glass and per-wall doors, D-40, kpis); labels
populated;
null-selectionId submit → 422, no row, no stamp; recompute over an old null-selectionId cell → FAILED row,
no crash, no Unassigned; null configSnapshot → clean 409/422 not a crash; recompute deterministic, leaves
designSubmittedAt alone; recompute on non-DRAFT → 409; recompute never-computed → 409; cross-org 404;
renaming a ComponentType code doesn't change an existing project's result (proves snapshot isolation).

---

## Batch 7 — E2E + docs reconciliation (written last, scope only — not pre-written)

**Files:** `tests/e2e/stage23-summary.spec.ts` (new), `tests/e2e/db-helpers.ts` (modify if needed),
`regression-checklist.md`, `design-docs/sql-queries/by-page.sql`, `04-data-model.md`, `03-subsystems.md`,
`07-roadmap-open-questions.md`, `08-decisions-and-changelog.md`, `development-cycles/README.md`,
`stage-24.md`, `TECH_DESIGN.md`, `stage-23.md` itself (Execution Log + Deviations register).

**Plan:** as scoped in the stage doc — write the actual E2E suite once behavior is known, not before;
update `by-page.sql` with every new Prisma call shape (creation-time formula-set read, compatibility read,
calculation upsert/read/delete, backfill UPDATEs, guard lookups); flip status flags and replace old
catalog vocabulary in the design docs; reconcile the stage file's own Execution Log/Deviations register
with what actually happened across Batches 1–6; append notes to `task-format-retro.md`.

**Verify:** E2E suite green against the pushed preview; `by-page.sql` reviewed for completeness; docs
status flags flipped; old vocabulary gone; changelog + TECH_DESIGN `Last updated` bumped.

---

## Cross-cutting notes

- **No local dev server/build/DB** at any point — every functional check happens against that batch's own
  pushed preview, per the hard rule.
- **Production is never touched by me.** Batch 2's backfill `--write` run happens only on the dev Neon DB
  during implement; the production run is human-executed from `stage-23-prod-runbook.md` after promotion.
- Watch the migration-caveat sequencing: Batch 1's migration must land on the dev DB (devops, out-of-band)
  before Batch 2+ previews can actually exercise the new columns — I'll flag in the worklog if a preview
  500s for that reason so it isn't mistaken for a real bug.
