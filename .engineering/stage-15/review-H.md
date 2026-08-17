# Batch H — Test harness (X3, X5, X6) — Review

**Reviewer:** `engineering:reviewer`
**Branch:** `feature/stage15-test-harness` @ `69fd928`
**Diff:** `diff-H.patch` (322 lines)
**Scope:** X3 (docs-repo mockup strip), X5 (positive tenancy assertion), X6 (signIn 429 retry), plus
an unplanned Batch G regression fix (`f301f79`) discovered during the suite run.
**Suite runs:** 2 (against deployment `hzi4v7ooq` / commit `4b62f96`).

---

## Findings

### [MINOR] Run-count evidence for X6 is structurally sound but empirically thin · `tests/e2e/helpers.ts`

The plan (§4) called for verifying X6 by "5 consecutive local runs." The hard rule
(`profile.md` — "no local testing, ever") makes that target impossible to execute as written. The
developer substituted 2 full-suite preview runs, in which `stage6.spec.ts:379` passed in both.
Given the `~1-in-15` characterization of the original flake, 2 passes is weak empirical evidence;
the developer explicitly acknowledges this: "not reproduced independently; fix is structurally
justified, not empirically proven."

The structural reasoning is sound and verified:

- Root cause confirmed: `fullyParallel:true` + 8 workers + better-auth's 3/10s rate limit → sign-in
  clustering → 429 → `waitForURL` timeout.
- Fix is targeted: the retry loop fires **only on HTTP 429**. Any other response status (200, 401,
  403, 400, 500) triggers `break` immediately and falls through to `waitForURL`. Real auth failures
  (wrong password, deactivated account) are not 429s and will time out `waitForURL` loudly — the fix
  does not swallow real errors.
- `Promise.all([waitForResponse(...), button.click()])` pattern is correct; the listener is
  registered before the click, eliminating the race where the response could arrive before the
  predicate is armed.

Developer's call whether to gather more runs before merge. The code is correct and the risk is that
the flake persists at reduced frequency rather than that the fix introduces new failure modes.

### [MINOR] Two failures in run 2 use the new hardened helper and still exhaust retries · `tests/e2e/stage14.spec.ts:138`, `tests/e2e/stage15-user-mgmt.spec.ts:231`

Both fail at `helpers.ts:108` (the `waitForURL` after the retry loop) — not at the actual test
assertion. The error location is diagnostic: if these were product regressions, the failure would
be at the step asserting on the page's content, not at the sign-in completion step. These are
rate-limit infrastructure failures, not logic defects.

The implication: `engineering:test` will receive a non-green baseline. **The suite has 5 persistent
failures entering the formal test phase.** This must be communicated plainly in the handoff, not
discovered there. The U4 profile test (`stage15-user-mgmt.spec.ts:231`) in particular has never
completed in a full suite run — it was verified correct in Batch G's own targeted run, and the
full-suite failure is at sign-in, but it means U4's end-to-end path has not been proven
green in the integrated suite context.

---

## Verdict on the four questions

### Q1 — Batch G regression: was the test wrong, or is Batch G's code wrong?

**The test was wrong. Batch G's code is correct. No merged defect.**

Definitive evidence from `lib/data/users.ts:76-78` (present in the worktree after Batch G merged):

```ts
// U3 enforcement on create: external roles require an external company.
if (!role.isInternalRole && !externalCompanyId) {
  throw new Error("External company is required for this role");
}
```

"Distributor" has `isInternalRole: false` (confirmed in `prisma/seed.ts`). The test provided no
`externalCompanyId`. Post-U3 this correctly returns a 400, which the create-user action surfaces
as a form error; the page never redirects to `/admin/users`, so `toHaveURL(/...users$/)` times out.

Pre-U3 the test passed because no such server-side validation existed. After Batch G correctly
implemented U3, the test's implicit assumption ("Distributor without a company is a valid user
creation") became false.

The fix — `selectOption("Company Member")` instead of `"Distributor"` — is correct. "Company
Member" has `isInternalRole: true`, so no external company is required. The test's purpose is
"post-submit redirect and list appearance"; any role that creates a valid user without additional
required fields serves that purpose. The comment explaining the substitution is adequate.

**Batch G carries no defect. The changed assertion is falsifiable on revert** — reverting to
"Distributor" would fail again because U3 enforcement in `lib/data/users.ts` is still there.

### Q2 — Does the X5 assertion actually catch a third-org leak?

**Yes. The assertion is sound in both routing modes.**

The regex `/^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$/` is anchored at both ends.

- **Path mode** (Vercel preview — this is the execution environment for all suite runs): `orgHref("acme-glass", "")` returns `"/acme-glass"` (host is `*.vercel.app`, not `*.easeetool.com`). Generated href = `/acme-glass/admin/users/{uuid}`. Matches with the optional group present. ✓
- **Subdomain mode** (test.easeetool.com — formal test phase): `orgHref("acme-glass", "")` returns `""` (host is `acme-glass.test.easeetool.com`). Generated href = `/admin/users/{uuid}`. Matches with the optional group absent. ✓
- **Third-org leak** (e.g., `/nordic-walls/admin/users/{uuid}`): at position 0, the optional `(\/acme-glass)?` matches zero characters (the string doesn't start with `/acme-glass`). The next element `\/admin\/users\/` must match at position 0, but the string starts with `/nordic-walls/`. No match → `toMatch` throws → test fails → leak caught. ✓

The optional group does not reintroduce the hole the item exists to close. The `^` anchor prevents any path that starts with a different prefix from matching.

Verified href source: `app/[orgSlug]/admin/users/page.tsx:127` — `href={\`${base}/admin/users/${user.id}\`}` where `base = await orgHref(orgSlug, "")`. Matches the regex's construction exactly.

**The assertion is falsifiable on revert** — the old two-slug denylist would pass on a leak to
any third org. The new positive assertion would fail it.

### Q3 — Is the 5-failure classification credible, or is a regression hiding?

**Classification is credible for all 5 failures. No hidden regression visible.**

Detailed trace:

1. `login.spec.ts:201` — error message "Too many requests" in the deactivated-user alert. `login.spec.ts` uses its own inline `signIn` function without 429 retry (confirmed by the developer and consistent with the second bullet in the out-of-scope items). The `beforeAll` setup hit a 429, returned the rate-limit error to the UI, and the test asserted on "deactivated" instead. Mechanism is clear.

2. `org-nav.spec.ts:259` — `waitForURL(/\/vistra\/dashboard/)` timed out. `org-nav.spec.ts` has a manual sign-in without the helper. Same pattern as #1.

3. `pricing-stage3.spec.ts:96` — `waitForURL` timeout. Same file cited in run 1 and consistently identified as using a local `signIn` implementation. Consistent cross-run pattern confirms rate-limit, not logic.

4. `stage14.spec.ts:138` — at `helpers.ts:108`. **Uses the new helper** and still exhausted 4 retries. Under 8-worker parallel load, all 4 retries can be consumed within the 2-minute test budget. The failure is at the sign-in completion step, not at any Stage 14 assertion. If this were a Stage 14 regression, the failure would be at the test's own assertion line, not at `helpers.ts:108`.

5. `stage15-user-mgmt.spec.ts:231` — same mechanism as #4. The `PUT /profile updates first and last name` test (U4). Also at `helpers.ts:108`.

The key diagnostic: failures 4 and 5 at `helpers.ts:108` (the `waitForURL` inside the helper, after retries exhausted) cannot be a product code regression. Product regressions fail at the test's own assertion — the step that checks what the page now shows. Sign-in infrastructure failures fail before the test gets to the product code.

I cannot run the tests (per constraints), but the error locations and error messages are self-consistent with the rate-limit diagnosis. There is no signature of a hidden product regression in these 5 failures.

### Q4 — Is the X6 retry sound?

**Yes. It retries only on 429 and fails loudly on all other errors.**

```ts
if (response.status() !== 429) break;
```

Any response that isn't 429 — a 200 (success), 401 (bad credentials), 403 (deactivated), 400
(validation), or 500 (server error) — immediately exits the loop. For a success (200 → navigation
to dashboard), `waitForURL` passes. For any real error, the page stays at login, `waitForURL` times
out, and the test fails visibly. The retry cannot mask a real auth failure.

The `X-Retry-After` fallback (`?? "10"`) to 10s is correct: if better-auth's response omits the
header (which it should not, given the developer traced `rateLimitResponse()`, but defensive coding
is appropriate here).

### Q5 — Wireframe-stage rule compliance

**Clean.** No DOM structure, layout, copy, or styling assertions in the changed specs. The
`admin-stage4.spec.ts` change tests href format (tenancy isolation invariant). The `helpers.ts`
change is test infrastructure. The role option change in the create-user test is a fixture fix. All
are behavior-level invariants that survive a UI redesign.

### Q6 — Can assertions fail on revert?

All three changed assertions are falsifiable:

- **X5 regex**: Revert to the two-slug denylist → a leak to any third org passes silently. The
  positive regex fails it. ✓
- **X6 retry**: Revert to fill-and-click-without-wait → rate-limit flake returns at ~1-in-15
  frequency under 8-worker load. ✓
- **Batch G regression fix** ("Company Member" → "Distributor"): Revert → U3 enforcement in
  `lib/data/users.ts:76-78` rejects the request → test fails again. ✓

---

## X3 verification

X3 is a docs-repo change only. The developer confirmed grep for `field-error` and
`form-error-banner` returns 0 results in both mockup files post-commit (`05a25b1`). Plan §3 said
to strip `field-error` spans, `form-error-banner`, and validation JS from the two finalized
mockup HTML files — this matches what `item-H.md` reports was done. No app code changed; no
wireframe-stage concerns; no tenancy or RBAC implications. Accepted on the developer's verification.

---

## Out-of-scope items — human's call

These three items were correctly identified by the developer as outside Batch H's scope. My read
on severity:

**1. Three spec files with inline sign-in bypassing the hardened helper** (`login.spec.ts`,
`org-nav.spec.ts`, `pricing-stage3.spec.ts`). These will continue to produce intermittent failures
in every suite run under 8-worker parallel load. The formal `engineering:test` phase will see a
non-green baseline. **Not a blocker for shipping Stage 15**, but `engineering:test` needs a clear
brief that these are pre-existing infrastructure flakes, not regressions. Fixing them requires
touching files outside Batch H's scope — a natural "Batch I" cleanup. The human should decide
whether to fix them before or after promoting Stage 15.

**2. Playwright worker-count reduction from 8.** Reducing to 4 workers would bring the worst-case
concurrent sign-in cluster to 4, within the 3/10s rate-limit window more comfortably. This is the
single highest-leverage config change for suite reliability. It's a one-line change
(`playwright.config.ts`) that benefits every spec file. **Not a blocker for Stage 15**, but the
cost is low and the benefit is clear. Human's call before or after promotion.

**3. Missing `DELETE /api/v1/permissions/{id}` endpoint.** The seed purge from Batch G is an
adequate operational backstop. `E2E_PERM` artifacts will accumulate between seed runs but won't
appear in production (only the dev Neon branch). **Not blocking Stage 15.** Worth addressing in a
future maintenance batch alongside the inline-signIn cleanup.

None of these three makes shipping Stage 15 without them a mistake. They are quality-of-life and
test-hygiene items.

---

## Verdict

**APPROVE-WITH-NITS**

The production code is unchanged (test-only and docs-only batch). All three items (X3, X5, X6)
are correctly implemented. The Batch G regression was in the test, not in the product code. The
two MINOR findings (thin run-count evidence for X6; two failures persisting under 8-worker
saturation even with the new helper) are documented honestly by the developer and do not indicate
correctness problems. Stage 15's test suite will arrive at `engineering:test` with 5 known
rate-limit failures in the baseline — that fact must travel with the handoff.
