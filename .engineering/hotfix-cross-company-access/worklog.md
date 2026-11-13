# Worklog — Hotfix 2026-10-05 cross-company access

## Status
- Phase: implement complete (H1+H2+H3 review-clean, merged into hotfix/cross-company-access) -> live regression on branch preview
- Worktree: D:/projects/vistra/quotation-system/.worktrees/hotfix-cross-company-access (needs `npm ci` + `npx prisma generate`, copy .env* + .env.playwright.local per profile.md)
- Target spec: D:/projects/vistra/quotation-system-docs/development-cycles/stage-28/hotfix-2026-10-05-cross-company-access/hotfix-2026-10-05-cross-company-access.md (human approved scope at Gate 0, 2026-10-05)
- Active work item: live regression gate on branch preview alias
- Latest artifacts: review-1.md, review-2.md (docs commit 09aa377 on docs/hotfix-cross-company-access)
- Open gates: live `npm run test:regression` on branch preview alias (dev), then on test.easeetool.com after staging merge; human approval before master.

## Activity log
- developer · 2026-10-08 · SETUP+PLAN done (no product code). Worktree npm ci + prisma generate OK, .env* copied. tsc baseline 1 pre-existing error (tests/e2e/hotfix-2026-09-27-round4.spec.ts:156 hasValue). Spec claims verified (2 SessionData builders, single callers, listProjects/listInquiries unused). No blocking deviations; notes in plan.md. Status: DONE. Plan: .engineering/hotfix-cross-company-access/plan.md
- developer · 2026-10-08 · H1 BUILT on feature/cca-h1-ownership-projects-inquiries (pushed; commits e89aacd code, 6a2466b tests). Added isExternal to SessionData (session.ts, api-auth.ts: one role.findFirst each), new lib/data/ownership.ts, applied in projects/inquiries/stats/calculations/config-update DAL; deleted unused listProjects/listInquiries; POST projects/inquiries -> 403 via NO_COMPANY code. Regression: projects.spec + inquiries.spec pins flipped to 404 (+ghost-body equality, member baseline); new fail-closed orphan test in projects.spec. Verify: tsc = baseline 1 error only; lint 0 errors. NOT run: live regression/preview check (gated to end of H2). Flags: (1) third SessionData builder found: app/api/v1/permissions/route.ts (plan said 2) - set isExternal: true (fail-closed, only feeds MANAGE_FEATURES check). (2) reviewer grep still hits `externalCompanyId === null` in ownership.ts and the two create guards (isExternal && company null = unlinked check, not a role decision) + pre-existing users.ts:180 (U3). Status: DONE_WITH_CONCERNS.
- reviewer · 2026-10-08 · H1 review R1: CHANGES-NEEDED (0 CRITICAL / 1 IMPORTANT / 2 MINOR). Product code correct on every must-check; IMPORTANT is a test bug (fail-closed stats toEqual misses ordersTotal:0). Report: .engineering/hotfix-cross-company-access/review-1.md
- developer · 2026-10-08 · H1 FIX R1 done. IMPORTANT fixed (ordersTotal: 0 in projects.spec fail-closed stats); MINOR 1 fixed (inquiry test re-reads as admin, name unchanged); MINOR 2 -> backlog row (Low, 2026-10-08) in docs repo, uncommitted there, no page changes. lint clean, tsc baseline 1 error only. Not run live. DONE.
- developer · 2026-10-08 · H2 BUILT on feature/cca-h2-design-tree-selections (pushed; f440925 code, 4ed9c01 tests). floors/rooms/partitions/selections DAL: HF-3 nested filters via ownedProjectWhere on every read/write (incl. renameFloor/deleteFloor/listRoomsByFloor/getRoomById/renameRoom/deleteRoom/replaceSides/updatePartition/listSelections/createSelection/updateSelection/deleteSelection); createFloorIfNotExists checks parent project inside the tx before find-or-create (returns null -> floors route 400 same as ghost); createRoom/reorderRooms floor check; HF-5 signatures changed + 3 routes. config-update already done in H1. Pins flipped (design-tree, selections, pages) as compare-to-GHOST-response tests + owner-side unchanged check; pages pin asserts "Page not found" heading on project detail/edit/design/summary + inquiry detail/edit (no status assert: loading.tsx streams). DEVIATION (small): 12 existing tests used as.distributor/architect on admin-created internal projects (design-tree L246-518, selections L97/130/217) - would now 404; switched actor to as.member (external-own-company path still covered by the "own company" tests). Verify: tsc = baseline 1; eslint clean; test:regression:coverage OK ("every route and page has a regression test"). NOT run live (gated). Pages: inquiry detail+edit map !res.ok -> notFound(); project layout + edit map no project -> notFound(); no page change. Repo grep prisma/tx.{floor,room,partition,selection,project,inquiry}.* outside the 6 owned modules: only calculations.ts loaders (HF-6, after owned read), config-update.ts child queries (after owned project read, same tx), stats.ts (H1 helper), superadmin/orgs.ts + component-types.ts (SuperAdmin, org-wide by design), users.ts:277-278 counts by createdByUserId (admin delete-user guard). No unscoped hits. Status: DONE_WITH_CONCERNS.
- reviewer · 2026-10-08 · H2 review R2: APPROVE-WITH-NITS (0 CRITICAL / 0 IMPORTANT / 2 MINOR). All 19 H2 audit fns scoped per HF-3, parity foreign==ghost confirmed per route, no missed path in own grep; actor-switch deviation justified. Minors: re-add external own-company positive reads (lists/getById/rename/reorder) to the own-company tree test; floors.ts comment says 404, route returns 400. tsc = baseline. Report: .engineering/hotfix-cross-company-access/review-2.md
- developer · 2026-10-08 · H3 (docs) DONE. Docs repo branch docs/hotfix-cross-company-access, commit 09aa377 (not pushed, not on master). by-page.sql: [OWNED] legend + role.findFirst (isExternal) + ownership shapes on projects/inquiries/stats/calc/config-update/floors/rooms/partitions/selections/delete/reset; deleted listInquiries noted. Backlog High -> Resolved (fixed on branch, pending promotion); Low 2026-10-08 row kept. README tracker + 08 changelog -> built, awaiting test/staging/approval. Spec: status, Execution Log, deviations D-1..D-4; live regression NOT run. Note: commit also carries pre-existing uncommitted Stage 29/30/31 rows in README/08/backlog (same files). H2 nit-fix not yet committed in worktree (floors.ts, design-tree.spec.ts modified) at time of writing.

### developer · 2026-10-08 · H2 nit-fix (review-2)
- design-tree.spec.ts "any org member builds the tree": added positive owner assertions (floors/rooms/partitions lists, GET partitions/:id, floor rename, room reorder + order check) for distributor+architect; floors.ts comments now say route -> 400. eslint clean, tsc baseline only, test:regression:coverage OK. Live regression not run (gated). Status: DONE, commit 60afb5e

- **tester · 2026-10-09 · FAIL** — live regression on branch alias (60afb5e): 940 pass / 53 fail / 0 skip; cleanup clean. 0 CRITICAL / 2 MAJOR (4 stale regression scripts, D-1 class; 49 preview-only `fetch/HEAD ERR_ABORTED` UI failures, baseline test.easeetool.com pages run clean) / 1 MINOR. Fix intent verified, no leak. See bugs-1.md.

- **developer · 2026-10-09 · M1 fix DONE** — branch `feature/cca-fix-1-regression-tests` off `hotfix/cross-company-access`, commit `10a8ada`. [SUPERSEDED by R3 fix below] Changed: `tests/regression/api/inquiries.spec.ts` (convert test: replace throwaway `f.externalCompany()` with `distributorCompanyId({run,as})` so the inquiry belongs to the architect's own company; all assertions preserved incl. `createdByUserId: run.users.architect.id`), `tests/regression/api/projects.spec.ts` (3 tests: `:150` `as.architect` → `as.member` for GET; `:381` `as.architect`/`as.distributor` → `as.member` for submit-design POST and calculation GET; `:491` `as.distributor` → `as.member` for reset POST). Finding 3 (m1): added Low/2026-10-09 backlog row to `quotation-system-docs/backlog/backlog.md` (docs repo commit `fb6fbed` on `docs/hotfix-cross-company-access`). Finding 2 (M2/49 ERR_ABORTED): not touched (out of scope). Verify: lint 0 errors, tsc = baseline (1 pre-existing), coverage map OK; live run on branch preview `dpl_7C5VKCdZHomQCkd2DzFTxD7CuAsE` (`https://quotation-system-git-feature-cca-3fae05-vistra-indias-projects.vercel.app`): **130 passed / 0 failed / 0 skipped**, cleanup 69/69, delta 0. Status: DONE.

- **reviewer · 2026-10-09 · fix-1 review R3: CHANGES-NEEDED** (0 CRITICAL / 1 IMPORTANT / 1 MINOR). Assertions not loosened, no product change, backlog row accurate; IMPORTANT: convert test's `companyProjectNumber: 1` is non-deterministic now that it shares the distributor/architect company. Report: .engineering/hotfix-cross-company-access/review-3.md

- **developer · 2026-10-09 · R3 fix DONE** — commit `3f1aa1b` on `feature/cca-fix-1-regression-tests`. [SUPERSEDED by R4 nit below] I1: inquiries.spec.ts convert test — query `as.distributor.get('/projects?pageSize=100')` (company-scoped) before convert to get `maxPriorNumber`; assert `companyProjectNumber: maxPriorNumber + 1` instead of hardcoded `1`; also removed newly-unused `f` from test signature (lint had flagged it). M1: projects.spec.ts — added new test "external user reads their own company's project by id → 200 with configSnapshot" using `as.distributor` creating via `createLedgered` then GETting by id; restores external-role GET /projects/:id positive coverage. Verify: lint 0 errors (9 pre-existing warnings), tsc = baseline (1 pre-existing), coverage OK; live run on `dpl_CcPmWZqXRft6pEdJVbXHmReu2aK4` (alias `https://quotation-system-git-feature-cca-3fae05-vistra-indias-projects.vercel.app`): **316 passed / 0 failed / 0 skipped** (design-tree 138, inquiries 45, projects 86, selections 47, parallel 3 workers), cleanup 110/110, delta 0. Status: DONE.

- reviewer · R4 (cca-fix-1, commit 3f1aa1b) · APPROVE-WITH-NITS · 0 critical / 0 important / 1 minor (max+1 numbering race window; optional > assertion) · see review-4.md

- **developer · 2026-10-09 · R4 nit + merge DONE** — commit `4edf640` on `feature/cca-fix-1-regression-tests`: dropped `companyProjectNumber` from `toMatchObject`; asserted separately as `typeof === "number"` + `toBeGreaterThan(maxPriorNumber)`. lint 0 errors, tsc = baseline, coverage OK. Merged feature/cca-fix-1-regression-tests → hotfix/cross-company-access via no-ff merge commit `483b18f`; pushed hotfix branch. Vercel preview READY: deployment `dpl_28Y5iGHmGJgKg62Vbyf9NfCt2Fix` URL `https://quotation-system-cavwsoc74-vistra-indias-projects.vercel.app`; hotfix branch alias `https://quotation-system-git-hotfix-cross-938b2b-vistra-indias-projects.vercel.app` (health 200). HEAD SHA `483b18f`. Status: DONE.
- tester · re-test (bugs-2.md) · FAIL (suite red; only the known Finding-2 set) · 0 CRITICAL / 0 MAJOR new (Finding 1 fixed; 46 preview-env UI/J1-J5 failures carried) / 1 MINOR carried · 946 pass / 48 fail / 0 skip, cleanup clean · bugs-2.md

## Staging merge — 2026-10-09

- devops · 2026-10-09 · Merged hotfix/cross-company-access (HEAD 483b18f) → staging via fast-forward push (`git push origin hotfix/cross-company-access:staging`). staging was a direct ancestor (8b83fe2); nothing on staging that the hotfix lacked.
  - Deployment: dpl_FaxvfP7j8dkmH8EDzQi5rfCtUxB1
  - State: READY (build time ~62 s)
  - SHA on staging: 483b18fc43cd618a1dd51825206ffcaf13d8469f
  - Health check: https://test.easeetool.com/api/health → 200 {"status":"ok","database":"connected"}
  - test.easeetool.com alias: auto-followed (branch-pinned in Vercel; confirmed in deployment alias list)
  - Route list (build log): all expected routes present — /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert, /api/v1/orgs/[orgSlug]/projects/[projectId]/reset, /api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design, /api/v1/orgs/[orgSlug]/floors, /api/v1/orgs/[orgSlug]/rooms, /api/v1/orgs/[orgSlug]/partitions, /api/v1/orgs/[orgSlug]/selections confirmed present.
  - Migrations: none pending (hotfix is code-only)
  - docs/hotfix-cross-company-access branch: NOT merged (per task spec; left as-is)
  - master: NOT touched

- **tester · 2026-10-09 · PASS** — formal test on test.easeetool.com @ 483b18f (staging dpl_FaxvfP7j8dkmH8EDzQi5rfCtUxB1): lint 0 errors, tsc = baseline, coverage map OK, unit tests pass; live regression **994 passed / 0 failed / 0 skipped** (REGRESSION PASS, 14.9 min); cleanup 351/351, errors 0, delta 0, orgs diff clean. Finding-2 (46 ERR_ABORTED preview failures) confirmed preview-toolbar artifact — does not appear on test.easeetool.com; pages: 157/0/0. Hotfix security fix (external users 404 on foreign projects/inquiries) confirmed on stable URL. 0 CRITICAL / 0 MAJOR / 0 MINOR. See bugs-3.md.

## Close-out pushes — 2026-10-09

- devops · 2026-10-09 · Pushed all three repos per human-approved task list. No friction.

  **1. Docs repo** (D:/projects/vistra/quotation-system-docs)
  - Branch `docs/hotfix-cross-company-access` pushed to origin with upstream set (new remote branch).
  - Commits on branch: 2f63ad9, 4c394c6, c4ba892, d38137a, 8962842 (tip).
  - Default branch (main) is NOT ahead or behind this branch — it is an independent branch; no merge requested or performed.

  **2. App repo — feature/regression-affected-runner merge into staging** (D:/projects/vistra/quotation-system)
  - `feature/regression-affected-runner` pushed to origin (new remote branch, tip b4091b6).
  - Local staging reset to origin/staging (483b18f) — local was 78 commits stale from an old hotfix session.
  - Merged feature/regression-affected-runner → staging via `--no-ff`; no conflicts (tooling/scripts only: package.json, scripts/regression.mjs, tests/regression/affected-runner.ts, tests/regression/README.md, tests/regression/coverage-map.ts).
  - Merge commit: 8da95d8 on staging. Pushed staging to origin: 483b18f → 8da95d8.
  - Deployment: dpl_3GSdPZJGzyjVU44zkW8HsrFBzr8T
  - State: READY (build time ~71 s)
  - SHA on staging: 8da95d8c4729c67d0c9c05c93370f6138a73cca9
  - Stable alias: https://test.easeetool.com (auto-follows staging branch in Vercel dashboard)
  - Health check: https://test.easeetool.com/api/health → 200 {"status":"ok","database":"connected","healthCheckRows":0}
  - Route list: 221+ build output items (tooling-only change; no app/ files touched; route count unchanged from prior staging build)
  - Migrations: none (tooling/scripts change only)
  - master: NOT touched

  **3. Marketplace repo** (D:/projects/repos/claude-marketplace)
  - Branch: `master`
  - Remote: origin (https://github.com/Nik-kolte/claude-marketplace.git)
  - Pushed SHA: 40e7871 (was 1 commit ahead of origin/master)
  - Uncommitted working-tree changes (marketplace.json, CLAUDE.md, vendor_categories.json, plugins/trademaster/) left untouched per instructions.
