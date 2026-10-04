# Regression suite (`tests/regression/`)

Live API + UI regression of every route and page, run against `test.easeetool.com` or a branch preview. Spec: `quotation-system-docs/development-cycles/regression-suite/regression-suite.md`.

## Run
- `npm run test:regression` — the official run: coverage map → unit tests → Playwright (failed tests re-run once at `--workers=1`; a cleanup failure is never retried) → report. Ends with `REGRESSION PASS`/`REGRESSION FAIL` and a matching exit code.
- `npm run test:regression:coverage` — static check only: every API route/page has a `covers()`/`coversPage()` and no test points at one that no longer exists.
- `npm run test:regression:report` — rebuild the HTML report (`.engineering/regression/latest/report.html`; add `-- --open`).
- One spec: `npx playwright test -c playwright.regression.config.ts tests/regression/api/orders.spec.ts` (setup/teardown and cleanup still run). `RGR_WORKERS` sets the worker count (default 3).

**Env:** `PLAYWRIGHT_BASE_URL` (only `test.easeetool.com`, `*.test.easeetool.com` or a non-production `*.vercel.app` preview; anything else is refused), `DATABASE_URL` (the **dev** Neon endpoint `ep-dark-term-ai0ufj4k` — the snapshot/sweep helper refuses others), `TEST_SA_USERNAME`, `TEST_SA_PASSWORD`. Optional: `TEST_ADMIN_PASSWORD` (only if the Test Org must be created), `VERCEL_AUTOMATION_BYPASS_SECRET`. Never commit values.

**Never run two live runs at once** (two shells, two agents): teardown would see the other run's rows as drift, and parallel sign-ins hit the sign-in rate limit (429).

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
- A killed run is cleaned by the next run's orphan recovery (`recovered N orphans`). Rows younger than 2 h are skipped by design (they may belong to a live run); `RGR_RECOVER_MIN_AGE_MS=0` overrides that, only when you know no other run is active.

## Conventions and gotchas
- A suspected product bug is a plain test titled `KNOWN BUG: …` (or `DECISION NEEDED: …`) that pins today's behaviour with `// KNOWN BUG — backlog <ref>; when fixed, expect <correct>`. Never `test.fail()`, never a loosened assertion.
- The custom `SelectField` is `role="combobox"` + listbox, not a native `<select>`.
- Next.js renders its own `role="alert"` (route announcer): always `getByRole("alert").filter({ hasText })`.
- Wait for hydration (`expect.poll(() => isHydrated(locator))` from `pages/collect.ts`) before clicking client buttons.
- **Traces and reports can contain session cookies/tokens** (`test-results/`, `.engineering/regression/`): both are git-ignored; never share or commit them.
