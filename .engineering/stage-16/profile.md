# Stage 16 — project profile (shared brief)

Written at `engineering:stage-prep`, 2026-09-02. **Read this instead of re-discovering the project.**
`implement`, `test` and `deploy` all reuse it.

---

## Approved stage target

`quotation-system-docs/development-cycles/stage-16.md` — **SuperAdmin / Platform-Level Controls**,
6 batches (A–F), ~35–45h, approved by the human at GATE 0 on 2026-09-02.

Supporting material (this directory):
- `superadmin-brief.md` — the original 2026-08-14 pre-scope brief (decisions locked with the human,
  verified ground truth about the schema/proxy at that time, the open questions stage-16.md resolves).

**Open questions resolved this session** (recorded in `stage-16.md`'s "Decisions locked at scoping"
table): dashboard scope = org list + roles/permissions console + create org + suspend/reactivate;
audit logging = yes, lightweight append-only, no UI; org-admin roles/permissions visibility = removed
entirely (no read-only fallback); SuperAdmin role model = flat, all equal; impersonation = out; 2FA/rate
limiting = deferred; app-wide loading indicator = deferred to its own stage.

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
- **better-auth** — username + password. Org users are keyed by a synthetic email
  `{username}@{orgSlug}.internal`. This stage adds a second identity shape,
  `{username}@platform.internal`, for the 3 SuperAdmin accounts — same better-auth instance, separate
  `SuperAdmin` table (not `User`). `platform` must be reserved so it can never be a real org slug.
  **Rate limit: 3 sign-ins per 10 s per IP** on the existing tenant login — E2E specs pace with a 7 s
  `beforeEach`; the SuperAdmin login is not required to add a distinct rate limit this stage (deferred).
- **Tailwind v4** via `@tailwindcss/postcss`. Design system: **Sage Ease** tokens.
- **next-intl** for i18n. Routing: **subdomain-based** — `{orgSlug}.easeetool.com`, resolved in
  `proxy.ts` (a proxy, **not** middleware). `proxy.ts` currently **hard-404s every non-root path on apex
  hosts** (BUG-3 guard, `bugs-2.md`, 2026-07-23) — `/controls` needs an explicit carve-out **before**
  that guard fires.
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
migration. There is no separate reviewable migration step. This stage adds **two new migrations**
(`SuperAdmin`, `SuperAdminAuditLog` + `isSuspended` on `Organization`).

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
- **`test.easeetool.com` serves the *previous* deployment until the new one is ready.** Poll the
  **per-deployment URL**, or check state by commit SHA.

---

## Health endpoint

`GET /api/health` → 200 with `{"status":"ok","database":"connected",...}`.

---

## Ops prerequisite — not yet done

Before **Batch A** can be deployed and seeded on *any* environment (dev/preview/production), the human
must set three env vars in Vercel (Production, Preview, and Development): `SUPERADMIN_DEVADMIN_PASSWORD`,
`SUPERADMIN_ISHAN_PASSWORD`, `SUPERADMIN_SHAJI_PASSWORD`. The human approved this stage's scope
2026-09-02 but deferred setting these — **confirm they're set before running the seed against any
non-local environment**; if they're missing, stop and ask rather than guessing at bootstrap credentials.

---

## Key routes for this stage

| Route | Feature |
|---|---|
| `/controls/login` | F1 — SuperAdmin login |
| `/controls/orgs` | F2 — org list (read), F5 — suspend/reactivate |
| `/controls/orgs/new` | F4 — create org |
| `/controls/roles` | F3 — roles/permissions console with org picker |
| `app/[orgSlug]/admin/roles/**`, `app/[orgSlug]/admin/permissions/**` | F6 — deleted (moved to `/controls`) |

---

## Architecture rules that constrain this stage

1. **Tenancy is lint-enforced.** All existing DB access goes through `lib/data/*.ts`, which requires an
   `organizationId` filter — **do not weaken this rule**. SuperAdmin cross-org reads go through a new,
   separate `lib/data/superadmin/` directory, explicitly carved out of the lint rule's scope (not a
   relaxation of it). Functions there intentionally omit `organizationId` and should carry a
   `// superadmin-only — intentionally cross-org` comment.
2. **`requireSuperAdmin()`** is the new guard, analogous to the existing `requirePermission()`. SuperAdmin
   API routes live under `app/api/v1/superadmin/**`.
3. **UI/API separation (Stage 12).** Pages don't touch Prisma directly; they call `app/api/v1/**` route
   handlers via `lib/internal-fetch.ts` (cookie-forwarded). Follow this pattern for the new SuperAdmin
   routes too.
4. **`orgHref` / `useOrgHref` (Stage 11).** Never hand-build org URLs — subdomain vs path mode differ.
   Not directly relevant to `/controls` (apex-only, no org context) but keep in mind for the org-picker
   linking back into org-scoped views if any are added.
5. **next-intl `clientMessages` trap (`AGENTS.md`).** If a client component calls `useTranslations(ns)`
   and `ns` isn't a key in the nearest ancestor layout's `clientMessages`, next-intl throws **on
   hydrate** — no build error, no lint error, no TS error, component silently inert. Grep the layout;
   don't trust that it compiles.
6. **Keep the SQL mirror current.** Any added/changed/removed `prisma.<model>.<method>` call in
   `app/**` or `lib/**` must be reflected in
   `quotation-system-docs/design-docs/sql-queries/by-page.sql` **in the same change** — this stage adds
   several new query shapes (`SuperAdmin`, `SuperAdminAuditLog`, cross-org `Organization`/`Role` reads).
7. **SuperAdmin session must not bleed into org subdomains.** Session cookie scoped to the apex domain
   only (`easeetool.com`, not `*.easeetool.com`). The two identity types (`User` sessions, `SuperAdmin`
   sessions) don't share a session namespace.

---

## Testing strategy

**UI is wireframe-stage.** Committed automated tests must **not** assert on DOM structure, layout, copy
or styling. Visual/structural checks are done **manually per batch and reported as such**, never
skipped.

Automate only behaviour-level invariants — see `stage-16.md`'s "Testing posture" section for the full
per-batch list (guard-gate checks, session-scoping checks, tenancy-isolation checks on org create/role
mutation, suspended-org blocking, route removal/redirect on Batch F). Run the **whole committed E2E
suite** after Batch F, per the Stage 15 post-mortem's standing rule — this stage touches shared routing
(`proxy.ts`) and removes existing admin routes, both regression-prone.

---

## Branch & deploy

- **Stage branch:** `release/stage-16`, cut from **`master`** at `e7adb00` (staging and master were in
  sync at the time of cutting — Stage 15 was the last thing promoted, 2026-08-18).
- **Batches A–F:** `feature/<description>` off `release/stage-16` → push → verify on its own preview →
  review → merge back. **Batch A must be reviewed and merged before B–F begin** (highest-security-risk
  batch — auth/session/routing/data-path foundation). C, D, E may run in parallel after B merges. F waits
  for D.
- **Stage end:** `release/stage-16` → `staging` (auto-deploys `test.easeetool.com`) → formal
  `engineering:test` pass there.
- **Production:** requires the human's **explicit approval at the time of the merge**. Prior approval
  never carries over. CLI deploys are not permitted; merging is deploying.

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

## After this stage

Stage 17 (intake field-requiredness fixes + Configuration-page restyle) is separately spec'd
(`stage-17.md`, 2026-09-02) and unrelated to Stage 16 — order between them is the human's call, not
fixed by dependency.
