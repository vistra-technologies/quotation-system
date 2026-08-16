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

## Verification

**Static checks:** `npm run lint` + `npx tsc --noEmit` (app repo)

**Deploy:** commit → push `feature/stage15-test-harness` → poll Vercel until READY →
run specs against that preview URL.

**X5 proof:** The positive regex replaces two denylist checks. It can fail (→ `toMatch` throws)
for any org slug that is not `acme-glass`. Verified by reasoning: `/nordic-walls/admin/users/uuid`
does not match `^(\/acme-glass)?\/admin\/users\/[0-9a-f-]{36}$`.

**X6 proof:** Structural proof that the fix addresses the diagnosed root cause (429 from parallel
workers with fullyParallel:true). Actual run-count evidence pending — full suite run deferred until
Batch F's verification window closes (per coordination rule). Will report real run count and results
at that time. "Not reproduced, fix is speculative" is a live possibility — stated plainly.

**X3 proof:** Visual inspection of both mockup files in a browser; the form-error-banner and
field-error elements should not appear, and submission should navigate without validation blocking.

---

## Findings / concerns

1. **E2E_PERM afterAll teardown blocked** (low priority): Cannot implement without a
   `DELETE /api/v1/permissions/{id}` endpoint. Seed.ts from Batch G covers the stop-gap.
   Recommend adding a DELETE endpoint in a future maintenance batch.

2. **full-suite flake rate uncertainty**: 5 runs may not be enough to statistically confirm a
   1-in-15 flake is fixed. Will report run results honestly and note the structural argument.
