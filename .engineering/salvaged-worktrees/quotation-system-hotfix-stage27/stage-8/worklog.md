# Stage 8 — Worklog

**Stage target:** [`stage-8.md`](../../../quotation-system-docs/development-cycles/stage-8.md)
**Tracker row:** [`development-cycles/README.md`](../../../quotation-system-docs/development-cycles/README.md)
**Branch:** `release/stage-8` (cut from `staging` @ `418aba6`, Stage 7 HEAD)
**Profile:** [`profile.md`](./profile.md)

## Work items

Filled in once the developer's plan (Step 2) proposes a breakdown, if the large+splittable tier applies.

## Activity log

_Each agent appends its own thin entry below (outcome + pointer to its detail artifact)._

---

### 2026-07-19 — developer (planning step)

**Outcome:** Implementation plan written. No deviations from spec; three implementation choices flagged
(within-spec latitude). Ready for build.

**Plan:** [`plan.md`](./plan.md)

**Key findings from code survey:**
- `app/[orgSlug]/layout.tsx` does not exist yet — must be created (correct insertion point per spec).
- Login page at `[orgSlug]/login/` is wrapped by the new layout; layout renders chrome only when session
  is present (null-safe `getSession()` pattern from `admin/layout.tsx`).
- `Partition` needs no `projectId` column — partitionNumber MAX query uses Prisma nested where
  `{ floor: { projectId } }` (no schema deviation).
- Add-wall form goes on a dedicated sub-page `design/add-wall/` (consistent with `projects/new/` pattern).
- `projects/layout.tsx` must add `design` namespace to `clientMessages` (next-intl gotcha — AGENTS.md).
- `LogoutButton` has no translations (hardcoded "Sign out") — safe to reuse in shared layout without
  adding another `NextIntlClientProvider`.

**Status:** DONE (planning only — no code written)

---

### 2026-07-19 — developer (implementation)

**Branch:** `feature/stage-8-implementation` (off `release/stage-8`)

**Outcome:** All 13 plan items implemented. Lint green, build green, health check green. E2E regression blocked by Playwright/Chromium browser infrastructure issue on this machine (see below).

**Files changed:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `Floor` + `Partition` models; back-relations on `Organization`, `Project`, `Floor`; `floors`/`partitions` on Organization; `floors` on Project. Used `@default(uuid())` per all existing models (not cuid). |
| `prisma/migrations/20260719160526_add_floor_partition/` | Migration created + applied against Neon dev DB. |
| `lib/data/floors.ts` | NEW — `createFloorIfNotExists` (P2002 race → re-fetch winner), `listFloorsByProject`. |
| `lib/data/partitions.ts` | NEW — `createPartition` (floorId tenancy guard + project-wide partitionNumber MAX+1 in $transaction), `listPartitionsByFloor`, `getPartitionById`. |
| `messages/en.json` | Added `design` namespace (18 keys). |
| `app/[orgSlug]/projects/layout.tsx` | Forwarded `design` namespace in `clientMessages` (next-intl gotcha fix). |
| `app/[orgSlug]/layout.tsx` | NEW — persistent top bar + side panel (Projects, Inquiries, Design, conditional Admin links). Null-safe session check: login page passes through with `{children}` directly. |
| `app/[orgSlug]/dashboard/page.tsx` | Removed nav link buttons (now in shared layout); removed duplicate LogoutButton; kept identity panel. |
| `app/[orgSlug]/projects/[projectId]/design/page.tsx` | NEW — three-column design page (left rail: floor-grouped walls; center: canvas placeholder; right: read-only Selections palette). |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/page.tsx` | NEW — add-wall server page (project 404 guard + floor datalist). |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/actions.ts` | NEW — `createWall` server action: unit normalisation (mm=round, feet=round×304.8), `createFloorIfNotExists`, `createPartition`, revalidate+redirect. |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/add-wall-form.tsx` | NEW — client form: location, floor (datalist), height+unit, width+unit; `useActionState`. |
| `app/[orgSlug]/projects/[projectId]/page.tsx` | Added "Design Walls" link pointing to `./design`. |
| `eslint.config.mjs` | Added `playwright-report/**` and `test-results/**` to global ignores (pre-existing gap: lint was picking up E2E artifacts). |
| `quotation-system-docs/design-docs/sql-queries/by-page.sql` | Added design page + add-wall action sections (Floor/Partition SQL mirror). |

**Reused:** `lib/data/projects.ts` (DAL pattern + $transaction + P2002 handler), `lib/data/admin.ts getAdminPermissions()`, `app/[orgSlug]/dashboard/logout-button.tsx`, `components/loading-overlay.tsx`, `app/[orgSlug]/projects/new/create-project-form.tsx` (form pattern), `app/[orgSlug]/projects/actions.ts` (action signature pattern).

**Verification:**
- `npm run lint` → 1 warning (pre-existing in `tests/e2e/org-nav.spec.ts`), 0 errors ✓
- `npm run build` → all routes compiled, both new routes (`/[orgSlug]/projects/[projectId]/design`, `/[orgSlug]/projects/[projectId]/design/add-wall`) appear in route list ✓
- `curl localhost:3000/api/health` → `{ status:"ok", database:"connected" }` ✓
- `npm run test:e2e` → 7 failed / 84 did not run — all failures are `net::ERR_ABORTED` at `page.goto()` before any assertion runs. Same 7 tests (first in each serial suite) failed identically before Stage 8 changes were made, spanning `smoke.spec.ts`, `org-nav.spec.ts`, `pricing-stage3.spec.ts` (not related to this stage). Root cause: Playwright/Chromium cannot establish HTTP connections to localhost on this Windows machine; curl to the same server works correctly. Recommend running E2E against `v-quote-test.vercel.app` once staged.

**Doc note (flag for doc-repo fix, not done here):** `quotation-system-docs/design-docs/04-data-model.md` — Floor and Partition tables say `(cuid)` but actual schema uses `@default(uuid())` (consistent with all existing models). The `by-page.sql` update uses `gen_random_uuid()` which is correct. The `04-data-model.md` annotation should be updated to `(uuid)` in a future doc pass.

**Status:** DONE_WITH_CONCERNS — E2E cannot be verified locally; Playwright/Chromium browser hangs on localhost. All code-level checks pass.

---

### 2026-07-19 — reviewer (review-1)

**Verdict:** CHANGES-NEEDED · 0 CRITICAL · 2 IMPORTANT · 0 MINOR

**Detail:** [`review-1.md`](./review-1.md)

**Summary of required changes:**
1. Dead P2002 handler in `createPartition` (`lib/data/partitions.ts`) — no `@@unique` constraint exists on
   `Partition.partitionNumber`, so the collision guard described in the JSDoc and implemented in the catch
   block cannot fire. Remove dead handler; either add `@@unique([organizationId, partitionNumber])` or
   explicitly document app-layer-only enforcement.
2. `createWall` server action (`add-wall/actions.ts`) trusts client-supplied `projectId` without checking
   it belongs to the session's org — allows cross-org `Floor` creation via direct POST. Fix: add
   `getProjectById(session, projectId)` check in the action after `requireSession`.

**Confirmed clean:** All read-query tenancy guards (floors + partitions); Floor `@@unique` + live P2002
handler; unit normalisation formula; login passthrough (no redirect loop); next-intl `design` namespace
wiring in `projects/layout.tsx`; `by-page.sql` updated; lint 0 errors; build green. E2E `ERR_ABORTED`
assessed as environment-only (not caused by new layout).

**Status:** DONE

---

### 2026-07-19 — developer (review-1 fixes)

**Addresses:** review-1 findings [IMPORTANT #1] and [IMPORTANT #2]

**Files changed:**

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `@@unique([organizationId, partitionNumber])` to `Partition` model; updated model comment to document org-wide unique scope (consistent with `Project.@@unique([organizationId, projectNumber])` pattern). |
| `prisma/migrations/20260719180000_add_partition_number_unique/migration.sql` | Hand-written migration (`CREATE UNIQUE INDEX "Partition_organizationId_partitionNumber_key" ON "Partition"("organizationId", "partitionNumber")`) applied via `migrate deploy` (Prisma `migrate dev` is TTY-only; `migrate deploy` is the non-interactive equivalent). |
| `lib/data/partitions.ts` | Updated JSDoc: `partitionNumber` is now backed by the DB `@@unique` constraint, not just app-layer. Updated inline catch comment from "dead code" phrasing to reflect the P2002 handler is now live. Handler itself kept (as directed). |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/actions.ts` | Added `import { getProjectById } from "@/lib/data/projects"`. Added project ownership check immediately after `requireSession`: `const project = await getProjectById(session, projectId); if (!project) return { error: "Project not found." };` — prevents cross-org Floor creation via direct POST with a foreign projectId. |

**Migration note:** `npx prisma migrate dev` is blocked in the Bash tool (detects non-interactive TTY). Migration SQL was hand-written following the exact pattern from `20260719160526_add_floor_partition/migration.sql` (Prisma generates `CREATE UNIQUE INDEX` for `@@unique`), then applied with `npx prisma migrate deploy`. This is equivalent to what `migrate dev` would generate+apply.

**Verification:**
- `npm run lint` → 0 errors, 1 pre-existing warning ✓
- `npm run build` → green; `prisma migrate deploy` reports "No pending migrations to apply" (constraint already applied); both design routes present ✓
- `npx prisma migrate deploy` → "Applying migration `20260719180000_add_partition_number_unique`" → "All migrations have been successfully applied." ✓

**Status:** DONE

---

### 2026-07-19 — reviewer (review-2)

**Verdict:** CHANGES-NEEDED · 1 CRITICAL · 0 IMPORTANT · 0 MINOR

**Finding 2 (tenancy gap):** CONFIRMED FIXED. `getProjectById(session, projectId)` added in `createWall` immediately after `requireSession`; returns clean `{ error: "Project not found." }` on failure. Import present. Correctly positioned before `createFloorIfNotExists`. ✓

**Finding 1 (dead P2002 guard):** PARTIALLY FIXED — constraint and migration are correct, but a new CRITICAL regression was introduced: the MAX aggregate query in `createPartition` is project-scoped (`where: { floor: { projectId } }`) while the `@@unique` constraint is org-wide (`(organizationId, partitionNumber)`). Any org with more than one project cannot add walls to a second project — the P2002 fires immediately and retrying cannot resolve it (project-scoped MAX returns null again on every attempt). Reference pattern (`createProject`) uses org-scoped MAX to match its org-scoped `@@unique` — `createPartition` must do the same. Fix: `where: { organizationId }` in the aggregate.

**Detail:** findings returned inline (see reviewer message).

**Status:** DONE

---

### 2026-07-19 — developer (review-2 fixes)

**Addresses:** review-2 CRITICAL finding (aggregate scope mismatch)

**Root cause:** `createPartition` scoped its MAX aggregate to `{ floor: { projectId } }` (project-wide)
while the `@@unique` constraint is `(organizationId, partitionNumber)` (org-wide). Second project in
the same org always started at partitionNumber=1 → permanent P2002, no recovery possible.

**Files changed:**

| File | Change |
|---|---|
| `lib/data/partitions.ts` | Removed `projectId` from `CreatePartitionInput` type and `createPartition` destructuring. Changed aggregate `where` from `{ floor: { projectId } }` to `{ organizationId }`. Updated JSDoc to describe org-wide scoping matching `createProject()` reference pattern. |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/actions.ts` | Removed `projectId` argument from `createPartition(...)` call. `projectId` retained for `getProjectById` tenancy check and post-save redirect (correct). |

**Reused:** `lib/data/projects.ts` `createProject()` as the reference pattern for org-scoped MAX.

**Verification:**
- `npm run lint` → 0 errors, 1 pre-existing warning ✓
- `npm run build` → green; both design routes present ✓

**Status:** DONE

---

### 2026-07-21 — tester (engineering:test)

**Verdict:** PASS

**Report:** [`bugs-1.md`](./bugs-1.md)

**Note:** Run directly by the conductor, not the `engineering:tester` subagent — the `Agent` tool is
unavailable in this environment (requires WSL/tmux, not installed on this machine). Same checklist/evidence
bar applied.

**Summary:** Build/lint/health green. Full Definition-of-Done checklist exercised via the running app
(browser + direct Neon dev DB queries). Dedicated verification of the highest-risk item — org-wide
`partitionNumber` sequencing across 2 projects in the same org (the review-round-2 regression) — confirmed
correct both via the UI (created a 2nd project, added walls to both, no P2002) and via direct DB query
(3 unique sequential partitionNumbers, unique index confirmed present in `pg_indexes`). Tenancy isolation
confirmed via DB query (0 partitions in other orgs; 0 organizationId mismatches between Partition/Floor;
DAL-shaped cross-org query returns 0 rows). 2 known MINOR items from review-3 remain, unfixed, non-blocking.

**Real but out-of-scope finding:** this local machine has a zombie `next dev` process / extreme Turbopack
cold-compile latency (up to 5.4 min/route) / Playwright MCP action-stability flakiness, traced and worked
around during this run. Confirmed pre-existing (reproduces on routes Stage 8 never touched) — not a Stage 8
regression, but flagged in `bugs-1.md` as worth a dedicated look, and as reinforcing the existing
recommendation to run `test:e2e` against `v-quote-test.vercel.app` rather than locally on this machine.

**Status:** DONE

---

### 2026-07-19 — reviewer (review-3)

**Verdict:** APPROVE-WITH-NITS · 0 CRITICAL · 0 IMPORTANT · 2 MINOR

**Detail:** [`review-3.md`](./review-3.md)

**Summary:**
- Round-2 CRITICAL (aggregate scope mismatch) CONFIRMED FIXED: `where: { organizationId }` in
  `createPartition` matches the `@@unique([organizationId, partitionNumber])` constraint. `projectId`
  cleanly removed from `CreatePartitionInput` and call site. Tenancy check and redirect in
  `add-wall/actions.ts` unaffected. Only caller is `add-wall/actions.ts` (confirmed by grep).
- Lint: 0 errors. Build: green, both design routes present (independently verified).
- 2 MINORs: stale "for the project" phrase in `schema.prisma` Partition comment (should be "for the org");
  unused `wallDisplay` translation key with wrong param names (`{height}`/`{width}` vs `{heightMm}`/`{widthMm}`).
  Neither has runtime impact — developer's discretion.

**Status:** DONE

---

### 2026-07-21 — devops (engineering:deploy — staging)

**Branch deployed:** `release/stage-8` fast-forward merged into `staging` (418aba6 → 5f93450)

**Merge:** `git merge --ff-only release/stage-8` — clean fast-forward, no conflicts. 15 files changed (+1039 / −96). Pushed to `origin/staging` to trigger Vercel git auto-deploy.

**Deployment ID:** `dpl_281KNDbKiKCDtPW7iesvZNPRmA2y`
**State:** READY
**Hash URL:** `https://quotation-system-o4xyydacr-vistra-indias-projects.vercel.app`
**Stable alias:** `https://v-quote-test.vercel.app` (re-pointed via `npx vercel alias set`)
**Build time:** ~48 seconds (10:45:42–10:46:30 UTC). Turbopack, cached from previous deployment (`3k21AvKP1VUaLehPQZSC4CR5vPWm`).
**Migrations:** "10 migrations found. No pending migrations to apply." — both Stage 8 migrations (floor/partition + unique index) confirmed already applied to Neon dev DB.

**Route list — Stage 8 routes confirmed present:**
- `/[orgSlug]/projects/[projectId]/design` ✓
- `/[orgSlug]/projects/[projectId]/design/add-wall` ✓
- (Full layout `app/[orgSlug]/layout.tsx` is implicit in all `[orgSlug]/*` routes building cleanly)

**Health check — hash URL:**
`GET https://quotation-system-o4xyydacr-vistra-indias-projects.vercel.app/api/health`
Response: `200 {"status":"ok","database":"connected","healthCheckRows":0,"timestamp":"2026-07-21T10:46:55.444Z"}` ✓

**Alias re-point:**
`npx vercel alias set quotation-system-o4xyydacr-vistra-indias-projects.vercel.app v-quote-test.vercel.app --scope=vistra-indias-projects`
Output: `Success! https://v-quote-test.vercel.app now points to quotation-system-o4xyydacr-vistra-indias-projects.vercel.app`

**Health check — stable alias:**
`GET https://v-quote-test.vercel.app/api/health`
Response: `200 {"status":"ok","database":"connected","healthCheckRows":0,"timestamp":"2026-07-21T10:47:20.539Z"}` ✓

**Regression:** Not run per explicit human instruction.
**Production:** Not touched. `master` branch unchanged at `f5a1f96`.

**Status:** DONE
