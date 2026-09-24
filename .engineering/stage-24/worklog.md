# Stage 24 worklog — Material-list formula/data engine (`cloisons`)

## Status

- **Phase:** test — **COMPLETE, PASS**. All 6 batches merged into `release/stage-24` (pushed to origin
  @ `d9f30e5`). No outstanding `feature/*` branches. Human signed off on the PASS; handing off to
  **`engineering:deploy`** next.
- **Active work item:** none — implement and test phases both closed.
- **Latest artifacts:** `bugs-1.md` (tester's formal verification pass — **PASS**, 0 blocking findings, 1
  MINOR non-blocking pre-existing lint issue unrelated to this stage) — independently re-ran 282/282 unit
  + 17/17 E2E against a fresh `release/stage-24` preview (`quotation-system-3hgn8gdct`), plus 4 live
  gap-probes and direct verification of the decision-10 submit gate (nothing written on refusal) and G-3
  Recompute behavior. `review-b6-2.md` (APPROVE-WITH-NITS, all 14 review-b6-1 findings genuinely fixed
  and re-verified live; 3 trivial doc-wording nits fixed directly post-approval, commits `d32b16c` (docs
  repo) + `895a634` (app repo, included in the merge)). Full Execution Log + Deviations register written
  to `../quotation-system-docs/development-cycles/stage-24.md`.
- **Human-facing item carried forward (not blocking, gated in the prod runbook):** D-1 —
  `perUnitQuantity` values (used for pack-rounding every cloisons material line) were authored by the
  developer in Batch 3 and have never been confirmed against cloisons' real stock/purchase-unit sizes.
  `stage-24-prod-runbook.md` now has this as a hard precondition (Step 0) before the runbook can run for
  real — the human should confirm these 22 values with the customer before that day, not discover the
  gate mid-procedure.
- **Branch:** `release/stage-24` (pushed to origin @ `d9f30e5`). Dev DB migration
  `20260923000001_inventory_items_and_material_by_room` applied and verified; dev DB seed (cloisons
  inventory + formula set + ComponentType fields, 34 total InventoryItem rows) applied and verified
  idempotent.
- **Batch order (per stage-24.md):** 1 ✅ → 2 ✅ → 4 ✅ → 3 ✅ → 5 ✅ → 6 ✅ — all done.

## Work items

| Batch | Name | Depends on | Status |
|---|---|---|---|
| 1 | Schema + migration | — | **done** — merged to `release/stage-24`, dev DB migrated |
| 2 | Document types + problem types + validators | — | **done** — merged to `release/stage-24`, 142/142 unit tests |
| 4 | Evaluator | 2 | **done** — merged to `release/stage-24` (3 review rounds, caught 4 real bugs), 252/252 unit tests |
| 3 | `cloisons` data (fields, options, inventory, formula set) | 1, 2 | **done** — merged to `release/stage-24`, 266/266 unit tests, dev DB seeded |
| 5 | Resolution + aggregation + submit gate + pipeline wiring | 1, 3, 4 | **done** — merged to `release/stage-24` (2 review rounds, THE END GOAL verified live), 282/282 unit tests |
| 6 | E2E + docs reconciliation | 1–5 | **done** — merged to `release/stage-24` (2 review rounds, caught a critical missing prod script + several runbook accuracy issues), 17/17 E2E pass, all docs reconciled |

## Activity log

---

### 2026-09-23 — reviewer — Batch 6 re-review (round 2, final)

**Role:** reviewer · **Verdict:** APPROVE-WITH-NITS · 0 CRITICAL / 0 IMPORTANT / 3 MINOR · report: `review-b6-2.md`
All review-b6-1 findings verified fixed. Reviewer re-ran tsc (clean), lint (no new issues), unit 282/282, E2E stage24-materials 17/17 on preview `dge5rk43h`, and the new cloisons reseed script as a dry run against dev.

---

### 2026-09-23 — developer — Batch 6 fix round (review-b6-1)

**Role:** developer
**Branch:** `feature/s24-b6-e2e-docs` — commit `8a8914c`

**Files changed — app repo:**
- `prisma/seed-inventory-cloisons.ts` (NEW) — CRITICAL-1: guarded, dry-run-by-default prod script; `EXPECT_ENDPOINT` guard + `*** PRODUCTION ***` banner; deletes cloisons InventoryItems (ItemPrice cascades), inserts 22 CLOISONS_INVENTORY_DEFS; dry-run reports by code + perUnitQuantity.
- `prisma/e2e-db-helper-cli.ts` — added `readCalculation` op (IMPORTANT-4).
- `tests/e2e/db-helpers.ts` — exported `readCalculation` helper (IMPORTANT-4).
- `tests/e2e/stage24-materials.spec.ts` — A1 strengthened (DB read of materialByRoom after submit); C2 strengthened (full row snapshot + `toEqual`); afterAll backstop for C2 (M-3); J1 saves+restores original fieldsSchema in finally (M-2); D3 uses `toEqual` (M-1); M2 title fixed (M-4); unused `roomId` removed; thinking-out-loud comments removed (M-6).
- `regression-checklist.md` — item 116 key fixed `inventoryItems`→`items` (M-4); items 118–120 added for C4/J2/K1 (M-5).

**Files changed — docs repo (commit `4f0b29b`):**
- `development-cycles/stage-24-prod-runbook.md` — Step 0 (D-1 precondition, correct 5×3.0 list); Step 1 SQL uses `"CatalogItem"` pre-merge + cloisons org STOP; window note rewritten; Step 4 references real script + 22 count; Step 5 adds 34-total check + cloisons-org STOP; Step 6 prescribes GLASS+DOOR design, removes impossible response check, SQL scoped to throwaway project; Step 7 rollback corrected (code rollback NOT safe).
- `development-cycles/stage-24.md` — Batch 4 architect ruling added; end-goal citation corrected to review-b5-1 + GLASS+DOOR design + `{project}` note; status → "implement complete; pending test + promotion".
- `TECH_DESIGN.md` — "promoted 2026-09-23" removed; status corrected.
- `design-docs/08-decisions-and-changelog.md` — expr-eval paragraph corrected (infix `a or b`, not bitwise; anchor fixed).
- `development-cycles/README.md` — Stage 24 row status corrected.

**Verify:** `npx tsc --noEmit` → clean. `npm run lint` → 4 known errors in prod-recon-readonly.ts, no new errors, no new warnings. `npm run test:unit` → **282/282 pass**. `npx playwright test stage24-materials --workers=1` → **17/17 pass** (1.7 min) against preview `dge5rk43h`.

**Status:** DONE

---

### 2026-09-23 — developer — Batch 6 implement (final)

**Role:** developer
**Branch:** `feature/s24-b6-e2e-docs` — commits `7be8bf3` (initial), `c3a4d8d` (spec fix), `8d4edf0` (M2 fix)

**Files created/changed — app repo:**
- `tests/e2e/stage24-materials.spec.ts` (NEW) — 17 E2E tests, groups A–M
- `prisma/e2e-db-helper-cli.ts` — added `setInventoryItemActive` op
- `tests/e2e/db-helpers.ts` — exported `setInventoryItemActive` function
- `regression-checklist.md` — items 116, 117 (material-list engine, D-33 reversal)
- `prisma/schema.prisma` — fixed comment typo on line 238

**Files created/changed — docs repo (commit `73e9066`):**
- `development-cycles/stage-24-prod-runbook.md` (NEW) — full prod procedure, D-1 STOP condition
- `development-cycles/stage-24.md` — status ✅ Built, Execution Log, Deviations register
- `development-cycles/README.md` — Stage 24 row ✅ Built
- `design-docs/08-decisions-and-changelog.md` — Stage 24 entry (Decision-10 + D-33 reversal)
- `design-docs/formula-engine.md`, `03-subsystems.md`, `04-data-model.md` — status flips to ✅
- `design-docs/07-roadmap-open-questions.md` — Stage 24 items resolved
- `backlog/backlog.md` — Medium item: buildSummary FAILED→422 non-exhaustive/no-locus gap
- `TECH_DESIGN.md` — "Stages 1–24 live" + Stage 25 next
- `development-cycles/stage-23.md` — D-33 reversal note appended

**Key bug discovered and fixed mid-session:**
- submit-design route returns `{ project }` only (not `{ project, calculation }`); initial spec
  read `body.calculation` from submit body → `TypeError: Cannot read properties of undefined`.
- Fix: after submit → 200, call recompute to get `{ calculation }` with materialList.
- materialByRoom is globally omitted from all API responses (`lib/prisma.ts` line 23); A1 uses
  `readProjectState` to verify calcCount=1 instead of checking materialByRoom content in response.
- M2 test assumed response key `inventoryItems`; actual route returns `{ items }` → fixed.

**Verify:** `npx playwright test stage24-materials --workers=1` → **17/17 pass** (1.4 min) against
preview `7z0i5pool`. `npx playwright test stage23-summary --workers=1` → **4 passed, 3 skipped**
(SuperAdmin-only tests, expected). Preview: `https://quotation-system-7z0i5pool-vistra-indias-projects.vercel.app`

**Status:** DONE

---

### 2026-09-23 — developer — Batch 6 plan phase

**Role:** developer
**Branch:** `feature/s24-b6-e2e-docs`
**Artifact:** `.engineering/stage-24/plan-b6.md`

**Read:** `profile.md`, full `worklog.md` (all 5 batch histories), `retro.md`, `stage-24.md` §Batch 6
+ §Testing posture + §Production data operations + §Decisions, `stage-23-prod-runbook.md` (structure
reference), `stage23-summary.spec.ts` (E2E pattern reference), `db-helpers.ts` (existing ops),
`prisma/schema.prisma` (lines 234–258, 650–682 — comment typo confirmed on line 238),
`08-decisions-and-changelog.md` tail (confirmed no Stage 24 decisions entry yet),
docs git log (confirmed `1fa1e6b` has expr-eval/sections[] docs, `012dd74` has by-page.sql Batch 5
update — both already committed; `by-page.sql` is verify-only for Batch 6).

**Investigation results:**
- Decision 10 reversal: stage-24.md preamble documents it; `08-decisions-and-changelog.md` does NOT
  yet have a Stage 24 entry → new work for Batch 6.
- D-33 reversal (Recompute no longer writes FAILED): in worklog MINOR-3 but not in decisions log → new work.
- expr-eval `||`/`&&` fix: documented in docs commit `1fa1e6b` → verify-only.
- sections[] ordering limitation: documented in `1fa1e6b` → verify-only.
- Batch 3 GLASS/DOOR required-fields concern: resolved — stage23-summary.spec.ts confirmed passing (4 passed)
  in review-b5-2 live check. No remediation needed.
- Batch 1 review-2 nit (schema.prisma comment `20260924*`): NOT yet fixed, confirmed on line 238 → fix in Batch 6.
- Batch 1 review-2 nit (writeCalculation deferral): resolved by Batch 5 implementation → no action.
- Batch 5 deferred minors (FAILED→422 problem lacks locus / non-exhaustive): NOT yet in backlog → new work.
- by-page.sql: latest update is `012dd74` covering all Batch 5 new calls → verify-only.

**Flags / human decisions:**
- D-1 still open: `perUnitQuantity` values need human confirmation before prod runbook runs for real.
  Flagged in plan-b6.md §prod runbook Step 4. Human must confirm before the cloisons production reseed.

**Status:** DONE (plan phase)

---

### 2026-09-23 — developer — Batch 5 fix round (review-b5-1 CHANGES-NEEDED)

**Role:** developer
**Branch:** `feature/s24-b5-resolve-gate` → commit `18fa457`

**Findings addressed:**

- **IMPORTANT-1** (buildSummary FAILED → 500): in both `submitDesign` and `recomputeProject` in `lib/data/projects.ts`, replaced the `throw new Error(...)` with a proper `calculationRefused` return. Creates a `ProblemCollector`, adds a `MISSING_PARAM`/SELECTION-scope problem carrying `result.errorDetail` as the message, and returns `{ calculationRefused: failedCollector.report() }`. The throw-as-500 backstop in the outer catch still covers genuinely unexpected errors. Added 2 new unit tests to `summary-builder.test.ts` covering the exact two FAILED conditions (blank GLASS.glassType, GLASS type with no slot in formula set).

- **IMPORTANT-2** (missing `error` field on 422 body): added `error: string` to `CalculationProblemReport` interface and populated it in `report()` as `${problems[0].message}${problems.length > 1 ? \` (and ${problems.length - 1} more)\` : ""}` (empty string when no problems). `design-workspace.tsx:94-95` and `stage23-summary.spec.ts:250-251,267` continue working without any UI-side changes. Added 4 new unit tests to `materials-problems.test.ts` covering single-problem, two-problem, three-problem, and empty-collector cases.

- **IMPORTANT-3** (v1 materialByRoom per-room empties): fixed `lib/materials/index.ts` v1 fast-path to return `byRoom: []` instead of `byRoom: allRooms.map(...)`. Matches Stage 23's byte-identical behavior (column default `'[]'`). Updated `materials-evaluate.test.ts` v1 fast-path test to assert `[]`. Decision: match Stage 23's `[]` as spec requires (orchestrator instruction confirmed this direction).

- **MINOR-1** (perUnitQuantity <= 0 guard): added guard in `lib/materials/resolve.ts` step 2e. Emits `NON_FINITE_QUANTITY` INVENTORY-scope problem and `continue`s. Added 3 unit tests to `materials-resolve.test.ts` covering perUnitQuantity=0, perUnitQuantity<0, and a valid tiny positive value.

- **MINOR-2** (dead code removal): deleted `checkDesignReadyForSubmit` + `DesignCheckViolation` from `lib/data/calculations.ts` (zero callers after Batch 5). Deleted `tests/unit/calculations-preflight.test.ts`. Updated file header comment.

- **MINOR-3** (D-33 behavioral reversal note): documented in worklog — Recompute used to write a FAILED row for a null-cell project (D-33); it now refuses with 422 and gains a new 422 path (D-B). Both are spec-mandated (G-3). Batch 6 will log the reversal in `08-decisions-and-changelog.md`.

**Files changed:**
- `lib/materials/problems.ts` — `CalculationProblemReport` gets `error: string`; `report()` populates it
- `lib/data/projects.ts` — both FAILED throw paths → `calculationRefused` return (2 sites)
- `lib/materials/index.ts` — v1 fast-path `byRoom: []`
- `lib/materials/resolve.ts` — perUnitQuantity <= 0 guard before `Math.ceil`
- `lib/data/calculations.ts` — removed `checkDesignReadyForSubmit` + `DesignCheckViolation` (MINOR-2)
- `tests/unit/calculations-preflight.test.ts` — deleted (dead test file)
- `tests/unit/materials-evaluate.test.ts` — v1 byRoom assertion updated to `[]`
- `tests/unit/materials-problems.test.ts` — 4 new `error` field tests
- `tests/unit/materials-resolve.test.ts` — 3 new perUnitQuantity guard tests
- `tests/unit/summary-builder.test.ts` — 2 new FAILED-route tests (blank GLASS.glassType, no slot)

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 4 errors / 9 warnings (all pre-existing in `.engineering/stage-22/prod-recon-readonly.ts`) | `npm run test:unit` → **282/282 pass** (deleted 9 dead preflight tests + added 4+2+3=9 new tests = same count at 282) | pushed `18fa457` to `feature/s24-b5-resolve-gate`

**D-33 note (MINOR-3):** Recompute previously wrote a FAILED row on null-cell projects (D-33, Stage 23). Stage 24 Batch 5 reversed this: recompute now refuses with 422 (G-3: no partial write, stored row UNTOUCHED) and gained a new 422 path (D-B: calculationRefused). Both changes are spec-mandated. Batch 6 will record the reversal in `08-decisions-and-changelog.md` and the regression checklist.

**Status:** DONE

---

### 2026-09-23 — developer — Batch 5 implement

**Role:** developer
**Branch:** `feature/s24-b5-resolve-gate` → commit `1e713fa`

**Files created:**
- `lib/data/inventory.ts` — `loadInventoryMap(db, orgId)`: one `inventoryItem.findMany`, Decimal→number conversion
- `lib/materials/resolve.ts` — `resolveAndAggregate()`: aggregate→resolve (UNRESOLVED/INACTIVE/UNIT_MISMATCH)→ceil once→sort
- `tests/unit/materials-resolve.test.ts` — 13 tests (11 plan cases + locus/name edge cases)

**Files changed:**
- `lib/materials/problems.ts` — scope-aware `dedupeKey()` (DESIGN=partitionId+sectionIndex+cellIndex, INVENTORY=kind+code, SELECTION/FORMULA_SET=existing key)
- `lib/data/calculations.ts` — room query extended (isClosed+sides), `roomTopology: Map` added to `CalculationLoad`, `runPhaseA()` added (structural check → CELL_UNASSIGNED/SELECTION_MISSING/SELECTION_TYPE_UNKNOWN), `writeCalculation()` signature extended with `materialList`+`materialByRoom` (D-E fix)
- `lib/data/projects.ts` — `buildMaterialsInputHelper()` local helper; `submitDesign` and `recomputeProject` rewritten to two-phase gate; `SubmitDesignResult`/`RecomputeProjectResult` drop `designIncomplete`/`buildFailed`, gain `calculationRefused`
- `app/api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design/route.ts` — `designIncomplete`/`buildFailed` handlers removed, single `calculationRefused` → 422 `CalculationProblemReport`
- `app/api/v1/orgs/[orgSlug]/projects/[projectId]/recompute/route.ts` — `calculationRefused` → 422 added (new path)
- `tests/unit/materials-problems.test.ts` — 2 new scope-aware dedupe tests
- `quotation-system-docs/design-docs/sql-queries/by-page.sql` — updated: room isClosed/sides select, loadInventoryMap SQL, writeCalculation materialByRoom

**Safety checks passed:**
- `writeCalculation` appears exactly twice in projects.ts — one per function, each reachable only when both collectors are empty (grep verified)
- `Math.ceil` appears exactly once in lib/materials/resolve.ts, on the project total (grep verified)
- `recomputeProject` exits 1 and 2 return before any write; stored row UNTOUCHED

**Reused:** `ProblemCollector` pattern; `prisma.$transaction` pattern; `node:test`/`node:assert/strict` test pattern; Prisma Db type (TransactionClient | typeof prisma) from lib/data pattern; `import type { RoomSide }` purity pattern from Batch 4

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 0 new errors (same 4/11 pre-existing baseline) | `npm run test:unit` → **282/282 pass** (+16 new: 13 materials-resolve + 2 materials-problems + 1 adjusted count) | pushed `1e713fa` to `feature/s24-b5-resolve-gate`

**Pending verification (blocked on dev DB seed):**
- ✅ Static checks clean, 282/282 unit tests
- ✅ Branch pushed; Vercel preview will build
- PENDING (seed not applied): cloisons org Submit Design with real formula set end-to-end
- PENDING (seed not applied): real UNRESOLVED_CODE/INACTIVE_ITEM/UNIT_MISMATCH 422 response with cloisons inventory
- Can verify on preview: v1-org (vistra) still writes `materialList: []` / `materialByRoom: []` on submit — status OK unchanged
- Can verify on preview: 422 gate with synthetic structural bad data (unassigned cell)
- Can verify on preview: cross-org tenancy (other org's projectId → 404)
- Can verify on preview: health check

**Status:** DONE

---

### 2026-09-23 — developer — Batch 5 plan phase

**Role:** developer
**Branch:** `feature/s24-b5-resolve-gate`
**Artifact:** `.engineering/stage-24/plan-b5.md`

**Read:** `profile.md`, `worklog.md` (Status block), `stage-24.md` §Batch 5 (files, steps 1–8, full acceptance checklist, Reviewer must check), decisions 10/10a/10b/10c/11/13/14, G-3 resolution. `formula-engine.md` §7 (InventoryItem — resolution algorithm, INACTIVE/UNRESOLVED/UNIT_MISMATCH table, inventory-not-in-snapshot rationale), §8.1–8.3 (artifact shapes, ceil rule, gate rule, two-phase collector). `lib/data/calculations.ts` (loadCalculationInput, checkDesignReadyForSubmit, writeCalculation — full Stage 23 shapes). `lib/data/projects.ts` (submitDesign, recomputeProject — current control flow). `submit-design/route.ts` and `recompute/route.ts` (dispatch shapes). `lib/materials/index.ts` (MaterialsResult: rawLines, byRoom, collector), `lib/materials/evaluate.ts` (RawMaterialLine: code, unit, requirement, slot, formulaId, roomId, partitionId), `lib/materials/problems.ts` (ProblemCollector, dedupeKey, INVENTORY-scope concern from review-b4-3), `lib/summary/types.ts` (MaterialListLine, MaterialByRoomEntry, SummaryInput shape). `review-2.md` (MINOR #4: materialByRoom stale-on-upsert carry-forward). `review-b4-3.md` (MINOR: INVENTORY-scope aggregate problem over-splitting with formulaId in key).

**Flags / decisions:**

- D-A: `SubmitDesignResult` drops `designIncomplete`/`buildFailed`; replaced by `calculationRefused`. Unexpected `buildSummary FAILED` becomes a thrown error (500), not a written FAILED row — Stage 24 §8.2 states no write path produces FAILED. See plan for full reasoning.
- D-B: `recompute/route.ts` gains 422 path (previously none).
- D-C: `dedupeKey()` in `problems.ts` becomes scope-aware (DESIGN: partitionId+indices; INVENTORY: kind+code only; SELECTION/FORMULA_SET: existing). Directly addresses review-b4-3 MINOR.
- D-D: `CalculationLoad` grows `roomTopology: Map<roomId, { label, isClosed, sides }>` field; DB query for rooms extended to select `isClosed`+`sides`. `SummaryInput` unchanged.
- D-E: `writeCalculation` grows `materialList` and `materialByRoom` parameters, fixing Batch 1 review-2 MINOR #4 (materialByRoom stale-on-upsert) simultaneously — both fields in shared `data` object.
- D-F: INVENTORY-scope `occurrences[].fieldKey` uses `formulaId` from RawMaterialLine (avoids touching merged Batch 4 evaluate.ts for a `paramKey` field).

**Control flow summary:**
- Phase A (runPhaseA): structural check, exhaustive, emits CELL_UNASSIGNED/SELECTION_MISSING/SELECTION_TYPE_UNKNOWN into a dedicated collector. If hasAny() → return `calculationRefused` immediately, no write.
- Phase B: buildSummary + buildMaterials + resolveAndAggregate share one collector. If hasAny() → return `calculationRefused` immediately, no write.
- Exactly one `writeCalculation` call, only when both collectors are empty. V1 sets: rawLines=[], collector empty → same write behavior as Stage 23.
- Recompute: identical two-phase gate; exits 1 and 2 return before any write → stored row byte-identical (computedAt, materialList, materialByRoom, designSubmittedAt all unchanged). NOT a D-17…D-20 invalidation.

**Status:** DONE (plan phase)

---

### 2026-09-23 — developer — Batch 3 implement

**Role:** developer
**Branch:** `feature/s24-b3-cloisons-data` → commit `c7c37b1`

**Files created:**
- `prisma/inventory/cloisons-inventory.ts` — 22 `CloisonsInventoryItemDef` rows (3 glass profiles, 12 DOOR items, 7 GLASS connector/gasket/wedge); pure data, no Prisma import
- `prisma/formula-sets/cloisons-formula-set-v1.json` — `schemaVersion: 2`, 22 formulas transcribed verbatim from current `door.md`/`partition.md` (uses `or` not `||`); NOTE stripped in `loadFormulaSetDocs()`

**Files changed:**
- `lib/component-catalog-seed.ts` — GLASS: `u_profile`/`i_profile`/`l_profile` `required: false → true`; added 7 new Advanced code fields; added 7 flat option entries to GLASS `COMPONENT_TYPE_ORG_CONFIG_DEFS`. DOOR: added `hasFrame`/`hasLeaf` + 12 material-code fields (all `required: true` per door.md D-2); added 16 option entries to DOOR `COMPONENT_TYPE_ORG_CONFIG_DEFS`
- `prisma/seed-formula-sets.ts` — imported `cloisonsFormulaSetV1` + `validateFormulaSetBody`; added cloisons doc to `loadFormulaSetDocs()`; added `validateFormulaSetBody()` call before `prisma.formulaSet.create()` (aborts seed loudly on failure)
- `prisma/seed.ts` — imported `CLOISONS_INVENTORY_DEFS`; added step 4c (cloisons inventory upsert, slug-targeted, graceful skip); added step 4d (cloisons formula-set activation, runs after general null-filter loop, overwrites unconditionally)
- `tests/unit/formula-set-document.test.ts` — added `cloisons-formula-set-v1.json` describe block with 14 tests: validate passes, schemaVersion, slot codes in catalog, requiredParams↔fieldsSchema, materialCode param keys (both directions ⚠️), option value↔InventoryItem (both directions ⚠️), unit cross-check (⚠️), no `||`/`&&`/`!`, calc.* backward ordering, loadFormulaSetDocs registration

**Reused:** `loadFormulaSetDocs()` extension pattern; `stableHash` + immutability guard; `inventoryItem.upsert({ where: { organizationId_code: ... } })` pattern; `formula-set-document.test.ts` describe/test structure and catalog cross-check pattern; `glass-partition-standard-v1.json` NOTE-strip body construction

**Decisions taken:**
- `attributes` field dropped from `CloisonsInventoryItemDef` (no Prisma import in pure data file); `attributes: {}` added explicitly in `seed.ts` create call to satisfy Prisma's `InputJsonValue` type
- All 252 existing tests unaffected; 14 new tests pass; all ⚠️-blocking cross-checks are live

**D-1 still open (human confirmation needed before prod runbook):** `perUnitQuantity` values — 3.0 for profile/structural items, 1 for gaskets/rubber/wedge/connectors. These affect real purchased-unit counts; if wrong, `ceil(req / perUnitQuantity)` is wrong for every cloisons material line.

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 4 errors / 9 warnings (all pre-existing in `.engineering/stage-22/prod-recon-readonly.ts`) | `npm run test:unit` → **266/266 pass** (252 pre-existing + 14 new) | pushed `c7c37b1` to `feature/s24-b3-cloisons-data`

**Status:** DONE

---

### 2026-09-23 — developer — Batch 3 plan phase

**Role:** developer
**Branch:** `feature/s24-b3-cloisons-data` (current)
**Artifact:** `.engineering/stage-24/plan-b3.md`

**Read:** `profile.md`, `worklog.md` (Status block), `stage-24.md` §Batch 3 (files, steps 1–5, acceptance
checklist, Reviewer must check), `door.md` in full (current version — `rubber25mm` condition now uses `or`,
Engine Conventions amendment present), `partition.md` in full (sections[] ordering limitation note present),
`lib/component-catalog-seed.ts` (COMPONENT_TYPE_DEFS + COMPONENT_TYPE_ORG_CONFIG_DEFS current shape),
`prisma/formula-sets/glass-partition-standard-v1.json` (Stage 23 precedent document shape),
`prisma/seed-formula-sets.ts` (loadFormulaSetDocs, immutability guard, stableHash pattern),
`prisma/seed.ts` (step 4 ComponentType loop, step 4b formula set loop, step 5 inventory loop),
`lib/formula-set/validate.ts` (validateFormulaSetBody signature, forbidden-operator check confirmed live),
`tests/unit/formula-set-document.test.ts` (test structure, cross-check patterns, catalog consistency tests).

**Flags surfaced (4):**
1. D-1 (for human): `perUnitQuantity` values not supplied — plan uses 3.0 for profiles/metres, 1 for everything else; needs human confirmation before prod runbook
2. D-2 (noted deviation): door.md explicitly marks all 14 DOOR fields `required: true` including condition-gated ones — overrides the generic stage-24.md checklist principle
3. D-3: `cloisons` org not in seeded orgs list — inventory seed and formula activation use `findFirst({ slug: "cloisons" })` with graceful skip
4. D-4: `ACTIVE_FORMULA_SET_NAME` stays unchanged; cloisons activation is a separate targeted update after the general null-filter loop

**Master cross-check table compiled (22 inventory items, 22 formulas, 14 DOOR + 10 GLASS fields):**
- Verified every `{param.x}` in materialCode maps to a declared requiredParams key
- Verified every formula unit matches every option value's inventory item measurementUnit
- Confirmed no `||`/`&&` in any formula (door.md amendment already corrected rubber25mm)
- Confirmed calc.* order within array satisfies the backward-reference rule in all cases

**Status:** DONE (plan phase)

---

### 2026-09-23 — developer — Batch 4 fix round 2 (review-b4-2 CHANGES-NEEDED)

**Role:** developer
**Branch:** `feature/s24-b4-evaluator` → commit `bfe52ef`

**Findings addressed:**

- **IMPORTANT (new, pre-existing root cause)** — ProblemCollector dedupe key collapsing distinct PARTITION-grain problems: added `|${p.locus?.formulaId ?? ""}` as a fifth segment to `dedupeKey()` in `lib/materials/problems.ts`. Chosen field: `formulaId` is populated on every NON_FINITE_QUANTITY locus (both condition-throw and quantity-NaN paths in the PARTITION pass at evaluate.ts:398-403, :418-423) and is the single field that genuinely distinguishes "same formula broke on N partitions (should dedupe → occurrenceCount=N)" from "two different formulas broke (must not collapse)". For MISSING_PARAM, `cellBlankSeen`/`partitionBlankSeen` already ensure at most one `add()` per (selectionId, fieldKey) pair, so the added segment doesn't change their behaviour.

- **MINOR** (comment accuracy, cross-slot `calc.*`): rewrote the comment in `lib/formula-set/validate.ts:318–326` — old claim "calcScope is per-slot at runtime" is false at PARTITION grain (calcScope is shared across all slots for the partition, `:354`). New comment accurately states: cross-slot is structurally impossible at CELL grain (filtered per cell's slot), and only conditionally satisfiable at PARTITION grain (depends on the partition having a cell of the referenced slot) — rejected at publish time in both cases.

- **MINOR** (PARTITION-grain `onThrow` test missing): added a 4-test describe block to `tests/unit/materials-evaluate.test.ts` covering a PARTITION-grain formula with a typo'd condition namespace → NON_FINITE_QUANTITY recorded (not silent skip), scope FORMULA_SET, locus.partitionId populated.

- **MINOR** (backlog trailing `|`): fixed missing closing pipe in `quotation-system-docs/backlog/backlog.md` row 48.

**New tests added (6):**
- `materials-problems.test.ts`: 2 new tests — reviewer's exact repro (different formulaIds → 2 problems), same formula different partitions → dedupes to occurrenceCount=2
- `materials-evaluate.test.ts`: 4 new tests — PARTITION-grain onThrow wiring (formula skipped, NON_FINITE_QUANTITY with formulaId, scope FORMULA_SET, partitionId in locus)

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 4 errors / 9 warnings (all pre-existing) | `npm run test:unit` → **252/252 pass** (6 new tests; was 246) | pushed `bfe52ef` to `feature/s24-b4-evaluator`

**Status:** DONE

---

### 2026-09-23 — developer — Batch 4 fix round (review-b4-1 CHANGES-NEEDED)

**Role:** developer
**Branch:** `feature/s24-b4-evaluator` → commit `11f1b06`

**Findings addressed:**

- **CRITICAL** (`||` guard): added `checkForbiddenLogicOperators()` static token check to `lib/formula-set/validate.ts` — rejects `||`, `&&`, `!` (when not part of `!=`) in any `condition`/`quantity` expression string with an error naming the formula id and recommending `or`/`and`/`not`. Confirmed against expr-eval@2.0.2: `or`/`and`/`not` are valid keywords; `&&` throws a parse error; `!` is factorial; `||` is string concatenation (silently wrong for boolean logic). Static check placed before `tryParse` so it fires even though these tokens parse cleanly.

- **IMPORTANT #2** (throwing condition silently swallowed): `evaluateExpr` gains an optional `onThrow` callback parameter. Both condition call-sites (CELL pass and PARTITION pass in `lib/materials/evaluate.ts`) now pass a callback that sets a `condThrew` flag and records `NON_FINITE_QUANTITY` (scope: `FORMULA_SET`) naming the formula id and the error message. `condThrew || !isConditionTrue(...)` skips the formula — throw and false are both "skip" but only throw produces a problem.

- **IMPORTANT #3** (arithmetic on missing `calc.*` silently 0): `evaluateExpr` now returns `NaN` for non-number/non-boolean expr-eval results (null, undefined, string, object) instead of coercing through `Number()`. `Number(null)=0` was the silent path; `NaN` is caught by the existing `!Number.isFinite()` guard → `NON_FINITE_QUANTITY` recorded. Boolean results now map to `1`/`0` (correct for conditions used as flags).

- **MINOR** (cross-slot `calc.*`): Validator 2 in `validate.ts` now tracks `idToSlot` alongside `idToIndex`/`idToGrain`. A `calc.<refId>` whose registered slot differs from the current formula's slot is rejected with a "cross-slot reference" error. Per formula-engine.md §6 the spec says "same grain" only; same-slot is enforced here because at runtime calcScope is per-slot and the cross-slot reference always resolves to undefined → NaN.

- **MINOR** (`nonCornerDoorCount` can go −1): `Math.max(0, doorCount - leftEndIsDoor - rightEndIsDoor)` in `lib/materials/geometry.ts`. Added explanatory comment.

- **MINOR** (partition absent from `sides[]` silent wall/wall): added a code comment in `geometry.ts` explaining the `idx===-1` path, why it's currently unreachable (Batch 5 phase-A structural pass gates submission first), and that it should be surfaced as a problem if it becomes reachable.

- **MINOR** (PARTITION pass blank-field dedup): added `partitionBlankSeen: Set<string>` per partition in the PARTITION-grain loop in `evaluate.ts`, aligning `occurrenceCount` semantics with the CELL pass.

**New tests added (13):**
- `formula-set-validate.test.ts`: 8 new tests — `||`/`&&`/`!` rejection, `!=` accepted, `or`/`and` accepted, cross-slot calc rejected, same-slot backward calc still accepted
- `materials-evaluate.test.ts`: 5 new tests — typo'd namespace condition throws → NON_FINITE_QUANTITY (not silent skip), arithmetic on missing `calc.*` → NON_FINITE_QUANTITY (not 0-quantity line)

**FLAG for human:** `door.md:131` still uses `||` (`param.hasFrame == 'Yes' || param.hasLeaf == 'Yes'`). This is a transcription error against expr-eval's grammar. Needs an explicit doc amendment: change to `or`, add an Engine Conventions note (e.g. "expr-eval uses `or`/`and`/`not` — `||`/`&&` are string concat / parse error"). Should accompany Batch 3 per the docs-first rule.

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 4 errors / 9 warnings (all pre-existing) | `npm run test:unit` → **246/246 pass** (13 new tests) | pushed `11f1b06` to `feature/s24-b4-evaluator`

**Status:** DONE

---

### 2026-09-23 — developer — Batch 4 implement

**Role:** developer
**Branch:** `feature/s24-b4-evaluator` → commit `4cc156a`

**Files created:**
- `lib/materials/geometry.ts` — `PartitionGeometry` + `derivePartitionGeometry()` (corner-junction table via `endFlags()` helper, adjacency from `sides[]`, full-height door detection, `neighborDesignResolver` injection)
- `lib/materials/evaluate.ts` — CELL + PARTITION grain walks; recording `Proxy` param accessor with per-cell blank-field dedup gate (so `occurrenceCount` reflects cells affected, not formulas-per-cell); `substituteCode()` (plain `{param.x}` replace, never expr-eval); `calcScope` accumulated per cell/partition; `NON_FINITE_QUANTITY` check; 3dp rounding for metres
- `lib/materials/index.ts` — `buildMaterials()` orchestrator: builds selectionMap/componentTypeCodeMap/designMap, v1 fast-path (returns empty), v2 path calls `evaluateAll()`, `byRoom` aggregation
- `tests/unit/materials-geometry.test.ts` — all 5 corner-junction rows × both ends, open-room edge cases, degree-connector halving, door-count metrics (full-height vs transom, nonCornerDoorCount)
- `tests/unit/materials-evaluate.test.ts` — door.md 3-column table (frame+leaf, frame only, neither), partition.md Scenario 1 (wall/wall, wall/partition, partition/partition), full-height vs transom profileU, doorConnector corner exclusion, no-GLASS partition, MISSING_PARAM lazy semantics (tests 12–16), determinism (test 17)

**Reused:** `ProblemCollector` from `lib/materials/problems.ts`; `Parser` import pattern from `lib/formula-set/validate.ts`; `node:test`/`node:assert/strict` pattern from `materials-problems.test.ts`; `isRecord()` helper pattern from `lib/summary/index.ts`

**Decisions taken:**
- Per-cell blank-field dedup gate (`cellBlankSeen: Set<string>`): each blank param records MISSING_PARAM at most once per cell regardless of how many formulas read it — making `occurrenceCount` track cells, not formula × cell. Not in plan but required for the plan's test 15 expectation (occurrenceCount=3 for 3 cells, not 21).

**CONCERN (Batch 3 must address):** `expr-eval` uses `or` (keyword) for logical OR, NOT `||`. The `||` operator in expr-eval is string concatenation. door.md's `rubber25mm` formula uses `||` in its condition (`"param.hasFrame == 'Yes' || param.hasLeaf == 'Yes'"`), which evaluates to `false` at runtime. The test formula set uses `or`; Batch 3's seed data must also use `or`. door.md itself should be corrected. This is not a blocking concern for Batch 4 (evaluator is correct — it passes expressions to expr-eval as-is), but it would cause `rubber25mm` to never fire in production until fixed.

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` (new files only) → 0 errors, 0 warnings | `npm run test:unit` → **233/233 pass** (142 pre-existing + 91 new) | `grep -rn "prisma\|lib/data/" lib/materials/` → comments only, no actual imports from Prisma or lib/data function calls; all 3 `lib/data/rooms` uses are `import type`

**Status:** DONE_WITH_CONCERNS (expr-eval `||` vs `or` concern flagged above — Batch 3 action required)

---

### 2026-09-23 — developer — Batch 4 plan phase

**Role:** developer
**Branch:** `feature/s24-b4-evaluator`
**Artifact:** `.engineering/stage-24/plan-b4.md`

**Read:** `profile.md` (stack/commands), `worklog.md` (Status block), `stage-24.md` §Batch 4 (files,
steps, full unit-test list, acceptance checklist, "Reviewer must check"), `formula-engine.md` in full
(§2 FormulaSetBody, §3 namespacing + grain walk + evaluation rules, §4 pinning, §5 org setup, §6
validators, §7 InventoryItem + resolution, §8 three artifacts + §8.1–8.3 in detail), `door.md` and
`partition.md` in full (formulas, worked examples, corner-junction table), `lib/materials/problems.ts`
(Batch 2 — ProblemCollector pattern), `lib/formula-set/validate.ts` (Batch 2 — expr-eval Parser import
pattern), `lib/summary/types.ts` (MaterialListLine, MaterialByRoomEntry, FormulaSetBody, etc.),
`lib/summary/index.ts` (pure-module discipline, ConfigSnapshot import pattern), `lib/data/rooms.ts`
(RoomSide type — PartitionSide / PlainSide shape and sides[] semantics).

**Plan summary:**
- 3 new pure modules: `lib/materials/index.ts` (orchestrator), `lib/materials/geometry.ts`
  (PartitionGeometry derivation — the corner-junction table, adjacency from Room.sides[]),
  `lib/materials/evaluate.ts` (grain walk, recording Proxy param accessor, expr-eval CELL/PARTITION
  evaluation, materialCode substitution, calc scope accumulation)
- 2 new test files: `materials-geometry.test.ts` (all 5 corner-junction rows + adjacency edge cases),
  `materials-evaluate.test.ts` (all minimum unit cases from stage-24.md — door 3-column table, partition
  Scenario 1 all 3 adjacency columns, MISSING_PARAM lazy semantics, deduplication, determinism)
- No existing files modified

**Flags surfaced (4):**
1. Corner-junction model is unverified against real commercial examples (known open item from partition.md;
   builds as authored, corrections are a new set version — no action needed)
2. `leftNeighborEndIsDoor` convention: "neighbor's matching end" interpreted as sides[] walk-order-based
   end (neighbor preceding B → B looks at neighbor's rightmost end; neighbor following → leftmost end).
   Spec implies this but does not state it explicitly. Flagged for reviewer.
3. Proxy for recording param accessor: requires Proxy.get() to intercept expr-eval's property access.
   Consistent with confirmed expr-eval dot-notation behavior (Batch 2). Flagged for completeness.
4. `import type { RoomSide }` from `lib/data/rooms.ts`: technically a data-layer type import; purity
   rule is "no Prisma, no lib/data function calls" — a type-only import of a shape definition is within
   bounds, but reviewer should confirm or instruct to duplicate inline.

**Worked-example verification (pre-plan, in my head):**
- Door 2m×3m, frame+leaf: doorFrame=(2000+6000)/1000=8m, doorLeaf=2×5000/1000=10m, rubber25mm=8+10=18m,
  frameBackGasket=4×3000/1000=12m — all match the table. ✓
- Partition Scenario 1 (4000×3000, wall/wall): profileU=4m, profileL/I=10m, acousticGasket=2×4+10+10=28m,
  whiteSeal=4+10=14m, straightConnector=2×(⌈3000/3000⌉-1)+2×(⌈4000/3000⌉-1)=0+2=2 ✓
- lConnector wall/wall=4, wall/partition=2, partition/partition=0 ✓

**Status:** DONE (plan phase)

---

### 2026-09-23 — developer — Batch 2 fix round (review-b2-1 CHANGES-NEEDED)

**Role:** developer
**Branch:** `feature/s24-b2-types-validators` (pushed `5ae358c`)

**Findings addressed:**
- **IMPORTANT** (self-referencing `calc.<id>` accepted): moved `idToIndex.set` / `idToGrain.set` registration in `lib/formula-set/validate.ts` to *after* each formula's own Validator 2 scan — a formula is no longer in the map when its own `condition`/`quantity` are checked, so `calc.<own-id>` is correctly reported as "forward reference or unknown formula id". Added comment explaining the intentional ordering. Added `self-referencing calc.<own-id> → rejected` unit test to `tests/unit/formula-set-validate.test.ts`.
- **MINOR #1** (`occurrences` defensive copy): `add()` first-store now deep-copies with `[...problem.occurrences]`; dedupe path already sliced — no change needed there.
- **MINOR #2** (`occurrenceCount` semantics): first store initialises to `problem.occurrenceCount ?? 1` (never `undefined`); dedupe accumulates `(existing.occurrenceCount ?? 1) + (problem.occurrenceCount ?? 1)` (caller pre-count honoured). JSDoc on `add()` states the contract explicitly.
- **MINOR #3** (sort tie-break / insertion order): no producer exists yet. Added a TODO comment in `report()` JSDoc citing this review, calling out that Batch 4/5 producers must walk the design in stored order, and recommending an explicit locus comparator when Batch 5 lands. Deferred code change per review recommendation.
- **MINOR #4** (`ProblemScope` not exported): `export` added.
- **MINOR #5** (`materialCode` grain-namespace skip): added an explanatory comment in `validate.ts` documenting that `materialCode` is plain substitution (not `expr-eval`), so a stale namespace token yields a literal code that surfaces as `UNRESOLVED_CODE` at runtime — intentionally out of scope per §6 ("expression references"). No code change.

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 4 errors / 9 warnings (same pre-existing baseline) | `npm run test:unit` → **142 pass / 0 fail / 0 skipped** (was 141; new self-reference test passes)

**Status:** DONE

---

### 2026-09-23 — developer — Batch 2 implement

**Role:** developer
**Branch:** `feature/s24-b2-types-validators` (pushed `55c00bf`)

**Files changed:**
- `lib/summary/types.ts` — tightened `FormulaSlot.requiredParams` to `Array<{key:string}>`; added `FormulaDef` interface (id/slot/grain/condition/materialCode/unit/quantity); added `schemaVersion?:1|2` to `FormulaSetBody`; changed `formulas?` from `unknown[]` to `FormulaDef[]`; added `MaterialListLine` (no status/detail — decision 10) and `MaterialByRoomEntry`; widened `SummaryResult.materialList` from `[]` to `MaterialListLine[]`
- `lib/materials/problems.ts` (NEW) — `CalculationProblemKind` (8 values per §8.3), `CalculationProblem`, `CalculationProblemReport`, `ProblemCollector` (add/hasAny/report; dedup on kind+code+selectionId+fieldKey; scope→kind sort; occurrences capped at 5; stays open after report()). Pure.
- `lib/formula-set/validate.ts` (NEW) — `validateFormulaSetBody()`; v1 passthrough (no formulas or `[]`, tolerates string-form requiredParams); v2: hygiene (slot exists, camelCase id, unique id, valid unit/grain, implemented grain, expr-eval parse, no cell.*/partition.* cross-namespace), Validator 1 (undeclared param.*), Validator 2 (forward/cross-grain calc.*). Every error names formula id and offending token. Pure.
- `tests/unit/formula-set-validate.test.ts` (NEW) — all acceptance cases including v1 regression (existing json validates)
- `tests/unit/materials-problems.test.ts` (NEW) — dedup, scope+kind sort, 5-occurrence cap, stays-open-after-report cases
- `tests/unit/formula-set-document.test.ts` — removed stale "expr-eval not installed" describe block + orphaned fs/path imports
- `package.json` / `package-lock.json` — added `expr-eval` as production dep

**Reused:** `node:test`/`node:assert/strict` pattern from `formula-set-document.test.ts`; v1 JSON from `prisma/formula-sets/glass-partition-standard-v1.json`; `keysReferencedBySet()` dual-shape tolerance from `lib/formula-compat.ts` (not touched)

**Decision:** `formula-set-document.test.ts`'s "expr-eval not installed" guard removed as a direct consequence of installing expr-eval — not a new decision, just a test that would have broken.

**Verify:** `npx tsc --noEmit` → 0 errors | `npm run lint` → 4 errors/9 warnings (all pre-existing baseline, no new) | `npm run test:unit` → 141 pass / 0 fail | `grep "MaterialLineStatus" lib/ app/` → only a JSDoc comment, no type definition | purity grep → comments only, no actual Prisma/lib-data imports in new pure files

**Status:** DONE

---

### 2026-09-23 — developer — Batch 2 plan phase

**Role:** developer
**Artifact:** `.engineering/stage-24/plan-b2.md`

Read: `profile.md` (stack/commands), `worklog.md` (Status block), `stage-24.md` §Batch 2 (files, steps, acceptance checklist, reviewer callouts), `formula-engine.md` §2/§6/§8.3 (FormulaSetBody, validators, CalculationProblem types and collector contract), `lib/summary/types.ts` (existing types — FormulaSetBody, FormulaSlot, SummaryResult shapes), `lib/formula-compat.ts` (keysReferencedBySet dual-shape tolerance, pattern to preserve), `tests/unit/formula-set-document.test.ts` (unit-test runner + fixture-import pattern), existing unit test list (test runner / assert module convention).

**Flags surfaced:**
- None (no new decisions, no deviations from spec). One noteworthy constraint explicitly stated in plan: `SummaryResult.materialList` widens from literal `[]` to `MaterialListLine[]` — must compile clean with `tsc --noEmit`; noted for reviewer.
- `keysReferencedBySet()` dual-shape runtime tolerance must be preserved when tightening the `requiredParams` type declaration; plan calls this out explicitly.

**Plan summary:** 6 items — `lib/summary/types.ts` extension (FormulaSetBody + FormulaDef + MaterialListLine + MaterialByRoomEntry), new `lib/materials/problems.ts` (CalculationProblemKind/CalculationProblem/CalculationProblemReport + ProblemCollector), new `lib/formula-set/validate.ts` (validateFormulaSetBody), two new unit test files, and `expr-eval` install via `package.json`.

**Status:** DONE (plan phase)

---

### 2026-09-23 — developer — Batch 1 fix round (review-1 CHANGES-NEEDED)

**Role:** developer  
**Files changed (app repo):**
- `lib/data/catalog.ts` — exported functions renamed: `listCatalogItems`→`listInventoryItems`, `getCatalogItemById`→`getInventoryItemById`, `assertCatalogItemInOrg`→`assertInventoryItemInOrg`; internal call site updated; error message updated
- `app/api/v1/orgs/[orgSlug]/catalog/route.ts` — import + JSDoc + console.error updated
- `app/api/v1/orgs/[orgSlug]/catalog/[itemId]/route.ts` — import + JSDoc + usage + console.error updated
- `app/api/v1/orgs/[orgSlug]/catalog/[itemId]/prices/route.ts` — JSDoc updated (`CatalogItem`→`InventoryItem`, `assertCatalogItemInOrg`→`assertInventoryItemInOrg`)
- `app/[orgSlug]/pricing/page.tsx` — `CatalogItemRow`→`InventoryItemRow`
- `app/[orgSlug]/pricing/[itemId]/page.tsx` — `CatalogItemDetail`→`InventoryItemDetail`, JSDoc updated
- `app/[orgSlug]/pricing/actions.ts` — JSDoc updated
- `prisma/seed.ts` — `catalogItemDefs`→`inventoryItemDefs`, `totalCatalogItems`→`totalInventoryItems`
- `prisma/schema.prisma` — model comment clarified: omit is Prisma client-only (raw SQL bypasses); removed "renamed from CatalogItem" wording to clean grep
- `lib/data/superadmin/orgs.ts` — removed "renamed from CatalogItem" comment wording to clean grep

**Files changed (docs repo):**
- `design-docs/sql-queries/debug-queries.sql` — 4 live `"CatalogItem"`/`"catalogItemId"` references updated to `"InventoryItem"`/`"inventoryItemId"`; `ci` alias → `ii`; `catalog_items` column → `inventory_items` (commit `43e8b60`)
- `design-docs/sql-queries/by-page.sql` — 8 function-pointer comment lines updated; `SELECT * FROM "ProjectCalculation"` annotated with global-omit note (MINOR fix)

**Reused:** same pattern as Batch 1 sweep; `tsc --noEmit` as guard

**Decisions:** none — mechanical sweep as directed

**Verify:** acceptance-checklist grep `grep -rn "CatalogItem\|catalogItemId\|unitOfMeasure" app/ lib/ prisma/ | grep -v migrations/ | grep -v app/generated/` → **0 hits** | `npx prisma generate` ✓ | `npx tsc --noEmit` ✓ (0 errors) | `npm run lint` ✓ (same 4 errors / 9 warnings, all pre-existing) | pushed `1ac1b6e` to `feature/s24-b1-inventory-rename`

**Status:** DONE

---

### 2026-09-23 — developer — Batch 1 implement

**Role:** developer  
**Files changed (app repo):**
- `prisma/migrations/20260923000001_inventory_items_and_material_by_room/migration.sql` — new hand-written migration (structural, no data)
- `prisma/schema.prisma` — `CatalogItem` → `InventoryItem`; `unitOfMeasure` → `measurementUnit`; `perUnitQuantity Decimal @default(1)` added; `@@index([organizationId, active])` added; `ItemPrice.catalogItemId` → `inventoryItemId`; `ProjectCalculation.materialByRoom Json @default("[]")` added
- `lib/prisma.ts` — global `omit: { projectCalculation: { materialByRoom: true } }` added to `PrismaClient` constructor
- `lib/data/catalog.ts` — all Prisma accessors (`catalogItem` → `inventoryItem`), unique key name, `deleteItemPrice` return key (`catalogItemId` → `inventoryItemId`)
- `lib/data/superadmin/orgs.ts` — `catalogItem.deleteMany` → `inventoryItem.deleteMany` in hard-delete cascade
- `prisma/seed.ts` — `catalogItem.upsert` → `inventoryItem.upsert`; `unitOfMeasure` → `measurementUnit`; `catalogItemId_currency` → `inventoryItemId_currency`; log labels updated
- `app/[orgSlug]/pricing/page.tsx` + `[itemId]/page.tsx` — `unitOfMeasure` → `measurementUnit` in TypeScript interfaces and render
- `app/api/v1/orgs/[orgSlug]/catalog/[itemId]/prices/route.ts` — destructure `inventoryItemId` from `deleteItemPrice`, return `{ inventoryItemId }`

**Files changed (docs repo):**
- `design-docs/sql-queries/by-page.sql` — all `CatalogItem`/`catalogItemId`/`unitOfMeasure` references updated to `InventoryItem`/`inventoryItemId`/`measurementUnit`; committed as `2a5e7d6` in docs repo

**Reused:** migration style from `20260921000001_add_formula_sets`; constraint names from `20260713190020_add_catalog_items`

**Verify:** `npx prisma generate` ✓ | `npx tsc --noEmit` ✓ (0 errors) | ESLint on changed files ✓ (exit 0) | Vercel preview `https://quotation-system-hanm6mzte-vistra-indias-projects.vercel.app` → READY | `/api/health` → `{"status":"ok","database":"connected"}` | `/api/v1/orgs/vistra/catalog` → 401 (route live, auth gate working)

**Note:** The dev DB migration is applied out-of-band by devops. The feature branch preview skips `migrate deploy` and runs against the dev DB (which does not have this migration applied yet), so the `/pricing` page will error until the migration is applied — this is expected for feature branch previews per the project convention. The `/api/health` check (which doesn't touch these tables) confirms the build is correct.

**Status:** DONE

---

### 2026-09-23 — developer — Batch 1 plan phase

**Role:** developer  
**Artifact:** `.engineering/stage-24/plan.md`

Read: `profile.md`, `worklog.md`, `stage-24.md` (Batch 1 section + Prerequisites + Gates + Decisions), `formula-engine.md` §7, `prisma/schema.prisma` (CatalogItem/ItemPrice/ProjectCalculation models), `lib/prisma.ts`, `lib/data/catalog.ts`, `20260921000001_add_formula_sets/migration.sql` (style reference), `20260713190020_add_catalog_items/migration.sql` (existing constraint names), grep sweep for all old-name references.

**Plan written to:** `.engineering/stage-24/plan.md`

**Flags surfaced:**
- D-1: `materialByRoom` omit in `lib/prisma.ts` (client-level) differs from `configSnapshot`'s query-level pattern — following explicit spec instruction, flagged for reviewer.
- D-2: `MaterialLineStatus` not present in codebase — no delete needed in Batch 1.
- D-3: Migration timestamp confirmed as `20260923000001_`.
- `deleteItemPrice` return key rename (`catalogItemId` → `inventoryItemId`) is a visible API change caught by `tsc --noEmit` — must fix in the same sweep.
- `by-page.sql` update included in Batch 1's deliverable (repo rule).

**Status:** DONE (plan phase)

---

### 2026-09-23 — devops — Dev DB migration (out-of-band, Batch 1)

**Role:** devops
**Target:** dev Neon DB — endpoint `ep-dark-term-ai0ufj4k` (confirmed via `DATABASE_URL_UNPOOLED` in `.env.local` before running)
**Command:** `npx prisma migrate deploy` with `DATABASE_URL` set to the unpooled value (per D-18 / `scripts/build.mjs` convention — pgbouncer breaks advisory lock)
**Migration applied:** `20260923000001_inventory_items_and_material_by_room`
**Prisma output:** "All migrations have been successfully applied." (26 migrations total; 1 pending at start)

**Verification (via direct Postgres queries against dev DB):**
- `InventoryItem` table exists; `CatalogItem` table gone
- `InventoryItem.measurementUnit` (text, NOT NULL) — confirmed
- `InventoryItem.perUnitQuantity` (numeric, NOT NULL, default 1) — confirmed
- `InventoryItem_organizationId_active_idx` composite index — confirmed
- `ItemPrice.inventoryItemId` (text) — confirmed; `catalogItemId` gone
- `ProjectCalculation.materialByRoom` (jsonb, NOT NULL, default `[]`) — confirmed

**Status:** DONE — dev DB is now on the current schema; feature-branch previews can exercise the affected routes.

---

### 2026-09-23 — reviewer — Batch 1 review round 1

**Role:** reviewer
**Verdict:** CHANGES-NEEDED
**Findings:** 0 CRITICAL · 2 IMPORTANT · 3 MINOR
**Report:** `.engineering/stage-24/review-1.md`

Verified locally: `npx prisma generate` ✓ | `npx tsc --noEmit` ✓ (0 errors) | `npm run lint` ✓ (no new
problems — all 4 errors/9 warnings pre-existing and outside the diff) | migration SQL reconciled
name-by-name against `20260713190020_add_catalog_items` and `schema.prisma` ✓ | no route/page path moved
(`--name-status` = 8×M + 1×A, zero R/D) ✓ | omit scoped to `materialByRoom` only ✓ | `deleteItemPrice`
caller updated ✓ | `MaterialLineStatus` absent ✓ | `perUnitQuantity` has zero read sites ✓.

IMPORTANT findings are both cheap and mechanical; engineering itself is clean.

**Status:** DONE (review round 1)

### 2026-09-23 — reviewer — Batch 1 review round 2 (fix round)

**Role:** reviewer
**Diff reviewed:** `47784a0..1ac1b6e` (app) + `43e8b60` (docs repo `main`)
**Verdict:** **APPROVE-WITH-NITS** — 0 CRITICAL, 0 IMPORTANT, 2 MINOR

All 5 round-1 findings resolved: 2 IMPORTANT fixed and independently re-verified (acceptance grep re-run,
docs commit read), 2 MINOR fixed, 1 MINOR deferred to Batch 5 with reasoning confirmed against the code.
`npx tsc --noEmit` 0 errors; `npm run lint` unchanged from baseline (4 errors / 9 warnings, all
pre-existing and outside the diff). Batch 1 is done.

**Report:** `.engineering/stage-24/review-2.md`

**Status:** DONE

---

---

### 2026-09-23 — reviewer — Batch 2 review (round 1)

**Role:** reviewer
**Verdict:** **CHANGES-NEEDED**
**Findings:** 0 CRITICAL · 1 IMPORTANT · 5 MINOR
**Report:** `.engineering/stage-24/review-b2-1.md`

Verified locally: `npx tsc --noEmit` clean; `npm run lint` at the 4-error/9-warning pre-existing baseline
(all 4 in `.engineering/stage-22/prod-recon-readonly.ts`, none in this diff); `npm run test:unit` 141/141
pass. The stage doc's five "Reviewer must check" items all confirmed (`materialCode` param extraction,
purity, v1 never rejected, errors name ids, collector never throws/short-circuits), plus
`grep MaterialLineStatus` → single JSDoc comment only, no declaration.

---

### 2026-09-23 — reviewer — Batch 2 review (round 2, fix round)

**Role:** reviewer
**Verdict:** **APPROVE-WITH-NITS**
**Findings:** 0 CRITICAL · 0 IMPORTANT · 2 MINOR (both new, both dev's discretion)
**Report:** `.engineering/stage-24/review-b2-2.md`

Round-1's blocking IMPORTANT (self-referencing `calc.<id>`) confirmed closed — traced the moved
registration and proved the new test fails on the pre-fix file and passes on the fixed one. All 5 MINORs
handled. `npx tsc --noEmit` clean; `npm run lint` at the pre-existing 4-error/9-warning baseline;
`npm run test:unit` 142/142 pass.

---

### 2026-09-23 — reviewer — Batch 4 review round 1

**Role:** reviewer
**Branch/commit reviewed:** `feature/s24-b4-evaluator` @ `4cc156a` (vs `release/stage-24` @ `9d03684`)
**Verdict:** **CHANGES-NEEDED**
**Findings:** 1 CRITICAL · 3 IMPORTANT · 4 MINOR
**Report:** `.engineering/stage-24/review-b4-1.md`

**Verified locally:** `npx tsc --noEmit` 0 errors · `npm run lint` 4 errors/9 warnings, all pre-existing
(none in `lib/materials/**`) · `npm run test:unit` **233/233 pass** — developer's claims confirmed.
door.md worked example and partition.md Scenario 1 (all 3 adjacency columns) recomputed by hand from the
formulas; all test assertions match. All 6 stage-24.md "Reviewer must check" items verified clean. FLAG 4
(`import type { RoomSide }`) accepted, no change.

---

### 2026-09-23 — developer — Batch 4 docs follow-through

**Role:** developer
**Repos:** `quotation-system-docs` @ `1fa1e6b` (main); `quotation-system` @ `10f0f9f` (feature/s24-b4-evaluator)

**What changed:**
- `design-docs/formulas/cloisons/door.md` — Engine Conventions: added amendment bullet on `expr-eval` logical operators (`or`/`and`/`not`, not `||`/`&&`/`!`) with the re-association example. Fixed `rubber25mm` condition `||` → `or`. No other `||`/`&&` in either cloisons formula doc.
- `design-docs/formulas/cloisons/partition.md` — added "Stated limitation — sections[] ordering" block before "Critical framing" paragraph, summarising the architect's finding: invariant not representable, damage bounded to one-end-door + partition-neighbour case.
- `design-docs/formula-engine.md` — §10 item 1: added cross-reference sentence to the new partition.md limitation.
- `backlog/backlog.md` — added High item (2026-09-23) for `reversed?: boolean` on `PartitionSide` + canvas flip control + end labels.
- `lib/materials/geometry.ts` — updated two ASSUMPTION comments (Steps 4 and 5) to cite `partition.md` instead of gitignored `plan-b4.md`. Comment-only, no logic change.

**Verify:** no tests affected; docs changes are additive notes on locked docs using the stage's "Amended" convention. Batch 4 fully closed.

---

### 2026-09-23 — architect — consult: `sections[]` order vs. the `sides[]` walk (review-b4-1 FLAG 2)

**Role:** architect
**Artifact:** `.engineering/stage-24/architect-b4-sections-order.md`

**Question put to me:** does the design canvas guarantee that a partition's stored `design.sections[]` is
ordered consistently along the room's `sides[]` walk direction? If not, fix by (a) normalizing at save time,
(b) making `geometry.ts` orientation-independent, or (c) accepting a documented limitation for the `cloisons`
launch?

**What I found (code read: `lib/partition-design.ts`, `lib/data/rooms.ts`, `app/[orgSlug]/projects/[projectId]/design/**`, `lib/materials/geometry.ts`):**
No guarantee — and stronger than "unenforced": **orientation is not representable in the data model at
all.** `PartitionDesignV2` has no anchor, side reference, or reversed flag; `parseSections` /
`assertSectionHeights` / `sumSectionWidths` are all orientation-insensitive; `seedSectionsDesign()` is
symmetric. `wall-canvas.tsx` renders `panels` as a flex row in array order, screen left-to-right
unconditionally, and is given no room/side/neighbour context — there is no flip control, no reorder action in
the reducer, and no end labels, so the user can neither express nor see orientation. Since the floor-plan
polygon walk runs right-to-left on screen for roughly half of a rectangle's sides, a user working from the
screen will systematically store mirrored designs on those sides — exactly the per-partition (not global)
mirror that changes results. `replaceSides()` can also invalidate a once-correct orientation later, because
it rebuilds the walk while partition designs stay put.

**Ruling — (c): accept as a documented limitation; ship `geometry.ts` as authored.** (a) is impossible (no
ground truth to normalize toward — a "normalizer" would be a coin flip dressed as a validator). (b) is
impossible in the general case: a partition's own end flags are already symmetric-safe because every
`partition.md` formula sums them, but the *pairing* with neighbours cannot be recovered, and the
corner-junction table is deliberately asymmetric (own door → `wallLike 0`; glass meeting a neighbour's door →
`wallLike 1`), so no symmetric function of the available data reproduces it. Blast radius when it bites:
`profileL`/`profileI` off by one `heightMm` and `lConnector` by 2, `degreeConnector` by 1, per mis-attributed
junction — only on a partition with a door at exactly one end and a partition neighbour.

**Required follow-through (not blocking Batch 4):** state the invariant in `partition.md` next to the
`partition.*` variable list and in `formula-engine.md §10.1`; repoint the `geometry.ts` ASSUMPTION comments at
`partition.md` rather than the gitignored `plan-b4.md`; open a **High** backlog item for the real fix —
`reversed?: boolean` on the `PartitionSide` element of `Room.sides` (not on `design`, because orientation is a
property of how the partition sits in the walk and `replaceSides()` is already the single owner of all sides
writes), plus a canvas flip control and end labels so the user can see and set it.

**Within the approved design?** Yes. (c) adds no scope, changes no code, and matches the stage's existing
"corner-junction model ships as authored, commercially unverified" posture. **Batch 4 is not blocked** — the
developer should proceed with the CRITICAL and two IMPORTANT fixes.

**To the human as information, not a gate:** a locked doc (`partition.md`) is gaining a stated limitation, and
the real fix is a Stage 18 data-model + design-canvas UI change needing its own slice. One domain question
sets its priority: in real `cloisons` rooms, how often are two partitions adjacent where one has a door at
exactly one end? Rare → backlog; common → scope the orientation flag into Stage 25.

**Status:** DONE (consult)

---

## reviewer — Batch 4 review round 2 (`feature/s24-b4-evaluator` @ `10f0f9f`)

**Verdict: CHANGES-NEEDED** — 0 CRITICAL, **1 IMPORTANT**, 4 MINOR. Report: `review-b4-2.md`.

All three round-1 IMPORTANTs verified genuinely fixed (expr-eval probe re-run independently; `onThrow`
traced through both CELL and PARTITION passes; `Number()` coercion replaced with a NaN fallback). The new
cross-slot `calc.*` validator does **not** break same-slot backward references. Docs commit
`quotation-system-docs` @ `1fa1e6b` checked and found honest/consistent with the code.
`tsc --noEmit` clean · `lint` 4 errors all pre-existing in gitignored scratch · `test:unit` **246/246**.

Blocker is one line: `problems.ts:72–74`'s dedupe key omits `formulaId`, so every PARTITION-grain
`NON_FINITE_QUANTITY` in a project collapses into a single reported problem naming only the first formula
(reproduced, not inferred). Pre-existing (Batch 2), but it blunts exactly the loud-failure behaviour round 1
bought. Fix here or record as a written Batch 5 acceptance item.

**Status:** DONE (review round 2)

---

## reviewer — Batch 4 review round 3 (`feature/s24-b4-evaluator` @ `bfe52ef`)

**Verdict: APPROVE-WITH-NITS** — 0 CRITICAL, 0 IMPORTANT, 1 MINOR. Report: `review-b4-3.md`.

Round-2's IMPORTANT (ProblemCollector dedupe key collapsing distinct PARTITION-grain problems) verified
fixed by re-running my own repro against the patched module: two distinct broken formulas now survive as
two problems, while the same formula at N loci still dedupes to one with `occurrenceCount: N`. The two new
`materials-problems` tests cover both sides and the first genuinely fails under the old key. Both round-2
MINORs taken are correct — the `validate.ts` cross-slot rationale re-derived from `evaluate.ts` and found
accurate, the PARTITION-grain `onThrow` test pins the partitionId locus that distinguishes it.
`tsc --noEmit` clean · `lint` identical to round 2 (4 errors, all pre-existing in gitignored scratch) ·
`test:unit` **252/252** (was 246). No scope creep in the diff.

Sole MINOR is a forward note for Batch 5: `formulaId` in the dedupe key will also split INVENTORY-scope
aggregate problems (`UNRESOLVED_CODE` et al.) per formula, contradicting their `occurrences[]` roll-up
design. No such producer exists yet — worth one line in the Batch 5 plan, blocks nothing here.

**Status:** DONE (review round 3) — Batch 4 approved.

---

### 2026-09-23 — reviewer — Batch 3 review round 1

**Role:** reviewer
**Reviewed:** `feature/s24-b3-cloisons-data` @ `c7c37b1` vs `release/stage-24`
**Verdict:** **APPROVE-WITH-NITS**
**Findings:** 0 CRITICAL · 0 IMPORTANT · 3 MINOR (+ 2 human-call open items carried forward: D-1
`perUnitQuantity` values, D-2 condition-gated `required: true` — both to settle before the prod runbook,
not before merge)
**Checks run:** `npx tsc --noEmit` clean · `npm run lint` no new errors (4 pre-existing, gitignored file)
· `npm run test:unit` 266/266
**Report:** `.engineering/stage-24/review-b3-1.md`

---

### 2026-09-23 — devops — Batch 3 dev DB seed

**Role:** devops
**Branch:** `feature/s24-b5-resolve-gate` (working tree contains all Batch 1–4 seed data; seed reads from working tree, not from a specific branch)
**Target DB:** `ep-dark-term-ai0ufj4k` (dev Neon, pooled endpoint) — confirmed via `.env` DATABASE_URL

**Command run:** `npx prisma db seed` (twice: once to apply, once for idempotency)

**Run 1 — full output (summarised):**
```
Organizations: 5
Permissions: 9
ComponentCategories: 12
ComponentTypes: 355
Seeding FormulaSets…
Organizations with activeFormulaSetId set: 5 / 5
cloisons InventoryItems: 22 seeded
cloisons.activeFormulaSetId → 9b323135-230c-4270-b985-7186843aa5da
InventoryItems + ItemPrices seeded for 5 orgs
Inventory items: 82 / Item prices: 120
```
No `validateFormulaSetBody()` abort. Exit 0.

**Run 2 (idempotency):** identical output, same counts, same UUIDs, exit 0.

**Verification queries (dev Neon):**
- `cloisons` InventoryItem count: **34** (12 standard + 22 cloisons-specific)
- `cloisons_formula_set` v1 row exists: id `9b323135-230c-4270-b985-7186843aa5da`
- `cloisons.activeFormulaSetId` → `9b323135-230c-4270-b985-7186843aa5da` ✓
- All other orgs (`acme-glass`, `clearline`, `nordic-walls`, `vistra`) → `glass-partition-standard` v1 — no collateral repoint ✓

**Result:** seed applied cleanly. Dev DB is now ready for Batch 5 preview verification.

---

### 2026-09-23 — reviewer — Batch 5 review round 1

**Role:** reviewer · **Verdict: CHANGES-NEEDED** · 0 CRITICAL / 3 IMPORTANT / 3 MINOR · report: `.engineering/stage-24/review-b5-1.md`
Live-verified on the branch preview (seeded `cloisons`): THE END GOAL passes (door numbers match `door.md` exactly); G-3 byte-identical-on-refusal confirmed; exactly-one-write-gate traced. Blockers: D-A throw makes a reachable blank-required-field / unslotted-type refusal a 500; the 422 body lost `error` (Design page message + `stage23-summary.spec.ts`); v1 `materialByRoom` is per-room empties, not `[]`.

### 2026-09-23 — reviewer — Batch 5 review round 2 (fix round `18fa457`)

**Role:** reviewer · **Verdict: APPROVE-WITH-NITS** · 0 CRITICAL / 0 IMPORTANT / 2 MINOR · report: `.engineering/stage-24/review-b5-2.md`
All 3 IMPORTANTs are fixed and were checked live on the `18fa457` preview: a blank `glassType` now returns 422 with a non-empty `error` instead of a 500, `stage23-summary.spec.ts` passes (4 passed, 3 SuperAdmin tests skipped), and a v1 `materialByRoom` read from the dev DB is `[]`. tsc is clean, lint shows only pre-existing errors, and unit tests pass 282/282 (9 removed and 9 added, so the count is unchanged). Minors: the FAILED→422 problem is always MISSING_PARAM with no locus (Stage 25 / backlog item), and one header comment is stale.

### 2026-09-23 — reviewer — Batch 6 review round 1

**Role:** reviewer · **Verdict: CHANGES-NEEDED** · 1 CRITICAL / 5 IMPORTANT / 8 MINOR · report: `.engineering/stage-24/review-b6-1.md`
tsc clean, 282/282 unit, lint shows the 4 baseline errors plus 1 new warning. The E2E spec is mostly sound, and both "bugs" the developer found (`{ project }` submit response, `{ items }` catalog key) are pre-existing `master` contracts, not Batch 5 gaps. The blockers are in the prod runbook and the proof strength of the spec: Step 4's `seed-inventory-cloisons.ts` does not exist and the 34-item end state is never stated; the D-1 gate sits after the merge and lists the wrong items at 3.0; Step 6's `lines = 22` STOP fires on a correct door-only submit; the rollback section wrongly calls Instant Rollback backward-compatible. In the spec, C2 does not actually check byte-identical G-3 and A1 never checks materialByRoom. The Execution Log leaves out the architect's `sections[]` ruling, and TECH_DESIGN says the stage is "promoted".

---

### 2026-09-23 — tester (engineering:test) — formal verification pass

**Role:** tester · **Verdict: PASS** · 0 CRITICAL / 0 MAJOR / 1 MINOR (pre-existing lint in gitignored `.engineering/stage-22` file) · report: `.engineering/stage-24/bugs-1.md`

Preview verified: `quotation-system-3hgn8gdct` (built from `release/stage-24` HEAD `d9f30e5`, confirmed by commit/deploy timestamp correlation). Health: `database: "connected"`. `tsc --noEmit` clean. `npm run test:unit` 282/282. `npx playwright test stage24-materials --workers=1` 17/17. Four tester-written exploratory gap probes (slot field, summary regression, materialByRoom omission, CELL_UNASSIGNED envelope) all passed. Static: no `CatalogItem`/`MaterialLineStatus` references, evaluator Prisma-free, `FAILED` status intercepted before any write. Stage 24 clear for promotion.
