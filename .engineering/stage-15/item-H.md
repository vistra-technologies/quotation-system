# Batch H — Test harness (X3, X5, X6)

**Developer:** `developer` agent
**Branch:** `feature/stage15-test-harness`
**Worktree:** `D:\projects\vistra\.worktrees\stage15-g`

---

## Plan

### X5 — Restore positive tenancy assertion (admin-stage4.spec.ts:184)

**Root cause:** Stage 14 weakened the tenancy check to `not.toMatch(/(nordic-walls|vistra)/)` — a
denylist of exactly 2 org slugs. A leak to any third org passes silently.

**Fix:** Replace with a positive regex anchored at both ends:
`/^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$/`

**Mode-aware rationale:**
- Path mode (Vercel preview): href = `/acme-glass/admin/users/{uuid}` — matches with the
  optional `/acme-glass` group
- Subdomain mode (test.easeetool.com): `orgHref(orgSlug, "")` returns `""` so href =
  `/admin/users/{uuid}` — matches with the group absent
- Any other org (`/nordic-walls/admin/users/{uuid}`): starts with `/nordic-walls`, no match →
  assertion FAILS → leak detected ✓

**Verified href source:** `app/[orgSlug]/admin/users/page.tsx:127` uses
`href={\`${base}/admin/users/${user.id}\`}` where `base = await orgHref(orgSlug, "")`.

**Proof of assertion strength:** If a real tenancy leak sent `/nordic-walls/admin/users/{uuid}`,
the regex `^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$` does NOT match (starts with
`/nordic-walls` which is neither empty-group nor `/acme-glass`) → `toMatch` throws → test fails.
This is a positive assertion that can actually fail. The old denylist could not fail on a third org.

**E2E_PERM teardown finding:** `admin-stage4.spec.ts` creates `E2E_PERM_${Date.now()}`
permissions with no afterAll cleanup. Item G's `item-G.md` noted this as Batch H's responsibility.
However: there is no DELETE endpoint at `GET/POST /api/v1/permissions` and no UI delete action on
the permissions page. Adding afterAll teardown requires an app code change (DELETE endpoint) — which
is outside Batch H's scope. The Batch G seed.ts `deleteMany({ where: { code: { startsWith:
"E2E_PERM_" } } })` is the operational backstop. Reporting this as a finding for the orchestrator.

### X6 — Fix signIn flake (helpers.ts)

**Root cause diagnosed from code + stage-14.md evidence:**

Stage-14.md confirms: "passed 19/19 in isolation → confirmed flake, not a defect." The 7s
`beforeEach` in stage6.spec.ts prevents rate limiting within that file, but `playwright.config.ts`
has `fullyParallel: true` — multiple spec files run concurrently on separate workers. All workers
hit the same Vercel preview and share the better-auth rate-limit bucket (3/10s per IP). Sign-ins
from different workers can cluster within a 10s window and push a test's sign-in past the limit.

The sign-in form uses `authClient.signIn.email()` which POSTs to `/api/auth/sign-in/email`. A 429
response causes `signInError` to be set and `window.location.href` is NOT called → page stays at
`/login` → `page.waitForURL(dashboard)` times out after 30s → test reports a 30s timeout failure.

**Fix (final — commit `05881de`):** Intercept the sign-in HTTP response via `waitForResponse`. If
429, read the `X-Retry-After` response header (seconds remaining in the rate-limit window set by
better-auth's `rateLimitResponse()`) and wait that many seconds + 1 s buffer, then retry. Loop up
to 4 attempts (3 retries). The `+1 s` buffer clears better-auth's strict
`now - lastRequest > windowInMs` boundary check in `decideConsume()`.

4 attempts is the right ceiling for 8 Playwright workers: workers 1–3 succeed; workers 4–8 get 429
→ retry; workers 4–6 succeed; workers 7–8 get another 429 → retry again; both succeed. Initial
version committed with 2 attempts and a fixed 10 s wait; `05881de` revised to 4 attempts + dynamic
X-Retry-After wait after testing showed the 2-attempt cap was still insufficient under an 8-worker
cluster. This is NOT a blanket retry — it is specifically targeted at the 429 condition.

**stage6.spec.ts:379 (second X6 flake — explicitly accounted for):**

The "Selection round-trip" test at line 379 calls `signIn(page, "admin")` at line 385. That sign-in
is the flaky point — confirmed by stage-14.md ("passed 19/19 in isolation"). The rest of the test
(project create, configuration page navigate, selection add) passes reliably when sign-in succeeds.
The commit message on `05881de` addresses this directly: "stage6.spec.ts:379 (Selection round-trip)
has the same root cause — no separate fix needed; the signIn helper change covers both X6 flakes."

No separate code change to stage6.spec.ts is required or was made. The fix is fully in helpers.ts.

### X3 — Strip inline validation markup (docs repo)

**Files:** `inquiry-page.html` and `project-details-page.html` (under `ui-mockups/finalized/`)

**Decision basis:** Stage 15 scoping decision 8: "C9 ships HTML5 constraints only — no field-level
error message UI." Stage 15 scoping decision 12 says all X items are included. X3's resolution
(option a from architect-scoping) is to strip the validation markup so mockups document what was built.

**What is stripped from each file:**
- CSS: the `/* required-field validation */` comment block + `.field.invalid input/select`,
  `.field-error`, `.form-error-banner`, `.form-error-banner.show` rules
- HTML: `form-error-banner` div and all 12 `field-error` divs (including emailError/pEmailError IDs)
- JS: `REQUIRED_FIELDS`, `EMAIL_RE`, `formErrorBanner`/`pEmailError` variables, `markField()`,
  `REQUIRED_FIELDS.forEach()` listeners, `validateForm()` function, `if (!validateForm()) return`
  call in the button handler

Committed separately in the docs repo.

### Batch G two-sign-in test (assessment)

`stage15-user-mgmt.spec.ts` performs two sign-ins with `clearCookies()` between them. Total gap
from last sign-in to next test's sign-in is ≈12s (7s beforeEach + ~5s for the 2-sign-in test).
The rate limit window is 10s. At 12s gap, the first of the two sign-ins falls outside the 10s
window before the next test signs in — safe margin.

**However:** with `fullyParallel: true`, other spec files run concurrently. The 2 sign-ins in that
test plus potential concurrent sign-ins from other workers create a tighter cluster. The X6 fix
(429 detection + retry) makes all sign-ins self-healing under the rate limit, including in this
test. Leave the test as-is — the fix to helpers.ts is sufficient.

---

## Files changed

### App repo (quotation-system/)
- `tests/e2e/admin-stage4.spec.ts` — X5: positive tenancy assertion
- `tests/e2e/helpers.ts` — X6: waitForResponse + 429 retry in signIn

### Docs repo (quotation-system-docs/)
- `ui-mockups/finalized/inquiry-page.html` — X3: strip validation markup
- `ui-mockups/finalized/project-details-page/project-details-page.html` — X3: strip validation markup

---

## Additional changes (discovered during suite run)

### U3 regression fix — admin-stage4.spec.ts:164

Run 1 revealed that `create user: valid user appears in the users list` (line 164) was failing
because the test selected "Distributor" as the new user's role. Batch G (Stage 15) added the
`isInternalRole` flag and a server-side rule: external roles require an `externalCompanyId` in the
create-user form. The test didn't set one → 400 from the API → page stayed on `/admin/users/new` →
the `toHaveURL(/\/acme-glass\/admin\/users$/)` assertion timed out.

**Fix:** Change the selected role from "Distributor" to "Company Member" (an internal role,
`isInternalRole: true`). The U3 rule itself is exercised by `stage15-user-mgmt.spec.ts`; this
test's purpose is the post-submit redirect and list appearance, so any valid role works.

**Note on line numbers:** The U3 fix added one test line, shifting the X5 assertion from line 184
to line 187 in the final committed file. References in this doc have been updated.

---

## Verification

### Static checks

`npm run lint` — 0 errors (4 pre-existing warnings in unrelated files, no new warnings).
`npx tsc --noEmit` — 0 errors.

### Deploy

Pushed as `feature/stage15-test-harness`. Vercel builds for commit `4b62f96` (deployment
`hzi4v7ooq`) went READY after 2 empty retrigger commits to clear a P1002 Neon advisory lock
contention on the dev branch.

### Suite runs — against deployment hzi4v7ooq (`4b62f96`)

**Total tests in suite: 197. Runs: 2.**

**Run 1** (deployment `5ehzt9p2c`, commit `b1cdcbd` — BEFORE U3 fix):
- 151 passed, 5 failed, 41 did not run (8.2m)
- Failures: admin-stage4.spec.ts:164 (U3 regression — fixed), login.spec.ts:262 (rate-limit),
  pricing-stage3.spec.ts:96 (rate-limit), stage13.spec.ts:290 (rate-limit),
  stage15-user-mgmt.spec.ts:116 (rate-limit)

**Run 2** (deployment `hzi4v7ooq`, commit `4b62f96` — WITH U3 fix, current HEAD):
- 170 passed, 5 failed, 22 did not run (7.8m)
- Failures:
  1. `login.spec.ts:201` — `p[role="alert"]` contained "Too many requests" not "deactivated".
     Cause: sign-in in `beforeAll` hit a 429, returning the rate-limit error instead of the
     expected deactivated message. **Pre-existing** — `login.spec.ts` uses an inline `signIn`
     function without the 429-retry helper. Not in Batch H's file set.
  2. `org-nav.spec.ts:259` — `waitForURL(/\/vistra\/dashboard/)` timed out at 10s. Cause:
     manual sign-in without helper or retry. **Pre-existing** — not in Batch H's file set.
  3. `pricing-stage3.spec.ts:96` — `waitForURL` timed out at 30s in local `signIn`. **Pre-existing**
     consistent flake — not in Batch H's file set.
  4. `stage14.spec.ts:138` — `waitForURL` at `helpers.ts:108` (the shared helper's final step)
     timed out after all 4 retry attempts were exhausted. Cause: worst-case 8-worker cluster
     saturated the rate-limit bucket faster than the 4-attempt retry could clear. **Not a Batch H
     regression** — the helper is the X6 fix; it reduces frequency but can't guarantee recovery
     under maximal parallel load. Stage14 is mode:serial with frequent sign-ins.
  5. `stage15-user-mgmt.spec.ts:231` — same failure mode as #4 (`at helpers.ts:108`). The
     `PUT /profile updates first and last name` test is the most complex U4 test (create user →
     fetch list → update → verify → delete) and exhausted the test's budget after retry loops.
     **Not a Batch H regression** — identical root cause to #4.

### X5 confirmation

`admin-stage4.spec.ts:187` (`users list: all action links belong to the session org (tenancy check)`)
PASSED in run 2 at 11.0s. This is the positive tenancy assertion — anchored regex, not a denylist.
The test ran after the U3 fix allowed test 164 to complete first (mode:serial, serial ordering).

### X6 confirmation

`stage6.spec.ts:379` (`Selection round-trip: create project → add selection → selection appears in
list`) PASSED in both runs (16.1s in run 2). This is the second X6 flake listed in stage-14.md.
The shared helper's 429-retry loop is the fix; the selection logic itself was never the problem.

### X3 verification

Docs-repo commits `05a25b1` (inquiry-page.html) and associated changes stripped the
`form-error-banner`, all 12 `field-error` divs, and the validation CSS/JS from both mockup files.
Verified by content inspection (grep for `field-error`, `form-error-banner` returns 0 results in
both files post-commit).

---

## Findings / concerns

1. **E2E_PERM afterAll teardown blocked** (low priority): Cannot implement without a
   `DELETE /api/v1/permissions/{id}` endpoint. Seed.ts from Batch G covers the stop-gap.
   Recommend adding a DELETE endpoint in a future maintenance batch.

2. **Persistent rate-limit flakes in files outside Batch H scope**: `login.spec.ts`,
   `org-nav.spec.ts`, and `pricing-stage3.spec.ts` all have inline sign-in implementations without
   429-retry. These will continue to flake under 8-worker parallel load. Fixing them requires
   touching those files — each owned by a different batch. The orchestrator should track this as a
   follow-up work item (likely a Batch I clean-up).

3. **X6 helper insufficient under worst-case 8-worker saturation**: `stage14.spec.ts:138` and
   `stage15-user-mgmt.spec.ts:231` both failed via `helpers.ts:108` despite using the 4-attempt
   retry. Under maximal parallel load all 4 retries can be exhausted within the 2-minute test
   budget. Options: reduce `fullyParallel` workers, increase `test.setTimeout`, or switch long
   sign-in-heavy files to `--shard` runs. This is not a Batch H regression — these tests are in
   scope for the test harness discussion, but the fix is architectural (config change), not a helper
   change.
