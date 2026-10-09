# Regression suite (`tests/regression/`)

Live API + UI regression of every route and page, run against `test.easeetool.com` or a branch preview. Spec: `quotation-system-docs/development-cycles/regression-suite/regression-suite.md`.

## Run
- `npm run test:regression` — the official run: coverage map → unit tests → Playwright (failed tests re-run once at `--workers=1`; a cleanup failure is never retried) → report. When the first pass fails, the script prints **"pass 1 of 2 failed — automatic serial re-run (--workers=1) follows; do NOT start another run"** before the retry; the final `REGRESSION PASS`/`REGRESSION FAIL` banner is the only definitive verdict.
- `npm run test:regression:coverage` — static check only: every API route/page has a `covers()`/`coversPage()` and no test points at one that no longer exists.
- `npm run test:regression:affected` — run only the specs relevant to files changed since `origin/master` (default base). Maps changed `app/api/**/route.ts` and `app/**/page.tsx` to their spec files via the coverage map; also includes any changed spec files directly. Pages and journey specs are excluded by default (they need `test.easeetool.com`); pass `--include-ui` to add them. Use `--list` to print the matched specs without running. Pass a custom base as the first positional arg (e.g. `-- staging`). If a changed `lib/data/**` or `lib/session.ts` file has no direct map entry, a warning is printed recommending the full run. Same env requirements as the full run (`PLAYWRIGHT_BASE_URL`, etc.).
  ```
  npm run test:regression:affected                      # diff origin/master...HEAD
  npm run test:regression:affected -- staging           # diff staging...HEAD
  npm run test:regression:affected -- --list            # print specs only, no run
  npm run test:regression:affected -- --include-ui      # include pages/ + journeys/
  ```
- `npm run test:regression:report` — rebuild the HTML report (`.engineering/regression/latest/report.html`; add `-- --open`).
- One spec: `npx playwright test -c playwright.regression.config.ts tests/regression/api/orders.spec.ts` (setup/teardown and cleanup still run). `RGR_WORKERS` sets the worker count (integer 1–8, default 3).
- The report also lists what the target could **not exercise** (`precondition` annotations, e.g. org-subdomain probes on a path-mode preview) — informational, not a failure.

**Env:** `PLAYWRIGHT_BASE_URL` (only `test.easeetool.com`, `*.test.easeetool.com`, `v-quote-test.vercel.app` or a branch alias `quotation-system-git-<branch>-vistra-indias-projects.vercel.app` other than master/main — per-deployment hash URLs are refused because production has them too), `DATABASE_URL` (the **dev** Neon endpoint `ep-solitary-unit-ais3pnxi` — the DB helper refuses others; setup then refuses to start unless the API target's org ids equal the dev DB's, and the Test Org — whose id is the proof — must already exist; set `RGR_CREATE_TEST_ORG=1` once to let setup create it), `TEST_SA_USERNAME`, `TEST_SA_PASSWORD`. **Strongly recommended:** `TEST_ADMIN_PASSWORD` (Test Org `admin`) — needed to create a missing Test Org (with `RGR_CREATE_TEST_ORG=1`), and the fallback session orphan recovery uses when a crashed run left no `rgr-…-admin` to reset. Optional: `VERCEL_AUTOMATION_BYPASS_SECRET`. Never commit values.

**Never run two live runs at once** (two shells, two agents): teardown would see the other run's rows as drift, and parallel sign-ins hit the sign-in rate limit (429). Setup takes an exclusive lock (`.engineering/regression/run.lock`, pid inside; a dead pid's lock is taken over) and refuses a second run in the same checkout — runs from *different* checkouts/machines are not locked out. The dev DB is shared with previews and other people: any concurrent activity in another org shows up as a teardown **delta FAIL**, which names the changed row ids — check who else was active before suspecting the suite.

## Add a test for a new route or page
1. Pick the spec file for the route's group (`api/<group>.spec.ts`) or add a row to `pages/page-table.ts`.
2. Add a literal `covers("POST /api/v1/orgs/[orgSlug]/things")` (or `coversPage("/[orgSlug]/things")`) — the coverage check only reads literal calls.
3. Add a `registerNegatives([{ key, method, path: () => "/things", permission, invalid: [...] }])` entry: it emits 401 / 403-per-role / cross-tenant / unknown-org / unknown-id / malformed-JSON / invalid-body cases.
4. Write the happy path with `test`/`expect` from `fixtures/test` and its fixtures: `as.<role>` (guarded clients), `url("/things")`, `f.*` factories.
5. Create data **only through factories** (or `ledger.add(...)` the moment a row exists) and name it with `run.prefix` (`rgr-<runId>-`).
6. Assert exact statuses and bodies, read from the route — never guessed.

## Cleanup guarantees
- Only the Test Org (`e2e-testorg`) and a throwaway org B (`rgr-<runId>-b`) are mutated; the `Guarded` clients throw `GuardError` *before sending* any mutation aimed elsewhere.
- Every row is ledgered (`.engineering/regression/ledger.json`); teardown drains it, sweeps for unledgered `rgr-` rows (**strays** → FAIL) and diffs a snapshot of every other org (**delta** → FAIL). Global-state edits go through `withRecordedGlobalState`; failed reverts are reported.
- The Test Org's shared configuration (component types/configs/categories, roles + permissions, org row) must be back to its baseline **content** after teardown (updatedAt ignored); a change names the hash that moved.
- Strays are reported (the run fails) and then this run's own are deleted; a stray custom role has no delete route and is report-only.
- A killed run is cleaned by the next run's orphan recovery (`recovered N orphans`). Rows younger than 2 h are skipped by design (they may belong to a live run).
- Test seams: `RGR_RECOVER_MIN_AGE_MS=0` lets recovery delete young orphans (only when you know no other run is active); `RGR_KILL_AFTER_SETUP=1` exits right after setup, leaving ledgered rows behind to prove recovery.

## Conventions and gotchas
- A suspected product bug is a plain test titled `KNOWN BUG: …` (or `DECISION NEEDED: …`) that pins today's behaviour with `// KNOWN BUG — backlog <ref>; when fixed, expect <correct>`. Never `test.fail()`, never a loosened assertion.
- The custom `SelectField` is `role="combobox"` + listbox, not a native `<select>`.
- Next.js renders its own `role="alert"` (route announcer): always `getByRole("alert").filter({ hasText })`.
- Wait for hydration (`expect.poll(() => isHydrated(locator))` from `pages/collect.ts`) before clicking client buttons.
- **Traces and reports can contain session cookies/tokens** (`test-results/`, `.engineering/regression/`): both are git-ignored; never share or commit them.
