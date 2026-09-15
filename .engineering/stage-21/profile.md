# Stage 21 — project profile (shared brief)

Written at `engineering:implement` start, 2026-09-15. **Read this instead of re-discovering the
project.** `implement`, `test`, and `deploy` all reuse it. Stack/commands/environments carried forward
unchanged from Stage 20's `profile.md` (same repo, same facts) — only the approved target, testing
posture, and branch/deploy sections are new (rule 5 is lifted this stage — see Testing posture).

---

## Approved stage target

`quotation-system-docs/development-cycles/stage-21/stage-21.md` — **Design page mockup parity**, status
📝 Spec'd (approved via `engineering:stage-prep`, architect-consulted across two brainstorm rounds,
2026-09-15). **Read `stage-21.md` in full before starting any track** — it carries the Scope, Deviations
register, Open Items, and Follow-ups. Per-track ticket detail (Jira-style, with steps/AC/QA per task) is
split into separate files, **not duplicated here** — read only the file(s) for the track being worked:

- `quotation-system-docs/development-cycles/stage-21/tasks/track-0-foundation.md` — S21-0.1..0.6
- `.../tasks/track-a-left-rail.md` — S21-A1..A4
- `.../tasks/track-b-layout-mode.md` — S21-B1..B2
- `.../tasks/track-c-right-rail.md` — S21-C1..C3
- `.../tasks/track-d-configure-mode.md` — S21-D1..D4
- `.../tasks/qa-tasks.md` — S21-Q1..Q3 (for `engineering:test`, not implement)

Also read `quotation-system-docs/design-docs/04-data-model.md` (v1 `Partition.design.panels[]` shape,
`Room.sides[]`) and the mockup itself,
`quotation-system-docs/ui-mockups/finalized/design-page.html` (2145 lines — the literal fidelity target;
every visual/interaction question resolves by reading it, not by guessing).

**One-line scope summary:** rebuild the Design page (`app/[orgSlug]/projects/[projectId]/design/`) to
100% visual/UX parity with the mockup, on the existing live v1 `panels[]` data shape (v2 grid model
deferred), switching from immediate-write mutations to a draft-then-Save model, folding the separate
`/design/add-wall` route inline, and removing the unit toggle + Exclude/Include panel feature + the
edge-profile editor per the Deviations register (D-2, D-4, D-5).

**This is the large + splittable tier.** Track structure (full detail in `stage-21.md`):

```
Track 0 (foundation, solo, HARD GATE — nothing else starts until reviewed+merged)
   |
   +---> Track A (left rail)      \
   +---> Track B (layout mode)     |  concurrent, disjoint files (mostly —
   +---> Track C (right rail)      |  see file-ownership notes below)
   +---> Track D (configure mode) /   D1-D4 are serial within Track D
```

**Devs may reach out to the architect if unclear on task execution** (per this run's explicit
instruction) — route via Step 5's consult path (Mode C, `NEEDS_ARCHITECT`) rather than guessing or
silently narrowing scope. Each task file already carries a Mockup-ref (line numbers) precisely so a dev
can verify against the source instead of asking — check that first.

**Known file-ownership overlaps to resolve before dispatch:**
- `design/layout-mode-panel.tsx`'s right-rail branch is shared between Track B's B2 and Track C's C1 —
  assign both to the same developer, or split the file cleanly, before parallel dispatch.
- Track 0's `design-workspace.tsx` is Track 0's **exclusive** property. Tracks A–D may only *append* new
  reducer action cases to the frozen action list Track 0 ships — never edit or restructure the file
  itself. Flag any task that seems to need more than an append as a deviation → GATE A/C, not a silent
  workaround.

**Pressure valve if the stage runs long:** none specified in the stage doc beyond the existing
Deviations register — the register already trims the riskiest/most speculative scope (N-sided polish,
Exclude/Include, unit toggle, edge-profile editor). If more trimming is needed, that's a new deviation —
GATE A, human call, not a developer's discretion.

---

## Repo layout

Two sibling git repos under `d:\projects\vistra\` (not itself a repo):

| Path | What |
|---|---|
| `quotation-system/` | The Next.js 16 app — all code changes |
| `quotation-system-docs/` | Product/design docs — source of truth; stage files, design-docs, mockups |

Commit within whichever repo you changed. Docs come first when a design changes.

---

## Stack

- **Next.js 16**, App Router, React Server Components. **Read `node_modules/next/dist/docs/` before
  writing Next code** — v16 has breaking changes vs. training data (`AGENTS.md`).
- **Prisma 7** with the `prisma-client` generator + driver adapters (`@prisma/adapter-pg`). No bundled
  query engine. Client generates into `app/generated/prisma/` and is **gitignored**. Config in
  `prisma.config.ts`. **No new migration expected this stage** — Stage 21 is UI/client-state rebuild on
  the existing v1 `Partition.design` JSONB shape; if a task turns out to need a schema change, that's a
  deviation (GATE A), not routine work.
- **better-auth** — username + password.
- **Tailwind v4** via `@tailwindcss/postcss`. Design tokens: **Sage Ease** (`app/globals.css` `@theme`
  block) — Track 0's S21-0.1 maps these against the mockup's own `:root` CSS vars; every other track
  consumes the reconciled tokens, doesn't invent new ones.
- **next-intl** for i18n.
- **Playwright** for E2E (`tests/e2e/`), driven by `PLAYWRIGHT_BASE_URL`.
- **Node ≥ 22.12 required.**

---

## Commands

Run from inside `quotation-system/`.

```bash
npm run lint                 # eslint (flat config, eslint.config.mjs) — OK locally
npx tsc --noEmit             # typecheck — OK locally
npm run build                # prisma generate && next build
npm run test:e2e             # playwright — MUST target a deployed preview
```

---

## THE HARD RULE — no local testing, ever

**No local dev server, no local build, no local DB for *app behavior* verification.** Every functional
check runs against **the pushed branch's own Vercel preview**. This applies to the developer during
implement *and* the tester during test/regression. No exceptions. `npm run lint` / `npx tsc --noEmit` are
the only local exceptions.

**The pattern:** commit → push the branch → poll Vercel until the deployment for that commit SHA is
`READY` → verify against that preview URL. Check the build log's route list — `READY` + HTTP 200 is not
proof of a good build.

---

## Health endpoint

`GET /api/health` → 200 with `{"status":"ok","database":"connected",...}`.

---

## Testing posture — rule 5 is LIFTED for this stage's Design-page scope

Unlike every prior stage's profile, **DOM/style/layout test assertions are permitted here** —
`d:/projects/vistra/CLAUDE.md` rule 5 was lifted globally 2026-09-15, and Stage 21 (`qa-tasks.md`,
S21-Q3) is the first stage to actually write them, scoped to the Design page only. Developers may still
write light DOM/style assertions inline if natural, but the **formal automated suite is
`engineering:test`'s job** (S21-Q3), not implement's — implement's dev↔reviewer loop should prioritize:
1. **Behavioral correctness first**, always, regardless of rule 5: draft isolation (no network write
   before Save), Save/Discard round-trip, tenancy, RBAC, and — the stage's single highest-risk item —
   `sum(panel widths) === Partition.widthMm` held exactly (not approximately) across repeated
   width-changing operations (rescale, split, unite, apply-width, standard-width buttons), not just a
   single operation in isolation.
2. Visual/structural parity against the mockup is judged by **Visual QA** checklists inline in each task
   file — a reviewer eyeballing the branch's Vercel preview against `design-page.html`, not an automated
   assertion, during implement. The automated pass comes later, in test.

---

## Branch & deploy

- **Stage branch:** `release/stage-21`, cut from `master` @ `7e47da4` (2026-09-15) — the standing
  `staging`≠`master` exception from Stages 19/20 was lifted once those promoted together (see workspace
  `CLAUDE.md`), so this stage cuts from `master` per the normal rule. Already checked out, clean.
- **Feature branches:** `feature/<description>` off `release/stage-21` → push → verify on that branch's
  own Vercel preview → review → merge back to `release/stage-21`. Given the large+splittable tier, each
  track's tasks use `feature/s21-<track><n>-<description>` naming (e.g. `feature/s21-01-token-mapping`)
  so branch names sort/scan cleanly against the task IDs in the task files.
- **Stage end:** `release/stage-21` → `staging` → `test.easeetool.com` auto-follows → formal
  `engineering:test` pass (runs `qa-tasks.md`).
- **Production:** requires the human's explicit approval at the time of the merge. Prior approval never
  carries over.

---

## Environments

| Env | DB (Neon branch) | Notes |
|---|---|---|
| Local / Vercel Preview / Development | dev branch `ep-dark-term-ai0ufj4k` | No local Postgres. Shared by every preview. |
| Vercel Production | main branch `ep-little-paper-aipm0o0i` | Not touched this stage (production promotion out of scope until test/deploy sign off). |

**Vercel:** projectId `prj_wGDCFOUsNhc0HMoVux60Fdiy6JXL`, teamId `team_N4SM98fg6Eb7mSISlFOsAwZ0`.

**Known transient failure:** `P1002 — timed out acquiring a postgres advisory lock` during builds on the
dev Neon branch. Remedy: an empty `ci: retrigger Vercel build` commit.
