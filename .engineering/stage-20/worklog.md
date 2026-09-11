# Stage 20 — worklog

**Stage target:** `quotation-system-docs/development-cycles/stage-20.md`
**Profile:** `.engineering/stage-20/profile.md`
**Branch:** `release/stage-20` (cut from `staging` @ `e7d95d7`)

---

## Work items

| ID | Name | Depends on | Status |
|---|---|---|---|
| B1 | Schema + migration + DAL (ComponentTypeOrgConfig) | — | done (merged `a50ea05`) |
| B2 | SuperAdmin authoring (dependsOn UI + validator) | B1 | done (merged `0462bff`) |
| B3 | Catalog org-admin screen | B1, B2 | done (merged `4c95532`) |
| B4 | Configurator gating + cascading | B1, B3 | done (merged `ea5b7f8`) |
| B5 | Bug sweep (B1–B5 video bugs) | — | done (merged `096f1a6`) |
| B6 | Docs + E2E | B1–B5 | pending |

---

## Activity log

- **2026-09-11 — reviewer — Batch 5 (video bug sweep B1–B5)** @ `feature/b5-video-bug-sweep` `d5d273c` —
  **CHANGES-NEEDED**: 0 CRITICAL / 2 IMPORTANT / 3 MINOR. The diff itself is correct (tsc + lint clean,
  B3's "zero raw `<select>`" grep re-verified independently, B5 leaves no dead prop plumbing); both
  blockers are verification gaps, not rework. Details: `.engineering/stage-20/review-B5.md`.
- **2026-09-12 — orchestrator — Batch 5, IMPORTANT findings resolved** — IMPORTANT #1 (B3 popup
  styling): read `components/select-field.tsx` directly — it's a native `<select>`, styled only on the
  closed trigger box; the open option list is OS-drawn in every browser for every `SelectField`
  instance app-wide, not something this fix changed or could change without swapping the underlying
  primitive (out of this stage's scope per decision #8's literal wording). Documented in `item-B5.md`.
  IMPORTANT #2 (no visual/functional evidence): accepted as deferred to `engineering:test` per
  CLAUDE.md §5 and the stage's Testing posture — the developer agent has no browser tool, so this
  evidence can only come from the tester phase; the per-bug checklist in `item-B5.md` hands that off.
  Routed the 3 MINOR items back to the developer.
- **2026-09-12 — developer — Batch 5 fix round** @ `feature/b5-video-bug-sweep` `854bbf6` — MINOR #3/#4:
  extended the B2 fix to `create-project-form.tsx`/`edit-project-form.tsx` (currency select *and* the
  company-auto-switches-currency path), deduped all 4 forms' reformat logic into one
  `reformatBudget(currency?)` helper per file. MINOR #5: stale unit-toggle comment in
  `convert-side-form.tsx` corrected. Verified by orchestrator diff read (not a full reviewer pass —
  scope was pure minor cleanup). **Merging to `release/stage-20`.**
- **2026-09-12 — reviewer — Batch 1 (schema + migration + DAL, `ComponentTypeOrgConfig`)** @
  `feature/b1-component-type-org-config` `371d579` (+ docs `188da61`) — **CHANGES-NEEDED**:
  1 CRITICAL / 2 IMPORTANT / 5 MINOR. Migration + backfill verified correct against the dev Neon
  branch (no `options` left anywhere, 58 config rows, no org mismatch, nothing lost); all four
  `FieldEntry` copies found and updated; cascade ordering FK-safe; `tsc` + `lint` clean. CRITICAL is
  a second-order effect not self-flagged: the new `ON DELETE RESTRICT` FK makes the Stage 19
  SuperAdmin delete-ComponentType route 500 for any type with a config row (reproduced against the
  DB). Details: `.engineering/stage-20/review-B1.md`.
- **2026-09-12 — developer — Batch 1 fix round** @ `feature/b1-component-type-org-config` `6e6ca32` —
  CRITICAL fixed: `deleteComponentTypeForOrg` now wraps config-then-type delete in
  `prisma.$transaction`. IMPORTANT #2 fixed: `seed.ts`'s config upsert is now create-only
  (`update: {}`), never clobbers org-authored values. MINOR #6 fixed: cascade filter now matches
  the file's belt-and-braces `OR` convention. IMPORTANT #3 and MINOR #4/#5/#7/#8 documented/deferred
  in `item-B1.md` per reviewer's own discretion call. `tsc`/`lint` clean.
- **2026-09-12 — orchestrator** — verified the fix commit directly (small, targeted diff — all three
  fixes match the reviewer's exact suggestions). **Merged to `release/stage-20`** @ `a50ea05`.
  Batch 1 done. **Known accepted state:** Configuration-page dropdowns and the SuperAdmin JSON editor
  are degraded (empty options / hard-reject on save) on every environment sharing the dev Neon branch
  — including `test.easeetool.com` — until Batch 2 (validator rewrite) and Batch 4 (configurator
  gating) ship. Not a new bug if seen during interim checks.
- **2026-09-12 — developer — Batch 2 (SuperAdmin authoring: dependsOn UI + validator)** @
  `feature/b2-superadmin-dependson-authoring` `64fe1e4` — new `lib/validate-fields-schema.ts` (rejects
  `options` outright, enforces earlier-field + dropdown/radio-only `dependsOn`), wired into both
  SuperAdmin API routes (POST/PATCH); removed `OptionsBuilder`/options-value UI from both
  create/edit forms, added a "Depends on" select scoped to earlier dropdown/radio fields; JSON-mode
  validator rewritten to match; reorder guard blocks (not auto-clears) a move that would invalidate an
  existing `dependsOn`, with an inline warning (developer's call, documented in `item-B2-plan.md`).
  Updated 2 existing E2E tests that directly tested the pre-Stage-20 options-persist behavior (now
  assert 400) and added 3 new dependsOn round-trip/rejection tests. `tsc`/`lint` clean (regenerated
  the local Prisma client first — Batch 1's schema change predates this worktree's gitignored
  generated client). Branch pushed; **no Vercel MCP/CLI tool available this session** to poll the
  preview or run the pushed Playwright tests against it — flagged as a concern in `item-B2.md` for
  the reviewer/tester to verify on the preview directly. Status: DONE_WITH_CONCERNS.
- **2026-09-12 — reviewer — Batch 2 review** @ `feature/b2-superadmin-dependson-authoring` `64fe1e4` —
  verdict **CHANGES-NEEDED**: 0 CRITICAL, 1 IMPORTANT, 4 MINOR. Ran the spec against the batch's own
  Vercel preview (`quotation-system-p7h7dnxqv`): **13/13 passed in 29.4s**, including all 5
  new/rewritten options-rejection + dependsOn tests; `tsc`/`lint` re-verified clean. Validator logic
  is correct (earlier-only, choice-type-only both ends, self/forward/cycle impossible — probed live),
  wired and firing on **both** POST and PATCH, and JSON-mode routes through it so paste can't bypass.
  The two rewritten E2E tests are a legitimate inversion, not a weakened test (old Test 5 asserted
  `[201,400,500]` — vacuous). IMPORTANT: deleting/retyping/renaming a parent field leaves a stale,
  UI-invisible `dependsOn` on its children → save throws to the page error boundary and loses the
  edit (reorder was guarded, these three paths weren't). MINORs: `[null]` entry → 500 not 400;
  no duplicate-key check (`findIndex` first-match, matters for Batch 3's `fieldOptionsConfig` keying);
  orphaned `fieldOptions`/`addOption` i18n keys; no PATCH-path E2E (verified by hand instead).
  Details: `.engineering/stage-20/review-B2.md`.
- **2026-09-12 — developer — Batch 2 review fix round** @
  `feature/b2-superadmin-dependson-authoring` — IMPORTANT #1 fixed via the reviewer's "cleaner" option:
  new `clearDependentsOf(fields, key)` helper in `lib/validate-fields-schema.ts`, wired into a new
  `handleRemove`/`handleFieldChange` pair in **both** create/edit forms' `SectionEditor` — clears a
  child's `dependsOn` when its parent row is removed, retyped away from dropdown/radio, or renamed.
  MINOR #2 fixed: malformed (non-object/null) `fieldsSchema` entries now return a normal 400 instead of
  throwing. MINOR #3 fixed: duplicate `key`s across a schema are now rejected (one `Set` pass before the
  main validation loop). MINOR #4 deferred to Batch 6 per the reviewer's own suggestion (the whole
  `componentTypes` i18n block is pre-existing dead weight, not something to partially clean here). MINOR
  #5 fixed (not deferred): added 2 PATCH-path E2E tests + 1 duplicate-key POST test.
  `tsc`/`lint` clean. Pushed. No Vercel/browser tool available this session — orchestrator to verify
  live on the next preview. Status: DONE_WITH_CONCERNS. Details: `item-B2.md` §Review fix round.
- **2026-09-12 — orchestrator** — verified the fix-round diff directly (matches reviewer's exact
  suggestions) and ran the full E2E suite against the fix commit's own preview
  (`quotation-system-4fmyle2fb...`): **16/16 passed**. Additionally reproduced IMPORTANT #1's exact
  repro live via Playwright: created a throwaway type with dropdown `category` → dropdown `glassType`
  depending on it, removed the `category` row (confirmed `glassType`'s "Depends on" immediately showed
  "None" with no stale option, not just visually masked), clicked Save — **no crash, saved cleanly**.
  Deleted the throwaway type afterward with no error (re-exercising Batch 1's delete-cascade fix in
  passing). **Merged to `release/stage-20`.** Batch 2 done.
- **2026-09-12 — developer — Batch 3 (Catalog org-admin screen)** @
  `feature/b3-catalog-org-admin-screen` `c7a79b5` — new page
  `app/[orgSlug]/admin/field-values/page.tsx` + `catalog-type-editor.tsx` (chip-style value-list
  editor for flat fields, one row per live parent value for dependent fields with a read-only
  "depends on X" badge), new `GET`/`PUT` API at
  `.../component-types/[typeId]/field-values` (auth/tenancy preamble copied from the sibling
  `component-types/[typeId]` route), new `lib/validate-field-options-config.ts` (rejects unknown
  keys, non-choice-field keys, wrong shape for dependsOn-ness, and any explicit `dependsOn` in the
  payload), new `setComponentTypeOrgConfig` DAL fn, new `lib/types/field-options-config.ts`
  (extracted so org-scoped pages can use the type without violating the `lib/data/*` import ban —
  same pattern as `lib/types/field-entry.ts`). Sidebar gained a `canManageFeatures` prop and a
  "Catalog" flyout link independent of `canManageUsers`. Decision: kept the shared
  `component-types` list route untouched (Batch 4's job) — Catalog page does one extra GET per
  configurable type instead, documented in `item-B3-plan.md`. Added
  `tests/e2e/catalog-field-values.spec.ts` (Tier-1 API tests: cross-org tenancy on GET+PUT,
  cross-tenant 403, 403-without-MANAGE_FEATURES on both API and page, PUT validation rejections,
  happy-path round-trip). Reconciled `regression-checklist.md` #22 and B1's forward-documented
  `by-page.sql` entries. `tsc`/`lint` clean. Branch pushed; **no Vercel MCP/CLI or browser tool
  available this session** to poll the preview or run the pushed spec against it — flagged in
  `item-B3.md` for the reviewer/tester. Status: DONE_WITH_CONCERNS.
- **2026-09-12 — reviewer — Batch 3 review** @ `feature/b3-catalog-org-admin-screen` `c7a79b5` —
  verdict **CHANGES-NEEDED**: 1 CRITICAL / 0 IMPORTANT / 4 MINOR. Ran the new spec against the
  batch's own preview (`quotation-system-3chx4t4kn`): **8/8 passed in 21.2s**; `tsc`/`lint`
  re-verified clean. Tenancy, RBAC (`MANAGE_FEATURES` on GET + PUT + page) and `dependsOn`
  immutability all confirmed **live**, including an extra hand-run bypass probe the spec doesn't
  cover (org A's session on org A's own URL + org B's `typeId` → 404, org B's config untouched).
  CRITICAL: the editor reads a dependent field's parent values from `flatOptions` only, so any
  **multi-hop** chain (the design doc's own Category → Glass Type → Thickness) is unconfigurable —
  and an untouched Save writes `{valueMap:{}}` over the deepest level's existing data. Reproduced
  end-to-end on the preview. Details: `.engineering/stage-20/review-B3.md`.
- **2026-09-12 — developer — Batch 3 review fix round** @
  `feature/b3-catalog-org-admin-screen` — CRITICAL #1 fixed exactly as suggested: new
  `liveValuesOf(key)` helper in `catalog-type-editor.tsx` resolves a dependent parent's live
  values as the union of its own `valueMaps` branches (not just `flatOptions`), replacing both the
  save-time prune and the two render-path lookups that previously only worked for a flat parent —
  multi-hop chains (Category → Glass Type → Thickness) now render and save correctly. Added the
  requested belt-and-braces guard: a save with zero resolvable live parent values carries the
  field's entry forward from `initialFieldOptionsConfig` instead of writing `{valueMap:{}}}`, so an
  unanticipated edge case can never silently wipe stored config. MINOR #2 also fixed (cheap,
  reviewer left it optional): `lib/validate-field-options-config.ts` now cross-checks that every
  `valueMap` key names one of the parent's currently-submitted values, when the parent's own entry
  is present in the same payload. Added `tests/e2e/catalog-field-values.spec.ts` Test 7 — a fresh
  2-hop-chain throwaway ComponentType, PUT a full chain via the API, GET it back, assert every
  level (including the deepest, previously-wiped one) round-trips intact. MINOR #3/#4 left open
  per the reviewer's explicit instruction (Batch 4's job); MINOR #5 (E2E leaks a throwaway type)
  not addressed — developer's discretion, reviewer flagged it optional. `tsc`/`lint` clean. Pushed.
  No Vercel/browser tool available this session — orchestrator to verify live on the next preview.
  Status: DONE_WITH_CONCERNS. Details: `item-B3.md` §Review fix round.
- **2026-09-12 — orchestrator** — verified the fix-round diff directly (both fixes match the
  reviewer's exact suggestions, generalize correctly to N-hop chains via `Object.values(...).flat()`
  union) and ran the full E2E suite against the fix commit's own preview
  (`quotation-system-rbm8npxhr...`): **9/9 passed**, including the new 2-hop round-trip test that
  faithfully reproduces the reviewer's exact live repro (Category → Glass Type → Thickness,
  untouched Save no longer wipes Thickness's `valueMap`). **Merged to `release/stage-20`.**
  Batch 3 done.
- **2026-09-12 -- developer -- Batch 4 (Configurator gating + cascading)** @
  `feature/b4-configurator-gating-cascading` `217b577` (+ docs `66a1a84`) -- new
  `lib/configurator-gating.ts` (pure): `isComponentTypeFullyConfigured` (whole-type gate,
  multi-hop-safe, decision #5), `resolveOptions` (named per the stage doc -- live cascading
  resolution off the form's currently-selected parent value), `collectDescendants`
  (descendant-key lookup for clearing stale values on parent change). Closed both MINORs
  left open by review-B3: MINOR #3 -- folded `orgConfig` into `listComponentTypes`/
  `getComponentTypeById`, deleted the dead `...WithConfig` pair, updated the field-values
  route's 3 call sites; MINOR #4 -- Catalog admin page's 1+N fetch is now one call (list
  route returns `fieldOptionsConfig` for free). `add-selection-form.tsx`: palette tiles
  grey out + tooltip for any unconfigured ComponentType, configure form never opens for
  one (edit mode of an already-saved Selection is the one documented exception -- decision
  #5 targets the "Add Component" palette, not stranding existing data), dropdown/radio
  fields resolve options live via `resolveOptions`, changing a field clears its
  descendants. Added a server-side backstop: `lib/data/selections.ts` `createSelection`
  now rejects (400) a Selection against an unconfigured ComponentType, closing the stage
  doc's explicit "API-level, not just UI greying" test requirement. New
  `tests/e2e/configurator-gating.spec.ts`: 14 pure-logic tests for the three gating
  helpers (2-hop chain, verified passing locally with no server touched -- no unit-test
  runner exists in this repo, so these are Playwright `test()`/`expect()` blocks that
  request neither `page` nor `request`) plus 2 API-level tests (unconfigured type -> 400,
  then configured via the Catalog PUT -> 201). `tsc`/lint clean. Docs: `by-page.sql`
  reconciled (both `listComponentTypes`/`getComponentTypeById` query blocks now show the
  `ComponentTypeOrgConfig` LEFT JOIN; stale WithConfig-only block replaced with a
  pointer). Branch + docs pushed; **no Vercel MCP/CLI or browser tool available this
  session** -- flagged in `item-B4.md` for the reviewer/tester, specifically to re-run
  `catalog-field-values.spec.ts`/`stage18.spec.ts`/`stage19.spec.ts`/
  `subdomain-navigation.spec.ts` against the preview (they create Selections against
  `componentTypes[0]`, alphabetically DOOR, which Batch 1 fully backfilled -- should be
  unaffected by the new gate but unverified live this session) and to eyeball the
  multi-hop cascading UX manually. Status: DONE_WITH_CONCERNS.

- **reviewer — Batch 4 (Configurator gating + cascading), `db631f5`: APPROVE-WITH-NITS.**
  0 CRITICAL / 0 IMPORTANT / 3 MINOR. Report: `review-B4.md`. The regression risk the
  developer flagged is **resolved and is not a regression** -- verified live on the preview
  (`quotation-system-nceda3vzd`), not by re-reading the migration: DOOR is `componentTypes[0]`
  on acme-glass *and* reads fully configured post-backfill. Ran `configurator-gating.spec.ts`
  16/16 (including both API-level tests the developer left unrun), `catalog-field-values` +
  `subdomain-navigation` 21/21, `stage18` 10/10, `stage19` 6/6 -- the three tests that POST a
  Selection against `componentTypes[0]` all pass. One `stage19` step-gating failure proven
  **pre-existing** (fails 3/3 on the Batch-3 preview, untouched code path) and logged as MINOR
  #3 for the test phase. `isComponentTypeFullyConfigured` does **not** repeat Batch 3's
  multi-hop bug -- it accumulates a per-field resolved-value map instead of a roots-only map;
  independently re-implemented and run over acme-glass's 308 live types, agreeing exactly with
  the 13 greyed tiles rendered on the Configuration page. B3 MINOR #3 (DAL convergence, zero
  dangling `WithConfig` refs) and MINOR #4 (N+1 gone, Catalog page renders 200 with real chip
  values) both genuinely closed. Decision #6 respected -- only value lists narrow, no field
  visibility is conditional. Nits: E2E spec leaks a throwaway type/project per run;
  `collectDescendants` lacks a cycle guard; the pre-existing stage19 step-gating flake.

- **orchestrator** — noticed `release/stage-20`'s own build (`f3f40a0`, the Batch 3 merge)
  errored on the shared dev Neon branch with `P1002` (advisory-lock timeout) — the known
  transient failure documented in `profile.md`, not a real regression (B3's fix-round and B4's
  own builds succeeded on the same code). Retriggered with an empty commit (`114e6f8`).
  **Merged Batch 4 to `release/stage-20`.** All of Item 1 (Batches 1–4) and Item 2 (Batch 5)
  are now done. Remaining: **Batch 6 (docs + E2E reconciliation)**, plus routing the
  pre-existing stage19 step-gating flake to the human/`engineering:test` — not this stage's
  bug to fix, but worth flagging before sign-off.
- **2026-09-12 — developer — Batch 6 (docs reconciliation)** @ `feature/b6-docs-reconciliation`
  — docs-only, no app-code changes. Audited every `ComponentTypeOrgConfig` block in
  `quotation-system-docs/design-docs/sql-queries/by-page.sql` against the shipped
  `lib/data/components.ts`, `lib/data/selections.ts`, and the `field-values/route.ts` handlers —
  found Batch 4 (`66a1a84`) had already fully reconciled it, no corrections needed. Flipped
  `04-data-model.md`'s `ComponentTypeOrgConfig` section from 📝 Spec'd to ✅ Built and updated two
  stale future-tense passages to past tense; confirmed the `dependsOn`-on-`fieldsSchema` prose
  already matches the second 2026-09-11 decision. Added a 2026-09-12 changelog entry in
  `08-decisions-and-changelog.md` summarizing Stage 20's completion (Item 1 +  the 5-item bug
  sweep). Confirmed via grep no live reference to the deleted
  `listComponentTypesWithConfig`/`getComponentTypeByIdWithConfig` pair survives anywhere in the
  app (only a historical comment). Spot-checked `regression-checklist.md` #22 — reads sensibly,
  untouched. Details: `item-B6.md`. Status: DONE. **Stage 20 implement phase complete pending
  orchestrator merge of this batch.**
