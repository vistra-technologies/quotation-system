# Stage 20 — worklog

**Stage target:** `quotation-system-docs/development-cycles/stage-20.md`
**Profile:** `.engineering/stage-20/profile.md`
**Branch:** `release/stage-20` (cut from `staging` @ `e7d95d7`)

---

## Work items

| ID | Name | Depends on | Status |
|---|---|---|---|
| B1 | Schema + migration + DAL (ComponentTypeOrgConfig) | — | done (merged `a50ea05`) |
| B2 | SuperAdmin authoring (dependsOn UI + validator) | B1 | pending |
| B3 | Catalog org-admin screen | B1, B2 | pending |
| B4 | Configurator gating + cascading | B1, B3 | pending |
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
