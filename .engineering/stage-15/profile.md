# Stage 15 — project profile (shared brief)

Written at `engineering:stage-prep`, 2026-08-14. **Read this instead of re-discovering the project.**
`implement`, `test` and `deploy` all reuse it.

---

## Approved stage target

`quotation-system-docs/development-cycles/stage-15.md` — **Bug Fix Sweep**, 37 items, 8 batches,
approved by the human at GATE 0 on 2026-08-14.

Supporting material (this directory):
- `bugs-inbox.md` — the raw human bug list with stable IDs (D1…X7). **IDs are the shared vocabulary.**
- `architect-scoping.md` — per-item grounding against the code, classification, hidden-scope callouts.

---

## Repo layout

Two sibling git repos under `d:\projects\vistra\` (which is **not** itself a repo):

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
  query engine. Client generates into `app/generated/prisma/` and is **gitignored** — regenerated on
  every install/deploy. Config in `prisma.config.ts`, not `package.json`.
- **better-auth** — username + password. Users keyed by a synthetic email
  `{username}@{orgSlug}.internal`. **Rate limit: 3 sign-ins per 10 s per IP** — E2E specs pace with a 7 s
  `beforeEach`.
- **Tailwind v4** via `@tailwindcss/postcss`. Design system: **Sage Ease** tokens.
- **next-intl** for i18n. Routing: **subdomain-based** — `{orgSlug}.easeetool.com`, resolved in
  `proxy.ts` (a proxy, **not** middleware).
- **Playwright** for E2E (`tests/e2e/`), driven by `PLAYWRIGHT_BASE_URL`.
- **Node ≥ 22.12 required.**

---

## Commands

Run from inside `quotation-system/`.

```bash
npm run lint                 # eslint — OK locally
npx tsc --noEmit             # typecheck — OK locally
npm run build                # prisma generate && prisma migrate deploy && next build
npx prisma migrate dev       # create/apply a migration against the dev Neon branch
npx prisma generate          # after editing schema.prisma
npm run test:e2e             # playwright — MUST target a deployed preview
```

**`build` runs `prisma migrate deploy`.** Merging to `master` therefore *is* running the production
migration. There is no separate reviewable migration step.

---

## THE HARD RULE — no local testing, ever

**No local dev server, no local build, no local DB.** Every functional check runs against **the pushed
branch's own Vercel preview**. This applies to the developer during implement *and* the tester during
test/regression. No exceptions.

The only things that may run locally: `npm run lint` and `npx tsc --noEmit` (static, no server, no DB).

**The pattern:** commit → push the branch → poll Vercel until the deployment for **that commit SHA** is
`READY` → run everything against that preview URL via `PLAYWRIGHT_BASE_URL`.

**Two traps that have cost real time here:**
- `state: READY` + HTTP 200 is **not** proof of a good build. Check the build log's route list.
- **`test.easeetool.com` serves the *previous* deployment until the new one is ready.** Polling it for
  health returns a false positive. Poll the **per-deployment URL**, or check state by commit SHA.

---

## Health endpoint

`GET /api/health` → 200 with `{"status":"ok","database":"connected",...}`. A 200 *plus*
`database: "connected"` proves the full app→Prisma→Neon chain.

---

## Key routes for this stage

| Route | Items |
|---|---|
| `/{orgSlug}/dashboard` | D1, D2, D3, D4 |
| `/{orgSlug}/inquiries` · `/projects` | L1, L2, L3, PL1 |
| `/{orgSlug}/inquiries/new` · `/projects/new` | C1–C10, PC1, PC2 |
| `/{orgSlug}/inquiries/{id}/edit` · `/projects/{id}/edit` | C1–C10 mirrors, X1, X2 |
| `/{orgSlug}/inquiries/{id}` | V1–V5 |
| `/{orgSlug}/projects/{id}` | PV1 (verify-only) |
| `/{orgSlug}/admin/users` · `/users/{id}` · `/users/new` | U1–U5 |
| `/{orgSlug}/admin/permissions` | U6 |

---

## Architecture rules that constrain this stage

1. **Tenancy is lint-enforced.** All DB access goes through `lib/data/*.ts`, which requires an
   `organizationId` filter. Do not weaken this. D3 changes *scoping within* an org — it must not become
   a hole.
2. **UI/API separation (Stage 12).** Pages don't touch Prisma directly; they call
   `app/api/v1/**` route handlers via `lib/internal-fetch.ts` (cookie-forwarded). U4's new profile
   endpoint follows this pattern.
3. **`orgHref` / `useOrgHref` (Stage 11).** Never hand-build org URLs — subdomain vs path mode differ.
4. **next-intl `clientMessages` trap (`AGENTS.md`).** If a client component calls
   `useTranslations(ns)` and `ns` isn't a key in the nearest ancestor layout's `clientMessages`,
   next-intl throws **on hydrate** — no build error, no lint error, no TS error, component silently
   inert. This shipped to production once. **Grep the layout; don't trust that it compiles.**
5. **Keep the SQL mirror current.** Any added/changed/removed `prisma.<model>.<method>` call in
   `app/**` or `lib/**` must be reflected in
   `quotation-system-docs/design-docs/sql-queries/by-page.sql` **in the same change**.

---

## Testing strategy

**UI is wireframe-stage.** Committed automated tests must **not** assert on DOM structure, layout, copy
or styling — that churns on every redesign. Visual/structural checks are done **manually per batch and
reported as such**, never skipped.

Automate only behaviour-level invariants that survive a redesign: tenancy isolation, RBAC/auth gates,
data correctness after a mutation, error paths. For this stage: **D3** (tenancy-adjacent), **U3**,
**U4**, **L1/PL1** pagination boundaries, **X5**.

**Process rule from Stage 14's post-mortem — applies directly here:** this stage changes *shared* UI
across four forms and every list page. **Run the whole committed suite, not just new specs.** Stage 14
didn't, and regression found 8 stale spec files after the deploy.

Known live flakes (being fixed as X6): `stage6.spec.ts:379` and `helpers.ts:34` (`signIn`), each ~1-in-15
on full serial runs. Isolate before calling a failure real.

---

## Branch & deploy

- **Stage branch:** `release/stage-15`, cut from **`staging`** at `5b9338d` and pushed.
  **Not from `master`** — `master` is 52 commits behind (Stages 13 + 14 are unpromoted).
- **Per batch:** `feature/<description>` off `release/stage-15` → push → verify on its own preview →
  review → merge back to `release/stage-15`.
- **Stage end:** `release/stage-15` → `staging` (auto-deploys `test.easeetool.com`, branch-assigned so
  no manual alias re-point) → formal `engineering:test` pass there.
- **Production:** Stages 13, 14 and 15 promote to `master` **together**, requiring the human's
  **explicit approval at the time of the merge**. Prior approval never carries over. CLI deploys are not
  permitted; merging is deploying.

---

## Environments

| Env | DB (Neon branch) | Notes |
|---|---|---|
| Local / Vercel Preview / Development | dev branch `ep-dark-term-ai0ufj4k` | Local `.env` talks to this directly — there is no local Postgres |
| Vercel Production | main branch `ep-little-paper-aipm0o0i` | No real users, no real data — may be reset |

**Vercel:** projectId `prj_wGDCFOUsNhc0HMoVux60Fdiy6JXL`, teamId `team_N4SM98fg6Eb7mSISlFOsAwZ0`.

**Known transient failure:** `P1002 — timed out acquiring a postgres advisory lock` during
`prisma migrate deploy`, caused by concurrent builds contending on the shared dev DB. Established
remedy: an empty `ci: retrigger Vercel build` commit.

---

## Next stage, already agreed in direction

**Stage 16 — SuperAdmin / platform controls** (`easeetool.com/controls`). Pre-scope brief at
`.engineering/stage-16/superadmin-brief.md`. Not part of Stage 15; checked for rework overlap — none.
