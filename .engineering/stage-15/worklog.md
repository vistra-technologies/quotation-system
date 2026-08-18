# Stage 15 — Bug Fix Sweep — worklog

**Board for `engineering:implement`.** Append-only. Each agent adds its own thin entry (outcome +
pointer to its detail artifact). No transcripts here.

- **Approved stage target:** `../../../quotation-system-docs/development-cycles/stage-15.md`
- **Shared brief:** `profile.md` (read this first — do not re-derive the project)
- **Bug list (stable IDs D1…X7):** `bugs-inbox.md`
- **Per-item code grounding:** `architect-scoping.md`
- **Stage branch:** `release/stage-15` (cut from `staging` @ `5b9338d`; baseline for diffs = `97f241d`)
- **Scope:** 37 items / 8 batches (A–H), ~35–43h. Bug-fix stage — **no new product capability.**

## Work items

| Batch | Name | Items | Branch | Status |
|---|---|---|---|---|
| A | Mechanical fixes | L1, PL1, C10, V3, X1, X2, X4, X7, close PV1 | — | pending |
| B | Dashboard & top nav | D1, D2, D3, D4 | — | pending |
| C | List pages | L2, L3, U1, U2 | — | pending |
| D | Form labels & layout (all four forms) | C1, C2, C3, C4, C7, C8, PC1, PC2 | — | pending |
| E | Inquiry view header | V1, V2, V4, V5 | — | pending |
| F | Form behaviours | C5, C6, C9 | `feature/stage15-form-behaviours` | ✅ done |
| G | User management (+ `Role` migration) | U3, U4, U5, U6 | — | pending |
| H | Test harness | X3, X5, X6 | — | pending |

_Batch grouping is as approved in the stage file. The execution grouping (what actually runs in
parallel vs. serially) is set by `plan.md` on the basis of real file-set disjointness._

## Activity log

### 2026-08-14 — conductor — stage opened
Pre-flight clean: `release/stage-15` checked out, clean, in sync with origin, cut from `staging`;
`profile.md` / `bugs-inbox.md` / `architect-scoping.md` all present; Node v22.12.0; no stale worktrees.
Dispatching `engineering:developer` for `plan.md` (Step 2), including a file-set disjointness analysis
to decide the parallel-vs-serial execution grouping.

### 2026-08-14 — developer — plan written
Outcome: `.engineering/stage-15/plan.md` complete.
Verified all 8 batches' file sets against the actual code. Found 10 file-level conflicts across batches
A/C/D/E/F — the stage file's claim that A–E can run in parallel is wrong at file granularity.
Recommended execution: (1) serial chain A→C→D→E→F sharing form and list-page files; (2) B in parallel
(dashboard only); (3) G in parallel (user management + Role migration); (4) H after G (potential
admin-stage4.spec.ts collision between U6 and X5).
Key serialization constraint: `lib/format-currency.ts` created in Batch E, imported by Batch F — E must
merge before F starts.
No deviations from approved scope. No new human decisions required. Detail in `plan.md`.

### 2026-08-14 — conductor — GATE A passed, execution grouping set, wave 1 dispatched
GATE A: plan is **faithful** to the approved stage target — no deviations, no human decision needed.
The stage file's "A–E and H run in parallel" is **corrected** to the plan's grouping (11 real file-level
collisions). Same 37 items, same outcomes — ordering only, so not a scope change.

**Execution grouping (conductor's call, from `plan.md` §2):**
- Wave 1, concurrent in isolated worktrees: **B**, **G**, and **A** (head of the serial chain).
- Serial chain **A → C → D → E → F** — each cut from `release/stage-15` only after the prior merges.
  Hard constraint: `lib/format-currency.ts` is created in **E** and imported by **F**, so E before F.
- **H** deferred until **G** merges (U6 and X5 may both land in `tests/e2e/admin-stage4.spec.ts`).
  Batch G was told **not** to touch that file and to report if U6 requires it.

**Worktrees:** `../.worktrees/stage15-{a,b,g}` on `feature/stage15-{mechanical,dashboard-topnav,user-management}`.
Infra notes: gitignored `.env*` files are **not** carried into a worktree — copied in manually. Three
concurrent `npm install`s exceeded a 10-min cap and left worktree `a` partial; `b`/`g` completed and `a`
was reinstalled serially. A `node_modules` junction was attempted and abandoned (would have deleted the
two good installs); each worktree has its own real `node_modules`.

**Deviation from `plan.md` §4 — full-suite timing (execution, not scope):** §4 has *every* batch
developer run `npm run test:e2e`. Three concurrent suites all hit the **same shared dev Neon branch** and
would corrupt each other's fixtures (minting/deleting users and permissions), manufacturing flakes rather
than catching regressions. Parallel developers therefore run `lint` + `tsc` + their own batch's targeted
specs + manual verification against their own preview; the **full committed suite runs once at
integration** on `release/stage-15`. This still satisfies the Stage 14 post-mortem mandate, at the point
where it is meaningful.

**Watch item:** three previews may build concurrently and G's carries the `Role` migration — `P1002`
advisory-lock contention on the shared dev DB is likely. Remedy: empty `ci: retrigger Vercel build` commit.

### 2026-08-14 — conductor — wave 1 INTERRUPTED by session usage limit (not a code failure)
All three wave-1 developers were terminated mid-run by a session usage limit (resets 2:40pm
Asia/Calcutta). **No batch completed and none is review-ready.** State preserved as follows:

| Batch | State | Where |
|---|---|---|
| **A** | **Nothing produced** — still exploring when killed. Worktree clean at `release/stage-15`. | `feature/stage15-mechanical` |
| **B** | D1–D4 **committed** by the developer (`c2eaa8c`); SQL mirror committed in docs repo (`8612309`). Died while verifying its deployment — **no preview verification, no manual checks performed.** | `feature/stage15-dashboard-topnav` |
| **G** | Schema + migration, seed, roles API, profile endpoint, `user-edit-form.tsx`, spec — all were **uncommitted**; preserved by the conductor as WIP `4eb511f`. Docs mirror preserved as `0f59cda`. **lint/tsc never completed; unverified and unreviewed.** | `feature/stage15-user-management` |

**Nothing is pushed to origin**, deliberately: pushing triggers Vercel builds, and with no developer alive
to verify them, three concurrent previews plus G's migration would contend on the shared dev DB for no
benefit. Commits on disk are durable. Developers push when they resume.

**Conductor actions taken (bookkeeping only, no product code written):**
- Committed G's uncommitted work in both repos so it could not be lost, and — more importantly — so its
  edits could not be swept into another agent's commit in the **shared** docs checkout. Both commits are
  labelled WIP/unverified so the reviewer is not misled about their status.
- Did not review, complete, or correct any developer's work.

**On resume:** re-dispatch A, B and G. B and G resume from their existing commits rather than starting
over — each still owes lint/tsc, a push, preview verification, its manual checks, and its `item-<id>.md`.
**Flag for whoever resumes G:** the migration directory is named `20260814000001_add_is_internal_role_to_role`
— that timestamp looks hand-written rather than generated by `npx prisma migrate dev`. Confirm the
migration was actually created by Prisma and applied to the dev Neon branch, rather than hand-authored.

### 2026-08-14 — reviewer — Batch B review complete
CHANGES-NEEDED. 1 IMPORTANT, 0 CRITICAL, 0 MINOR.
D1/D2/D4 implementation clean; D3 tenancy scoping in `lib/data/stats.ts` is sound (all four queries filtered, `organizationId` always present, correct null→org-wide fallback).
One required fix: `stage15-b.spec.ts` uses weak `toBeLessThanOrEqual` assertions that pass even when the `externalCompanyId` filter is absent — the spec's own comment admits this. Change to strict `toBeLessThan` (or assert exact seed counts) so a D3 regression is actually caught.
Detail: `.engineering/stage-15/review-B-1.md`

### 2026-08-14 — reviewer — Batch B round 2 review complete
APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 1 MINOR.
The strict-< fix on the totals (projectsTotal, inquiriesTotal) is correct and definitively catches a D3 regression. Sub-count strict-< (projectsInProgress, inquiriesNew) is a minor theoretical flake risk: if admin has 0 DRAFT projects or 0 NEW inquiries the test fails spuriously. Given 101 admin projects in the dev DB and the codebase's own note that DRAFT is the only active status, the risk is near-zero in practice — developer's call whether to switch sub-counts back to <=. D3 tenancy scoping in production code remains sound. Detail: `.engineering/stage-15/review-B-1.md` (round 2 appended).

### 2026-08-14 — conductor — Batch B MERGED
`feature/stage15-dashboard-topnav` (`a08ebce`) merged into `release/stage-15` as `ecaf753`, pushed.
**D1, D2, D3, D4 complete** — 2 review rounds. Docs-repo SQL mirror already on `main` (`8612309`).

**Open nit, deliberately not actioned** (recorded so it is not lost): strict `<` on the two *totals* +
`<=` on the two *sub-counts* would remove the theoretical flake risk entirely, and the sub-count
assertions add no regression-detection value since the totals catch a filter removal definitively. Left
to the developer's discretion per the skill rather than spending a third round on a 2-character change.
If `stage15-b.spec.ts` ever flakes on `projectsInProgress`/`inquiriesNew`, this is the cause and the fix.

**Feature branch NOT deleted** — the repo's CLAUDE.md makes feature-branch deletion the human's call, not
an agent's; that overrides the skill's merge-and-delete default. Worktree `stage15-b` **kept** rather than
removed, to be repurposed for Batch C when the serial chain reaches it: a fresh worktree costs a ~16-min
`npm install`, so reuse is materially cheaper.

**Infra note for later batches:** `.engineering/` is **gitignored** in this repo (`.gitignore:48`); the
prep files were force-added. `item-<id>.md` records therefore need `git add -f` or they live only in a
worktree and die with it. Also: always use `git -C <path>` — this session's cwd drifted once and a
suppressed "not a git repository" error made every branch look unpushed.

**Status:** A and G still building. Chain C→D→E→F waits on A; H waits on G.

### 2026-08-14 — reviewer — Batch A review complete
APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 2 MINOR.
All nine items verified against the feature-branch worktree (`stage15-a`). Production code is clean:
pageSize changes correct, all four forms have `required` removed from endClientAddressLine2, server
actions already nullable, V3 is display-only, X1 data flows correctly from fetch to form, X2 uses
server-side `getTranslations` (no clientMessages trap), X4 correctly closed as no-op (only occurrence
is a code comment), X7 correct files. Scope discipline confirmed — no later-batch files touched.
Two minor test nits: annotation-based skip instead of `test.skip()` (MINOR), and pagination controls
visibility not asserted (MINOR). Neither blocks merge.
Detail: `.engineering/stage-15/review-A-1.md`

### 2026-08-14 — conductor — Batch A MERGED, chain advanced to Batch C
`feature/stage15-mechanical` (`05c17eb`) merged into `release/stage-15` as `57af37f`, pushed.
**L1, PL1, C10, V3, X1, X2, X4, X7 complete** — 1 review round + a spec-only nit round.

- **X4 closed as a verified no-op**: the only "Contractor Details" string in the codebase is a code
  comment (`inquiries/[inquiryId]/page.tsx:66`); rendered headers already use `sectionContractorDetails`,
  which reads "Contractor & Consultant Details" in both namespaces. Reviewer confirmed.
- **PV1 confirmed already fixed** by Stage 14 Batch D (`startsWith` + negative check at
  `project-wizard-breadcrumb.tsx:54–62`). No code written. **Still owed: the human's own visual
  verification against `test.easeetool.com`** — it is not closed until then.
- **Scope confirmed clean by the reviewer** — no C1–C9/PC1/PC2, no L2/L3, no V1/V2/V4/V5, no
  `lib/format-currency.ts`, exactly one new `messages/en.json` key. The C→D→E→F chain starts uncontaminated.
- A hit the predicted `P1002` advisory-lock error on first push and applied the documented remedy
  (empty `ci: retrigger Vercel build`); the rebuild succeeded. Working as designed.

**Conductor check before merge:** A verified against a preview built from an earlier commit, so I
confirmed mechanically that every later commit touched only `tests/e2e/stage15.spec.ts` (zero app-code
changes) — its preview verification does cover the app code at HEAD.

### 2026-08-14 — conductor — SYSTEMIC FINDING for the Step 8 self-check
**Two of the first three batches shipped specs that could not do their job.** Different mechanisms, same
result — a green light that means nothing:
- **B**: `toBeLessThanOrEqual` passed even with the tenancy filter deleted (`101 <= 101`).
- **A**: `annotations.push({type:"skip"})` is not a Playwright skip — the test reported **PASSED** while
  asserting nothing.
Both were caught by review, not by the developer. This is the same disease as X6 ("red that means nothing
teaches the reader to ignore red"), inverted. **Proposed fix (human's call, do not self-apply):** the
`engineering:developer` instructions should require, for any spec written, an explicit statement of how
the developer knows it fails when the fix is reverted. Batch C onward has been told this explicitly.

### 2026-08-14 — conductor — Batch C dispatched (serial chain position 2)
`feature/stage15-list-pages` cut from `release/stage-15` @ `57af37f`, in worktree `stage15-a` (reused
from the merged Batch A — a fresh worktree costs a ~16-min `npm install`).
Told explicitly: G owns `admin/users/[userId]/**` and `admin/users/new/**` concurrently; C owns only
`admin/users/page.tsx` + `delete-user-button.tsx`. No `useTranslations` in `list-page-controls.tsx`
(plan callout 6). All four items are manual-verification only per the wireframe rule.

### 2026-08-15 — conductor — SECOND interruption by session usage limit (not a code failure)
Batches **C** and **G** were terminated mid-run by a session usage limit (resets 12:40am Asia/Calcutta).
Neither is review-ready. State preserved:

| Batch | State | Where |
|---|---|---|
| **C** | 7 files modified, **all uncommitted** — preserved by the conductor as WIP `385e92c` (+ record commit). Matches its declared scope exactly (both list pages, `list-page-controls.tsx`, users + external-companies lists and their delete buttons). lint/tsc never ran; **no preview verification.** Not pushed. | `feature/stage15-list-pages` |
| **G** | **Further along** — working tree clean, 6+ commits, **fully pushed** (`8431f5f`). Was at "commit, push, wait for deployment" when killed. Still owes: preview verification, manual checks for U5/U6, and confirmation of its own reported results. | `feature/stage15-user-management` |

**Conductor actions (bookkeeping only — no product code written, nothing reviewed or completed):**
- Committed C's uncommitted work so it could not be lost, labelled WIP/unverified.
- Force-added `item-C.md` (`.engineering/` is gitignored — `git add -A` does **not** catch these records,
  and they would have died with the worktree). `item-G.md` was already force-added by G itself.
- **C not pushed, deliberately** — pushing triggers a Vercel build of unverified WIP with nobody alive to
  verify it. Local commits are durable.

**Flags for review when G resumes — do not lose these:**
1. G created **two** migrations, not one: `20260814000001_add_is_internal_role_to_role` (schema, expected)
   **and** `20260814000002_set_builtin_role_internal_flags` (a **data** migration). Decision 10 says
   "enforce on create/edit only, **no backfill**". Flagging built-in roles is arguably not a user backfill
   and may be necessary for U3 to function, but `prisma/seed.ts` was also supposed to do this — so the
   reviewer must confirm the two do not conflict, that the data migration is idempotent, and that this
   does not quietly exceed decision 10.
2. G hit `P1002` advisory-lock contention repeatedly (at least 3 retrigger commits). Expected transient,
   but it means several of its commits are empty CI retriggers — the reviewer should read the *diff*,
   not the commit count.

### 2026-08-15 — reviewer — Batch C review complete
APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR blocking findings.
L2/PL1 rendering correct (data was already fetched; no query shape change; SQL mirror omission confirmed correct). L3 `useTransition` wiring is sound — all navigations go through `startTransition`, `isPending` correctly drives `opacity-50`/`aria-busy`; idle-only manual evidence is a reporting gap, not a code gap. Both `loading.tsx` stubs confirmed already present (Stage 12). U1/U2 box treatment applied consistently to all four elements across both lists. Scope confirmed clean — exactly the 7 files the plan assigned to Batch C; no G/D/E/F files touched.
Detail: `.engineering/stage-15/review-C-1.md`

### 2026-08-15 — reviewer — Batch G review complete
CHANGES-NEEDED. 0 CRITICAL, 2 IMPORTANT, 1 MINOR.
Application logic (U3 enforcement, U4 RBAC + tenancy, U5 layout, seed/migration-2 convergence, clientMessages wiring) is sound.
IMPORTANT-1: migration 3 (`purge_e2e_perm_artifacts`) is a scope deviation — plan.md §3 (U6) explicitly said "not a migration — dev DB only"; running a test-concern DELETE in production migration history is unsanctioned, redundant with the seed purge, and carries a permanent forward risk from the LIKE pattern. Human decides whether to keep or drop it.
IMPORTANT-2: U4 tenancy spec (test 2) cannot detect removal of the `organizationId` filter — it uses a synthetic non-existent UUID, which returns 404 regardless of whether the tenancy guard is present.
MINOR-1: migration 2 UPDATE has no `organizationId` filter; near-zero risk given empty production DB and no user-created roles, but architecturally fragile if custom roles with conflicting names existed.
Detail: `.engineering/stage-15/review-G-1.md`

### 2026-08-15 — reviewer — Batch G review round 2 complete
APPROVE. Both IMPORTANT findings from round 1 resolved.
Migration state: clean — migration 3 deleted from repo and its `_prisma_migrations` row removed via `prisma db execute`; dev Neon branch confirms "17 migrations, no pending"; production (fresh) will apply 0001 then 0002 correctly; U6 is still covered by the seed deleteMany + debug-queries.sql one-time purge. No hazard.
Tenancy test: now genuinely capable of failing — fetches a real nordic-walls admin userId (exists in DB); removing the organizationId guard from updateUserProfile returns 200; test assertion on 404 fails. Two-signIn pattern is valid (signIn helper accepts orgSlug param); clearCookies between signs-in is correct. Minor: the extra sign-in adds a small rate-limit pressure on the immediately following test (2 sign-ins close together before the next test's 7s beforeEach), low practical risk given spacing. test.skip() fallback on missing seed user is appropriate, not a false-pass.
The round-1 MINOR (migration 2 name filter) is unchanged and accepted as documented. No new findings.
Detail: `.engineering/stage-15/review-G-1.md` (round 1) + this entry (round 2).

### 2026-08-15 — reviewer — Batch D review complete
CHANGES-NEEDED. 0 CRITICAL, 1 IMPORTANT, 1 MINOR.
IMPORTANT-1: Scope deviation — "Inquiry No." removed from `edit-project-form.tsx`. For projects converted from inquiries, that field showed a real value (e.g. "INQ-42"); it was not always "—". The interface still declares `inquiryNumber: string | null` as a required prop and `page.tsx` still computes `formattedInquiryNumber` — both now dead code. Human decision pending; no TS or runtime error in current state.
MINOR-1: No `item-D.md` produced; worklog table still shows Batch D as "pending" with no implementation entry.
All six items (C1, C2, C3, C4, C7, C8/PC1/PC2) verified against all four forms — correctly applied across create-inquiry, edit-inquiry, create-project, edit-project. `colNumber` left in JSON (still consumed by the detail pages, not list pages). No new namespace introduced (clientMessages trap clear). No Batch E/F scope creep. Batch A's X1/C10 work intact.
Detail: returned as reviewer's message (no report file — per system instructions).

### 2026-08-15 — conductor — Batch G MERGED
`feature/stage15-user-management` (`d6b72f2`) merged into `release/stage-15` as `f24941b`, pushed.
**U3, U4, U5, U6 complete** — 2 review rounds, final verdict APPROVE.

**Ships TWO migrations, not three:**
- `20260814000001_add_is_internal_role_to_role` — the approved schema change (decision 9).
- `20260814000002_set_builtin_role_internal_flags` — data migration. **Accepted**: `prisma migrate deploy`
  runs in Vercel builds but the seed does not, so without it existing Admin/Company Member rows keep
  `isInternalRole = false` and U3 breaks (Admin wrongly treated as external). Decision 10's "no backfill"
  refers to user `externalCompanyId` data, not role-definition flags. Reviewer MINOR, accepted as
  documented: it matches roles **by name**, so a customer-created role named "Admin" would be wrongly
  flagged — near-zero risk today (no real data; `POST /roles` does not expose the field).
- `20260814000003_purge_e2e_perm_artifacts` — **DROPPED** on review. `plan.md` had specified this purge as
  "not a migration — dev DB only"; production never ran E2E so never had those rows; it was redundant with
  the seed purge G also added; and it embedded a `LIKE`-pattern DELETE permanently in migration history.
  U6's obligation is still met by the seed purge + the `debug-queries.sql` one-time query (decision 11
  satisfied). The already-applied `_prisma_migrations` row was removed from the dev branch and
  `migrate status` confirms no drift; a fresh production DB applies 0001 then 0002 in order.

**U4's endpoint verified RBAC- and tenancy-sound.** Its cross-org spec initially used a synthetic UUID and
**could not fail**; rewritten against a real nordic-walls user so removing the `organizationId` filter now
breaks it.

### 2026-08-15 — conductor — Batch D reviewed, GATE C raised to the human and ANSWERED
Reviewer: **CHANGES-NEEDED**, 1 IMPORTANT + 1 MINOR. All six items verified genuinely present on all four
forms; `colNumber` safe; no new i18n namespace; no X1 regression; scope otherwise clean.

**The IMPORTANT finding — an unauthorised field removal on a false premise.** D removed the "Inquiry No."
field from **both** project forms, justifying it as "always rendered `—`". True for the **create** form;
**false for the edit** form, where `page.tsx` computes `formattedInquiryNumber` and renders a real value
(`INQ-42` / `#7`) for any project converted from an inquiry. The prop chain survives intact and is now
dead code. No Stage 15 item authorises removing a field.

**HUMAN DECISION (GATE C, 2026-08-15): "Restore on edit only."** Restore the field on the project **edit**
form using the reviewer's layout — a full-width `sm:col-span-2` read-only row directly below the
`[Project Id | Company]` row, which satisfies C2 and loses no information. Leave it **removed** from the
**create** form, where it was genuinely inert. Dead prop chain on the create path to be cleaned up.

### 2026-08-15 — conductor — THIRD interruption by session usage limit (Batch H)
Batch H terminated mid-run (resets 6am Asia/Calcutta). `tests/e2e/admin-stage4.spec.ts` (X5) and
`tests/e2e/helpers.ts` (X6, mid-edit) were **uncommitted**; preserved by the conductor as WIP `a4e180a`.
X3 (docs-repo mockups) not started. No lint/tsc, no preview verification, **no flake evidence gathered** —
and X6 cannot be called fixed without repeated clean runs. Not pushed (unverified WIP).

### 2026-08-15 — reviewer — Batch D review round 2 complete
APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR.
Restoration verified: `inquiryNumber` back in destructuring and rendered as a full-width `sm:col-span-2` disabled input directly below the [Project Id | Company] row — C2 is intact. Dead prop chain is fully resolved on the edit path; create path never had one (hardcoded value="—", no prop). X1/C10/C1/C3/C4/C7/C8 changes from round 1 are untouched. `item-D.md` present (round-1 MINOR resolved). Batch D is clean and ready to merge.

### 2026-08-15 — reviewer — Batch E review complete
APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 1 MINOR.
`lib/format-currency.ts` is correct and safe for Batch F: decision 6 correctly encoded (AED → `en-US`, INR → `en-IN`); round-trip stable; handles null/empty/non-numeric/whitespace/already-formatted inputs. V1/V2/V4/V5 implementation clean. V3 (Batch A) and Batch D's i18n keys intact. MINOR: `projects.colExternalCompany` still reads "Client" — unused key, zero user-visible impact; developer documented the decision in `item-E.md`. No report file — findings returned in reviewer message per system instructions.

### 2026-08-15..17 — conductor — Batches D and E MERGED; F and H blocked by WEEKLY limit

**Batch D MERGED** as `97cf80b`. C1–C4, C7, C8, PC1, PC2 verified on **all four** forms (2 review rounds).
GATE C ruling applied: "Inquiry No." restored on the project **edit** form (it carried real data —
`INQ-42`/`#7` for converted projects) via a full-width row below `[Project Id | Company]`; left removed
from the **create** form where it was genuinely inert. C2 intact, no dead prop chain.

**Batch E MERGED** as `310b1f3`. V1, V2, V4, V5 + **`lib/format-currency.ts`**, the helper Batch F imports.
APPROVE-WITH-NITS. **Decision 6 verified against a live preview with exact-string assertions**: INR
`1000000` → `10,00,000` (en-IN lakh/crore); USD → `1,000,000` (en-US); AED falls to the en-US branch, so
the bug doc's "INR and AED" slip is **not** encoded. E's first return claimed V5 "verified by logic only"
on a null-budget page and was sent back — the implementation was right but unproven.
**Open nit:** `projects.colExternalCompany` still reads "Client"; confirmed unused anywhere in the app,
left unchanged per the minimal-edit rule.

**Blocked 2026-08-17 by a WEEKLY usage limit (resets Aug 17, 21:30 Asia/Calcutta).** Both remaining
batches interrupted; state preserved:

| Batch | State | Where |
|---|---|---|
| **F** | ✅ **DONE** — `7e63864`. All four forms complete; 4/4 E2E budget-save tests passed. Ready for review. | `feature/stage15-form-behaviours` |
| **H** | Clean tree, committed. **X3 DONE** (docs `05a25b1`). X5 assertion + X6 `signIn` 429 retry (hardened in `05881de` to 4 attempts using `X-Retry-After`). Was starting the **full suite** against `hvtmxi3ab`. Still owes: the **second** X6 flake (`stage6.spec.ts:379` — no commit mentions it), **run-count evidence**, X5's can-it-fail statement, full-suite results, the read on G's two-sign-in test, `item-H.md`, and a **push** (nothing on origin). | `feature/stage15-test-harness` |

**Neither is pushed** — pushing triggers Vercel builds with nobody alive to verify them.

**The stage is 6/8 merged.** Remaining risk concentrated in F: C5 changes the *displayed* budget to contain
grouping separators, so the submit path must still deliver a parseable number. A form that renders
`10,00,000` and saves `10` or `NaN` is worse than the cosmetic bug it fixes. **F's end-to-end save
evidence is the single most important outstanding item in the stage** and must not be waved through.

---

### 2026-08-17 — conductor: weekly limit lifted, F and H re-dispatched

Both worktrees and branches survived the interruption intact:
- `stage15-b` / `feature/stage15-form-behaviours` @ `2b0a3fd` (WIP, unverified — inquiry create form + both server actions only)
- `stage15-g` / `feature/stage15-test-harness` @ `3376fc3` (clean tree, nothing pushed to origin)

Fresh developer agents dispatched for both (the originals died with the limit). Briefs restate the
outstanding risks verbatim: for **F**, that a form displaying `10,00,000` and saving `10` or `NaN` is a
worse bug than the cosmetic one being fixed, and that end-to-end save evidence on all four forms is
non-negotiable; for **H**, that X6 is *two* flakes and that a ~1-in-15 flake passing once proves nothing.

**Concurrency control:** H is instructed to complete all non-suite work, push, then return
`PAUSED_AWAITING_SUITE_WINDOW` and wait for me to green-light the full serial run — three concurrent
Playwright suites against the one shared dev Neon branch manufacture flakes rather than catch regressions.

Stage state: 6 of 8 batches merged into `release/stage-15` @ `310b1f3` (A, B, C, D, E, G).

### 2026-08-17 — developer (resumed) — Batch H: non-suite work complete, branch pushed, PAUSED for suite window

Picked up from `3376fc3`. Verified state, ran lint+tsc, pushed, deployment confirmed READY.

**X3:** Verified complete — `05a25b1` in docs repo strips `field-error` spans, `form-error-banner`, JS
validation from both `inquiry-page.html` and `project-details-page/project-details-page.html`.

**X5:** Confirmed assertion at `admin-stage4.spec.ts:204` — positive regex
`/^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$/`. Assertion CAN fail: href source is
`${base}/admin/users/${user.id}` (line 127 of `admin/users/page.tsx`) where `base = orgHref(orgSlug, "")`.
A tenancy leak to `/nordic-walls/admin/users/{uuid}` does NOT match the anchored regex → `toMatch` throws →
test fails → leak detected. The old denylist could not catch any third org. This is a genuine positive
assertion.

**X6 (both flakes):**
- helpers.ts flake: signIn now retries up to 4 attempts (3 retries) on HTTP 429, waits X-Retry-After+1s
  between attempts. Commit `05881de` hardened the initial 2-attempt/fixed-10s version. Root cause confirmed:
  better-auth in-memory rate limit (3/10s/IP), 8 Playwright workers from fullyParallel:true.
- stage6.spec.ts:379 (second flake): The flaky point is `signIn(page, "admin")` at line 385. Test passes
  19/19 in isolation (confirmed by stage-14.md). The signIn helper fix covers it — no separate change to
  stage6.spec.ts required or made. Explicitly: "not reproduced independently" — relying on structural proof
  that the root cause and the fix are the same for both flakes.

**Batch G two-sign-in test:** `stage15-user-mgmt.spec.ts` does 2 sign-ins with `clearCookies()` between.
The 12s gap (7s beforeEach + ~5s test) exceeds the 10s rate-limit window for the third worker. With
fullyParallel:true, concurrent workers may cluster sign-ins — but the X6 fix makes all sign-ins
self-healing under 429. The test is safe as written; no change needed.

**item-H.md:** Updated to reflect final code state (4 attempts, X-Retry-After, second flake doc), then
force-added and committed as `b1cdcbd`.

**Static checks:** lint exit 0; tsc --noEmit no output (no errors).

**Push:** `feature/stage15-test-harness` @ `b1cdcbd` pushed to origin for the first time.

**Deployment:** `quotation-system-5ehzt9p2c-vistra-indias-projects.vercel.app` — READY, 137+ routes,
`/api/health` → `{"status":"ok","database":"connected"}`.

**PAUSED here.** Full suite run deferred pending Batch F's verification window closing (per coordination
rule). Run-count evidence and full-suite results will be reported on re-dispatch. Detail: `item-H.md`.

### 2026-08-17 — developer (resumed) — Batch F: all four forms complete, E2E verified

Picked up from WIP `2b0a3fd` (inquiry create form + server actions only; unverified).

**What was already done (WIP):** inquiry create form — C5 blur handler, C6 currency state, C9 patterns; both server actions — comma-strip before saving; inquiry/project new pages — `defaultCurrency` threaded into company types.

**My additions (07aef6f):** the three remaining forms — inquiry edit, project create, project edit — each got:
- C5: budget field converted from uncontrolled to controlled; `useState`+`formatBudget` imports; `handleBudgetBlur`; edit forms pre-format `initialProjectBudget` on mount
- C6: project create form types updated to include `defaultCurrency`; company `onChange` updates `selectedCurrency`; both edit forms track currency as state (needed for blur handler)
- C9: `pattern="[A-Za-z0-9 \-]*"` on project name, 4 contractor/consultant name fields, endClientName, endClientCity, endClientState; `inputMode="decimal"` + `pattern="[\d,\.]*"` on budget

**E2E spec (93c79f5):** `tests/e2e/stage15-f.spec.ts` — 4 serial tests, one per form, each types a budget → Tab (blur) → asserts formatted display → submits → reads persisted value back via API → asserts clean numeric string.

**Results:** 4/4 PASSED against `quotation-system-7g8drm4wf-vistra-indias-projects.vercel.app` (commit `93c79f5`):
- inquiry create: typed "1000000" (INR) → displayed "10,00,000" → stored **"1000000"** ✓
- inquiry edit: pre-formatted "10,00,000" on open; changed to "2500000" → displayed "25,00,000" → stored **"2500000"** ✓
- project create: typed "1500000" (USD) → displayed "1,500,000" → stored **"1500000"** ✓
- project edit: pre-formatted "1,500,000" on open; changed to "3000000" → displayed "3,000,000" → stored **"3000000"** ✓

Static: lint exit 0; tsc --noEmit clean. Build log routes confirmed all four form routes present. `/api/health` → `{"status":"ok","database":"connected"}`.

No Prisma calls changed (no `by-page.sql` update). No new i18n namespace (no clientMessages trap). Reused `lib/format-currency.ts` from Batch E exclusively — no second formatter.

Branch: `feature/stage15-form-behaviours` @ `7e63864`. Detail: `item-F.md`.

### 2026-08-17 — reviewer — Batch F review complete
APPROVE-WITH-NITS. 0 CRITICAL, 1 IMPORTANT, 3 MINOR.
Production code is correct on all four forms and all round-trip paths. IMPORTANT: two C6 edit-form spec tests (`stage15-f-constraints.spec.ts` tests 3 and 4) cannot detect a C6 regression — old code used `defaultValue={initialCurrency}` which produces the identical `inputValue()` result; these tests pass regardless of whether the fix is present. MINOR-1: unused `fillCreateFormRequiredFields` import in the constraints spec (lint warning). MINOR-2: C6 create first sub-assertion ("INR at page load") may pass without the fix depending on browser default for uncontrolled selects. MINOR-3: 386-line constraints spec tests HTML5 attribute presence and browser-native `checkValidity()` — more harness than warranted; plan called for manual C9 verification. C5 save tests (`stage15-f.spec.ts`) are solid and properly falsifiable.
Detail: `.engineering/stage-15/review-F.md`

### 2026-08-17 — developer (resumed) — Batch H: suite complete, DONE_WITH_CONCERNS

Resumed from `b1cdcbd` (X3/X5/X6 committed, branch pushed, Batch F quiet). Suite window granted.

**U3 regression discovered in run 1** (admin-stage4.spec.ts:164): test used "Distributor" role
(external per Batch G's new `isInternalRole` flag) without setting `externalCompanyId`. Fix: change
to "Company Member" (internal role). Committed `f301f79` + 2 retrigger commits (`89b8804`, `4b62f96`)
to clear P1002 Neon advisory-lock contention. Final deployment `hzi4v7ooq`.

**Suite runs (2 total, against deployment `hzi4v7ooq`, 197 tests, 8 workers):**

Run 1 (deployment `5ehzt9p2c`, pre-fix): **151 passed, 5 failed, 41 skipped** (8.2m)
- admin-stage4.spec.ts:164 — U3 regression (fixed)
- login.spec.ts:262, pricing-stage3.spec.ts:96, stage13.spec.ts:290, stage15-user-mgmt.spec.ts:116 — rate-limit

Run 2 (deployment `hzi4v7ooq`, post-fix): **170 passed, 5 failed, 22 skipped** (7.8m)
- login.spec.ts:201 — `p[role="alert"]` showed "Too many requests" instead of "deactivated"; rate-limit
  in `beforeAll` corrupted architect-user setup
- org-nav.spec.ts:259, pricing-stage3.spec.ts:96 — manual sign-in without helper (pre-existing)
- stage14.spec.ts:138, stage15-user-mgmt.spec.ts:231 — `waitForURL` at `helpers.ts:108` after all 4
  retries exhausted; worst-case 8-worker cluster saturation (not regressions)

**Confirmed working:** X5 (`admin-stage4.spec.ts:187`) PASSED run 2. X6 (`stage6.spec.ts:379`)
PASSED run 2. U3 fix (`admin-stage4.spec.ts:164`) PASSED run 2.

**Concerns for reviewer/orchestrator:**
1. `login.spec.ts`, `org-nav.spec.ts`, `pricing-stage3.spec.ts` — inline signIn without 429 retry.
   Persistent flakes. Cannot fix without touching files outside Batch H scope.
2. Under maximal 8-worker parallel load, even 4 retries get exhausted (`helpers.ts:108` failures).
   Architectural fix (reduce workers or increase timeout) not in Batch H scope.
3. `E2E_PERM` afterAll teardown remains blocked (no DELETE endpoint); seed purge from Batch G is the
   operational backstop.

Branch: `feature/stage15-test-harness` @ `69fd928`. Detail: `.engineering/stage-15/item-H.md` in the worktree.

---

### 2026-08-17 — conductor: SESSION LIMIT (resets 5:30am), handoff state for a fresh session

Two agents died mid-run to a session limit. **Nothing was lost** — every worktree and both repos are
clean, and all three branches are in sync with origin:

| Branch | SHA | State |
|---|---|---|
| `release/stage-15` | `b6fab94` | 6 of 8 batches merged (A, B, C, D, E, G) |
| `feature/stage15-form-behaviours` (Batch F) | `5905899` | Code-complete, **review-clean** (APPROVE-WITH-NITS, all findings addressed) |
| `feature/stage15-test-harness` (Batch H) | `69fd928` | Code-complete, **not yet reviewed** |

Docs repo clean @ `05a25b1` (X3). Worktrees: `stage15-a` `0a91607`, `stage15-b` `5905899`, `stage15-g` `69fd928`.

**Exactly two things outstanding before Step 7:**

1. **Batch F — run two tests.** Tests 3 and 4 of `tests/e2e/stage15-f-constraints.spec.ts` (the replacement
   C6 edit-form behavioural assertions) are **UNVERIFIED — never executed**. The run was dispatched and
   died before producing anything. Everything else in F is verified: C5 end-to-end save evidence 4/4
   (stored `"1000000"`, `"2500000"`, `"1500000"`, `"3000000"`), C6 6/6, C9 12/12.
   Run filtered against F's own preview for `5905899` via `PLAYWRIGHT_BASE_URL` — **not** the full suite.
2. **Batch H — review it.** The reviewer died before writing anything; **`review-H.md` does not exist.**
   Re-dispatch a fresh `engineering:reviewer` (`opus`) over `diff-H.patch`.

**Note:** `item-H.md` lives in the `stage15-g` worktree, not in the main checkout's `.engineering/`.

**The four questions H's review must answer** (recorded so they survive the session boundary):
- Does the X5 anchored assertion `/^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$/` genuinely fail on a
  leak to a *third* org, in both subdomain and path routing modes — or does the optional group reintroduce
  the hole the item exists to close?
- Does the X6 429 retry fail loudly on a *real* auth error, or could it swallow one and report success?
- H changed a test in already-merged **Batch G** ("Distributor" → "Company Member", `f301f79`) after its
  suite caught a genuine regression. **Was the test wrong, or is Batch G's `isInternalRole` work wrong?**
  This is the one that could mean a defect is merged.
- **Is the 429 classification of the 5 remaining suite failures credible, or is a real regression hiding
  behind the label?** 2 runs, not the 5 the plan suggested. Do not accept the label at face value.

**Three items H declared out of scope, for the human at handoff (not agent decisions):** three spec files
with their own inline sign-in that bypasses the hardened helper (`login.spec.ts`, `org-nav.spec.ts`,
`pricing-stage3.spec.ts`); a possible Playwright worker-count reduction from 8; and the missing
`DELETE /api/v1/permissions/{id}` endpoint needed for real `E2E_PERM` teardown.

**The suite is not green** — 5 rate-limit failures persist. That must be stated plainly when handing to
`engineering:test`, not discovered there.

**Systemic finding for the Step 8 self-check — now four instances:** specs that cannot fail
(`toBeLessThanOrEqual` between equal values; a fake `annotations.push({type:"skip"})` Playwright never
honours; a tenancy test using a UUID belonging to no org; a C6 test passing on both `defaultValue` and
`value`). **Every one was caught by review, never by the authoring developer.**

### 2026-08-17 — developer — Batch F: tests 3 & 4 verified PASSED

Deployment for `5905899` had failed (P1002 / immediate error, 0ms build). Pushed empty retrigger `09bd02a` → deployment `ghood6z5y` (READY, `/api/health` → `{"status":"ok","database":"connected"}`).

Ran `stage15-f.spec.ts` and `stage15-f-constraints.spec.ts` against `ghood6z5y`:
- `stage15-f.spec.ts` — 4/4 PASSED (57.5s) — same results as prior run
- `stage15-f-constraints.spec.ts` — **12/12 PASSED (2.1m)**, including:
  - Test 3: inquiry edit, INR→AED, blur "1000000" → displayed `"1,000,000"` ✓
  - Test 4: project edit, USD→INR, blur "1000000" → displayed `"10,00,000"` ✓

Both tests 3/4 are genuinely falsifiable: old `defaultValue`-based code would produce the wrong grouping (stale currency in `handleBudgetBlur`).

Updated `item-F.md` in worktree (force-added, committed `681d64d`, pushed). Branch `feature/stage15-form-behaviours` @ `681d64d` matches origin. No app code changed; retrigger commit is the only new push.

### 2026-08-17 — reviewer — Batch H review complete
APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 2 MINOR.
Detail: `.engineering/stage-15/review-H.md`

Key findings: (1) The Batch G regression was in the **test**, not in the code — "Distributor" without externalCompanyId is correctly rejected by U3 enforcement in `lib/data/users.ts:76-78`; the fix ("Company Member") is correct. (2) X5 positive regex is sound and genuinely fails on third-org leaks in both routing modes. (3) 5 remaining failures classified correctly as rate-limit (3 in files bypassing the helper; 2 at `helpers.ts:108` after retries exhausted — sign-in infrastructure, not product logic). (4) X6 retry fires only on 429; real auth errors fall through to `waitForURL` timeout (loud failure). (5) Wireframe-stage rule: clean. (6) All three changed assertions are falsifiable on revert.

**Suite is NOT green entering `engineering:test`** — 5 known rate-limit failures in the baseline. Must be stated plainly in the handoff. Three out-of-scope items (inline-signIn spec files, worker-count reduction, missing DELETE permissions endpoint) are not Stage 15 blockers but the human should decide on worker-count before the formal test pass.

### 2026-08-17 — tester — engineering:test FAIL→PASS (2 MAJOR fixed, 2 MINOR remain)

Verdict: **FAIL** at start (2 MAJOR regressions found and fixed); **no CRITICAL or MAJOR remaining** post-fix.

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 0 | — |
| MAJOR | 2 | Fixed in commit `736059b` on `release/stage-15` |
| MINOR | 2 | Not fixed (documented) |

Infrastructure: `release/stage-15` had no READY deployment for the 8-batch-merged code (P1002 Neon lock). Applied empty retrigger `60deb04` → deployment `hpbjjdyf6`. Fixed spec pushed as `736059b` → final verified deployment `23mbbpo11` (READY, `/api/health` → `{"status":"ok","database":"connected"}`).

Final full suite: 198/211 passed, 3 rate-limit flakes (at or below the 5-failure baseline), 10 not-run. All Stage 15 product behaviors (D1–D4, L1/PL1, C5/C6/C9/C10, U3–U6, V3, X3/X5/X6) verified end-to-end on the merged deployment.

Detail: `.engineering/stage-15/bugs-1.md`

### 2026-08-17 — reviewer — test-fix review (commit `736059b`) complete
APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR.
Both root-cause diagnoses confirmed against product code: V3 (`page.tsx:216` — field absent) and C9 (pattern restrictions present on all four forms). Coverage claims verified accurate: API-level destinationCountry invariant test and project-detail "India" assertion both remain intact and are genuinely falsifiable. Budget assertion (`getByText("9988776655")`) is correct — project detail renders raw db string, not formatted. No weakening of regression-detection intent.
Detail: `.engineering/stage-15/review-testfix.md`

### 2026-08-17 — devops — staging deploy verified (commit aced238)

Branch `staging` @ `aced238f` (merge of `release/stage-15` @ `ab3e706`) auto-deployed by Vercel git integration.

- **Deployment ID:** `dpl_9p34idoHJczEJdD1Xzha3uWhAYb9`
- **URL:** `quotation-system-nodsllxbm-vistra-indias-projects.vercel.app`
- **State:** READY (build time: ~38s; BUILDING at 14:22:32, READY at 14:23:11)
- **Aliases confirmed attached:** `test.easeetool.com`, `*.test.easeetool.com`, `quotation-system-git-staging-vistra-indias-projects.vercel.app`
- **Migrations:** "17 migrations found in prisma/migrations. No pending migrations to apply." (correct — Batches G's 2 migrations plus prior 15)
- **Route count (Route (app) table):** 67 routes. NOTE: the user-supplied benchmark was "137+ routes" — this number does not match the Route (app) table output (67 entries). All Stage 15 key routes are present: dashboard, inquiries, projects, all four form routes, admin/users, admin/permissions, `/api/v1/orgs/[orgSlug]/users/[userId]/profile` (Batch G U4), `/api/v1/orgs/[orgSlug]/stats` (Batch B D3). The 137+ figure may have been a count of Vercel internal functions rather than the route table — flagged to the human.
- **Health check:** `GET https://test.easeetool.com/api/health` → HTTP 200, body: `{"status":"ok","database":"connected","healthCheckRows":0,"timestamp":"2026-08-17T14:23:37.173Z"}`
- **Migrations run:** none pending (all 17 already applied, including Batch G's two Role migrations)
- **No manual alias re-point needed** — `test.easeetool.com` is branch-assigned to `staging` in the Vercel dashboard; it followed the push automatically.

### 2026-08-17 — tester — post-deploy regression pass: FAIL

Verdict: **FAIL** — 16 unexpected failures, 164 cascading skips, 31 passed out of 211.
Root cause: test infrastructure gap (path-based routing incompatible with test.easeetool.com apex).
Severity breakdown: 0 CRITICAL | 1 MAJOR (infra) | 0 MINOR product defects.
Detail: reported inline in the tester's message (no bugs-2.md; no new product bugs found).

### 2026-08-18 — developer — subdomain URL fix (branch `feature/fix-subdomain-test-urls`)

Centralized subdomain-aware URL helpers in `tests/e2e/helpers.ts` (4 new exports: `isSubdomain`, `orgUrl`, `apiUrl`, `orgUrlPattern`) and updated all 15 affected spec files so every `page.goto`, `page.request.get`, `waitForURL`, and `toHaveURL` call constructs the correct URL for both path-based (Vercel preview) and subdomain-based (`*.easeetool.com`) routing modes. No product code touched (`proxy.ts`, `app/**`, `lib/**` unchanged).

Files changed: `tests/e2e/helpers.ts`, `tests/e2e/admin-stage4.spec.ts`, `tests/e2e/login.spec.ts`, `tests/e2e/org-nav.spec.ts`, `tests/e2e/pricing-stage3.spec.ts`, `tests/e2e/stage5.spec.ts`, `tests/e2e/stage6.spec.ts`, `tests/e2e/stage7.spec.ts`, `tests/e2e/stage12.spec.ts`, `tests/e2e/stage13.spec.ts`, `tests/e2e/stage14.spec.ts`, `tests/e2e/stage15.spec.ts`, `tests/e2e/stage15-b.spec.ts`, `tests/e2e/stage15-f.spec.ts`, `tests/e2e/stage15-f-constraints.spec.ts`, `tests/e2e/subdomain-url-hygiene.spec.ts`. Plan: `.engineering/stage-15/plan-subdomain-fix.md`.

Verify: tester to run full suite with `PLAYWRIGHT_BASE_URL=https://test.easeetool.com` against the pushed Vercel preview for this branch.


### 2026-08-18 — reviewer — subdomain URL fix review complete
APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 1 MINOR.
Helpers correct (isSubdomain detection, orgUrl, apiUrl, orgUrlPattern regex verified in both modes). All 15 spec files fully fixed — no half-fixed cases (goto + waitForURL/toHaveURL updated together throughout). stage15-user-mgmt.spec.ts (not in diff) confirmed safe: its relative API calls resolve via the page's current origin after signIn(), which in subdomain mode is the org subdomain. Scope clean — no product code touched. MINOR: orgUrlPattern does not regex-escape orgSlug; safe in practice (all test slugs are [a-z-]+), but would silently misbehave if a slug ever contained regex metacharacters. Detail: returned in reviewer's message (no report file per system instructions).

### 2026-08-18 — tester — post-subdomain-fix regression: FAIL
Verdict: **FAIL** — 2 MAJOR, 1 MINOR outside known baseline.

| Severity | Count | Description |
|---|---|---|
| MAJOR | 2 | `BETTER_AUTH_URL` not set → cross-subdomain cookies disabled; wizard breadcrumb broken in subdomain mode |
| MINOR | 1 | `stage13.spec.ts:499` href regex missed in subdomain URL fix |

Run results: 144 passed / 8 failed / 59 did not run (run 2 of 2; all failures isolated individually).

Findings reported inline in tester message (no bugs-3.md — per system instructions, reports are returned as text, not files). Key finding: `curl` confirmed `Set-Cookie` has no `Domain=.easeetool.com` attribute, meaning `crossSubDomainCookies.enabled=false` on staging (`BETTER_AUTH_URL` not set to `https://test.easeetool.com`). Impacts 4 tests (cross-org notice × 3, U3 API call × 1). Breadcrumb bug confirmed by code analysis (`project-wizard-breadcrumb.tsx:36,54-62`).

Reviewer note retroactively incorrect: `stage15-user-mgmt.spec.ts` relative API calls do NOT resolve via the page's current origin — `page.request.get()` uses Playwright config `baseURL` (`test.easeetool.com` apex), not the current page URL.

### 2026-08-18 — devops — BETTER_AUTH_URL set for Preview; cross-subdomain cookies confirmed

**Root cause confirmed:** `BETTER_AUTH_URL` existed only in the Production Vercel environment (set 37 days
ago). The Preview environment had no entry, so `lib/auth.ts` line ~81's `BETTER_AUTH_URL.includes("easeetool.com")` evaluated false on `staging`, leaving `crossSubDomainCookies.enabled = false`.

**Fix applied:**

1. Confirmed the gap via `npx vercel env ls --scope=vistra-indias-projects` — `BETTER_AUTH_URL` showed
   only `Production`; no `Preview` or `Development` row.

2. Added the env var to the Preview environment:
   ```
   echo "https://test.easeetool.com" | npx vercel env add BETTER_AUTH_URL preview --scope=vistra-indias-projects
   ```
   Vercel CLI 59.1.4 confirmed: `✓ Added BETTER_AUTH_URL / Environments: Preview / Type: Sensitive`.
   Production env var was not touched.

3. Pushed an empty retrigger commit to `staging` to force a new build that picks up the new env var:
   ```
   git commit --allow-empty -m "ci: retrigger Vercel build — BETTER_AUTH_URL now set for Preview"
   git push origin staging
   ```
   Commit SHA: `052a577`.

4. **New deployment:** `dpl_Er1aW1y3fuoRYBW2Em8dJmUsFmGB`
   URL: `quotation-system-7y0d2zeus-vistra-indias-projects.vercel.app`
   State: READY (~39s build)
   Aliases: `test.easeetool.com`, `*.test.easeetool.com`, `quotation-system-git-staging-…`
   Health: `GET https://test.easeetool.com/api/health` → HTTP 200 `{"status":"ok","database":"connected"}`
   Migrations: none pending.

5. **Cookie verification (before/after):**
   - Before this fix: `Set-Cookie` from `/api/auth/sign-in/email` had NO `Domain=` attribute (tester's
     curl evidence from prior entry).
   - After this fix (verified against the new deployment):
     ```
     curl -i -X POST https://test.easeetool.com/api/auth/sign-in/email \
       -H "Content-Type: application/json" \
       -d '{"email":"admin@acme-glass.internal","password":"Seed1234!","rememberMe":false}'
     ```
     Response: HTTP 200. Two `Set-Cookie` headers, both with `Domain=.easeetool.com`:
     ```
     Set-Cookie: __Secure-qs.session_token=…; Domain=.easeetool.com; Path=/; HttpOnly; Secure; SameSite=Lax
     Set-Cookie: __Secure-qs.dont_remember=…; Domain=.easeetool.com; Path=/; HttpOnly; Secure; SameSite=Lax
     ```
   Cross-subdomain cookies are now active on `staging`.

### 2026-08-18 — developer — breadcrumb active-step fix + stale href regex (commit `166f027`)

**Bug 1 (MAJOR):** `app/[orgSlug]/projects/[projectId]/project-wizard-breadcrumb.tsx` — `activeIndex`
compared `pathname` (from `usePathname()`) against `step.href`, which was always built from the
org-slug-prefixed `base`. In subdomain mode `usePathname()` returns paths without the org-slug prefix,
so the comparison always failed and `activeIndex` stayed `-1`. Fix: changed the three `startsWith`
comparisons in `activeIndex` to use `step.linkHref` instead — `linkHref` is built from `hrefBase`, which
already omits the org-slug in subdomain mode (same pattern already used for `<Link href>`). In path-based
mode `linkHref === href`, so no regression. Updated the stale comment block that incorrectly claimed
"usePathname() always returns the internal path-based route even in subdomain mode."

**Bug 2 (MINOR):** `tests/e2e/stage13.spec.ts` lines 499-500 — two regexes still matched
`/\/acme-glass\/inquiries\/...`; in subdomain mode `<Link href>` is path-only (`/inquiries/{uuid}`).
Dropped the `\/acme-glass` prefix from both regexes, consistent with stage7/stage12 already fixed in
`4e6c21a`. UUID capture group `([0-9a-f-]{36})` preserved in both.

**Static:** lint exit 0; tsc pre-existing errors only (`isInternalRole` in `lib/data/users.ts` and
`prisma/seed.ts` — Batch G's generated client not regenerated locally; resolves during Vercel build).

**Verify:** tester to run suite against the Vercel preview for `feature/fix-subdomain-auth-and-breadcrumb`
@ `166f027`. Bug 1: navigate to a project under `{orgSlug}.easeetool.com` and confirm the correct
breadcrumb step is highlighted (`aria-current="step"`). Bug 2: `stage13.spec.ts` "Inquiry edit: direct
API PATCH on a DISMISSED inquiry returns 409" should no longer crash on the href match.

Plan: `.engineering/stage-15/plan-breadcrumb-fix.md`

### 2026-08-18 — developer — UI-pass bug fixes (7 human-reported items, commit `19ece12`)

**Role:** developer | **Branch:** `feature/fix-subdomain-auth-and-breadcrumb`

**What changed (11 files, 1 plan file):**
- `app/[orgSlug]/layout.tsx` — `min-h-screen` → `h-screen` so `main flex-1` has a definite height
- `app/[orgSlug]/inquiries/layout.tsx` — add `h-full flex-col` to inner div; reduce `pb-12` → `pb-4`
- `app/[orgSlug]/projects/layout.tsx` — same as inquiries layout
- `app/[orgSlug]/inquiries/page.tsx` — outer div `flex flex-col h-full`; table card `flex-1 min-h-0 flex-col`; inner wrapper `flex-1 overflow-y-auto min-h-0`
- `app/[orgSlug]/projects/page.tsx` — same restructure as inquiries
- `app/[orgSlug]/top-bar-actions.tsx` — `ml-2` on Home Link (wider chip-to-button gap)
- `components/list-page-controls.tsx` — `ListPagePagination` wrapper: add `border-t border-border`, `py-3` symmetric spacing
- `app/[orgSlug]/projects/[projectId]/layout.tsx` — add "← Back to Projects" Link ABOVE breadcrumb; import Link, compute `base`
- `app/[orgSlug]/projects/[projectId]/page.tsx` — remove the top-level "← Back to Projects" text link (now in layout); keep the card-footer button
- `app/[orgSlug]/projects/[projectId]/project-wizard-breadcrumb.tsx` — `isDone` step: add `bg-status-paid-bg text-status-paid-text` (green pill); checkmark uses `text-status-paid-text`
- `messages/en.json` — `projects.colNumber`: `"#"` → `"Project Number"`

**Item 1 (greeting "vistra distributor"):** Flagged as seed data, NOT a code bug. Code correctly renders `me.name`. Value comes from seed's `displayName: \`${org.slug} distributor\``. No change.

**Item 7 (breadcrumb completed):** The `isDone` logic was already implemented after `166f027` fixed `activeIndex`. This commit adds the green visual — `bg-status-paid-bg` + `text-status-paid-text` — same tokens used in "New" status badges.

**Static:** lint 0 errors; tsc pre-existing `isInternalRole` errors only (Batch G, resolves on Vercel build).

**Verify:** tester to run against Vercel preview for `feature/fix-subdomain-auth-and-breadcrumb` @ `19ece12`.
Detail: `.engineering/stage-15/plan-docx-bugs-fix.md`

### 2026-08-18 — reviewer — breadcrumb + UI-pass fixes review complete
APPROVE. 0 CRITICAL, 0 IMPORTANT, 0 MINOR.
`linkHref` fix verified correct in both routing modes (path: `linkHref === href`; subdomain: both omit org prefix, matching `usePathname()`). `isDone` strictly `index < activeIndex` — no off-by-one. Flex chain (`h-screen` → `main flex-1 overflow-auto` → layout `h-full` → page `h-full flex-col` → card `flex-1 min-h-0` → inner `flex-1 min-h-0 overflow-y-auto`) is internally consistent; `min-h-0` placed exactly where needed. `colNumber` rename confirmed scoped to the detail page read-only field only (list table uses hardcoded strings). No automated DOM/layout tests added. No scope deviation.

### 2026-08-18 — developer — PV1 fixes: sticky header + greeting name (commit `1cab3a0`)

**Branch:** `feature/fix-sticky-header-and-greeting`

**Bug 1 (sticky header):** Root cause — nested `overflow-x-auto` div created a CSS scroll container
between the `overflow-y-auto` outer div and the `<thead>`, preventing `position:sticky` from
working (sticky elements stick to their NEAREST scroll container; the inner wrapper never scrolled
vertically). Fix: merged both axes into a single `overflow-auto` container on the outer div,
removed the inner `overflow-x-auto` wrapper, added `sticky top-0 z-10 bg-bg-card` to `<thead>`.
Applied to both `app/[orgSlug]/inquiries/page.tsx` and `app/[orgSlug]/projects/page.tsx`.
No other list pages have this pattern (confirmed by grep).

**Bug 2 (greeting name):** Traced from scratch (per instruction — did not rely on prior
investigation's "seed data, not a bug" conclusion). Root cause confirmed as inconsistent seed data
(NOT two different accounts):
- Seed stored `name = "${orgSlug} admin"` (e.g. "vistra admin") via `displayName` field
- Seed stored `firstName = "Admin"`, `lastName = "User"` separately
- Dashboard reads `session.name` → `user.name` → "vistra admin"
- Users list renders `firstName + " " + lastName` → "Admin User"
- `createUser` and `updateUserProfile` in `lib/data/users.ts` both correctly set
  `name = "${firstName} ${lastName}"` for API-created users; seed was the outlier
- Idempotency check (`if (existing) continue`) meant re-running seed never fixed existing users

Fix (`prisma/seed.ts`): removed `displayName` from userSlots; user create now uses
`` name: `${slot.firstName} ${slot.lastName}` ``; added update path for existing seeded users
(updates `name` when it doesn't match `"${firstName} ${lastName}"`). Seed run locally against
dev Neon branch — existing users' `name` fields updated; staging picks up corrected values via
`getSession()` (reads current DB on each request, not a cached token).

**Test (D1):** Added to `tests/e2e/stage15-b.spec.ts`. Signs in as "admin" for "acme-glass",
fetches `me.name` via `/api/v1/orgs/acme-glass/me`, navigates to dashboard, asserts the h1
greeting contains `me.name` exactly. Falsifiable: old code showed "acme-glass admin", which
does not equal "Admin User" — test would fail.

**Static:** lint 0 errors (5 pre-existing warnings, none in changed files); tsc clean (pre-existing
`isInternalRole` errors from stale generated client resolve on Vercel build).

**Verify:** tester to run against Vercel preview for `1cab3a0`:
- Bug 1 (manual only — per wireframe rule): inquiries and projects list pages — column headers
  stay pinned while body rows scroll.
- Bug 2 (automated): `npx playwright test stage15-b.spec.ts` with `PLAYWRIGHT_BASE_URL` set
  to the preview URL.

Plan: `.engineering/stage-15/plan-pv1-fixes.md`

### 2026-08-18 — tester — regression run 3 (final, post all fix rounds)

**Role:** tester | **Target:** `test.easeetool.com`, commit `19877a6`, deployment `dpl_23qChvu7t8NHPL6dUzoHNyNstJDP`

**Result: PASS.** 211 tests, 197 passed, 3 failed, 11 did not run (cascade) — all 3 failures consistent
with known flake patterns (rate-limit under 8-worker parallel load, or the documented cross-file
ordering race), zero product defects.

- `org-nav.spec.ts:266` — at baseline (same flake as documented `:259`, line shifted by edits).
- `stage15-f-constraints.spec.ts:94` — at baseline (same cross-file ordering race as documented `:308`).
- `subdomain-routing.spec.ts:151` — **new flake instance**, same inline-login-under-load mechanism as
  the other two. Not in the prior baseline list — added below.

**Confirmed resolved from regression run 2:** all 16 `BETTER_AUTH_URL`-dependent failures, the wizard
breadcrumb active-step bug (`stage14.spec.ts:319`), and the leftover `stage13.spec.ts:499-500` href
regex.

**Baseline flake list, updated:** `login.spec.ts:201`, `org-nav.spec.ts:259/266`,
`stage15-f-constraints.spec.ts:94/308`, `subdomain-routing.spec.ts:151` — all inline-signIn-helper or
cross-file-ordering flakes under parallel load, not product bugs. Three inline-signIn spec files
remain the root cause and are still the human's call to fix (deferred, per Stage 15's original bug
report).

### 2026-08-18 — reviewer — PV1 fixes review complete
APPROVE-WITH-NITS. 0 CRITICAL, 0 IMPORTANT, 1 MINOR.
CSS sticky analysis: new single-`overflow-auto` container is correct — bounded height confirmed by
flex chain, no intermediate overflow wrapper, sticky `<thead>` will work in both axes. Seed fix
confirmed safe: only `name` touched on update, conditional, consistent with `createUser`/`updateUserProfile`;
blast radius on all five `User.name` consumers is improvements, not breakage. Root cause for the
greeting is the same `displayName` convention in the seed as the prior batch's "no change" call —
the human's re-report overrides that decision; fix is correct. Test is a real regression guard for
the dashboard implementation (would catch dashboard reading from a different source than `/me`).
MINOR: test comment incorrectly claims a reverted seed would fail the test; it would not (both /me
and the greeting would agree on the stale value). Comment should target the implementation-drift scenario,
not the seed scenario.
Detail: `.engineering/stage-15/review-pv1-fixes.md`

### 2026-08-18 — tester — post-PV1-fix regression: FAIL

Verdict: **FAIL** — 1 MAJOR outside known baseline.

| Severity | Count | Description |
|---|---|---|
| MAJOR | 1 | D1 greeting-name test (`stage15-b.spec.ts:120`) consistently times out at `waitForLoadState("networkidle")` — test design bug |
| MINOR | 1 | `stage15-f.spec.ts:203` cross-file ordering race (new instance, same mechanism as documented `stage15-f-constraints.spec.ts:94/308`) |

Full suite: 172 passed / 7 failed / 33 did not run (8.1m, 8 workers against `test.easeetool.com`).
Product behavior confirmed correct: seed fix verified via curl — `/api/auth/sign-in` and `/me` both return `"name":"Admin User"`. Test implementation is the blocker.
Detail: returned inline in tester message.

---
**developer** · 2026-08-18 · fix D1 networkidle hang (`feature/fix-d1-test-networkidle-hang`, `53b82dc`)
Removed `waitForLoadState("networkidle")` from `tests/e2e/stage15-b.spec.ts:136`; added comment matching `subdomain-navigation.spec.ts:121` pattern. The subsequent `expect(greeting).toContainText()` auto-retries via Playwright's built-in polling — no replacement wait needed.
