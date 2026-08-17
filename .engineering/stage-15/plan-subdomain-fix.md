# Plan: Subdomain-aware URL fix for the E2E test suite

**Branch:** `feature/fix-subdomain-test-urls`  
**Problem:** 15 spec files use path-based URLs (`page.goto("/{orgSlug}/login")`) that
404 on `test.easeetool.com` because `proxy.ts` intentionally rejects non-root paths on
the apex domain. The two passing subdomain specs (`subdomain-routing.spec.ts`,
`subdomain-navigation.spec.ts`) construct absolute subdomain URLs instead.  
**Constraint:** test code only — no changes to `proxy.ts`, `app/**`, or `lib/**`.

---

## Design decisions to flag (none are real decisions — all are mechanical)

None. The approach follows the pattern already established in the two passing specs.
There is one non-obvious choice worth noting:

**`apiUrl()` is a separate helper from `orgUrl()`** because API paths (`/api/v1/...`)
must NOT get the `/{orgSlug}/` prefix in path mode (the API is mounted at `/api/v1/`,
not `/acme-glass/api/v1/`). In subdomain mode both helpers produce an absolute URL
pointing at `{orgSlug}.{apex}`, but the path content differs.

---

## Files to change

### `tests/e2e/helpers.ts`
- Add module-level `const _BASE_URL` and `_isSubdomainHost()` (private).
- Export `orgUrl(orgSlug, path)` — page navigation, routing-mode-aware.
- Export `apiUrl(orgSlug, apiPath)` — API calls; only adds subdomain prefix in
  subdomain mode (path stays as-is in path mode).
- Export `orgUrlPattern(orgSlug, pathPattern)` — RegExp matching both
  `/{orgSlug}{path}` (path mode) and `{orgSlug}.{host}{path}` (subdomain mode).
- Export `isSubdomain: boolean` — for the one file (`org-nav.spec.ts`) that needs
  conditional URL-segment extraction logic.
- Update `signIn()`: `page.goto(orgUrl(orgSlug, "/login"))`,
  `page.waitForURL(orgUrlPattern(orgSlug, "/dashboard"), ...)`.

### 15 affected spec files
Every `page.goto("/{orgSlug}/path")` → `page.goto(orgUrl(orgSlug, "/path"))`.
Every `page.request.get/post/etc.("/api/v1/...")` → wrapped with `apiUrl()`.
Every path-embedded regex in `waitForURL`/`toHaveURL`/`toMatch` assertions
  → `orgUrlPattern()` equivalent.

Files and their specific patterns:
| File | page.goto | page.request | waitForURL/toHaveURL |
|---|---|---|---|
| `admin-stage4.spec.ts` | ~18 | 0 | ~10 |
| `login.spec.ts` | ~3 (via local `goToLogin`) | 0 | ~8 |
| `org-nav.spec.ts` | ~5 | 0 | ~5 + URL-extraction fix |
| `pricing-stage3.spec.ts` | ~5 (own inline signIn) | 0 | ~4 |
| `stage5.spec.ts` | ~17 | ~2 | ~5 |
| `stage6.spec.ts` | ~28 | 0 | ~10 |
| `stage7.spec.ts` | ~38 | 0 | ~20 |
| `stage12.spec.ts` | ~9 | ~3 | ~6 |
| `stage13.spec.ts` | ~20 | ~10 | ~30 |
| `stage14.spec.ts` | ~10 | ~4 | ~10 |
| `stage15.spec.ts` | ~3 | ~2 | ~3 |
| `stage15-b.spec.ts` | 0 | ~3 | 0 |
| `stage15-f.spec.ts` | ~4 | ~4 | ~5 |
| `stage15-f-constraints.spec.ts` | ~12 | ~6 | ~12 |
| `subdomain-url-hygiene.spec.ts` | ~1 | 0 | ~5 + assertion fix |

### Patterns reused
- `orgUrlPattern` regex `{orgSlug}(?:[./][^/]+)?{pathPattern}` is derived from how
  `subdomain-routing.spec.ts` uses `/vistra.*\/dashboard/` — same idea, generalised.
- `apiUrl` in subdomain mode uses the same absolute-URL construction as
  `subdomain-navigation.spec.ts` `${BASE}/api/v1/...`.

---

## Special cases

### `subdomain-url-hygiene.spec.ts`
This spec asserts "no doubled org segment" (`/vistra/vistra/...`). In subdomain mode,
the URL is `vistra.test.easeetool.com/dashboard` — no doubled segment and the
assertion `not.toMatch(new RegExp(`/${ORG}/${ORG}`))` continues to pass because
`/vistra/vistra` is not in the URL. The positive assertion `toMatch(new RegExp(
`/${ORG}/dashboard`))` must be changed to `orgUrlPattern(ORG, "/dashboard")`.

### `org-nav.spec.ts` — orgSlug extraction from URL
Test "full flow" extracts `orgSlug = loginUrl.pathname.split("/")[1]` after clicking
an org link. In subdomain mode the pathname is `/login` and the org slug is in the
hostname. Fix: replace with `orgSlug = isSubdomain ? loginUrl.hostname.split(".")[0]
: loginUrl.pathname.split("/")[1]`.

### `login.spec.ts` — local `goToLogin` and `LOGIN_URL`
Both are updated to use `orgUrl()`. The `inactive account` beforeAll/afterAll
navigates to admin pages via explicit paths — all updated.

### `pricing-stage3.spec.ts` — own inline `signIn`
This file's inline `signIn()` is updated to use `orgUrl()` and `orgUrlPattern()`.

### Rate-limit known flakes (`login.spec.ts`, `org-nav.spec.ts`, `pricing-stage3.spec.ts`)
These 3 files have their own inline sign-in patterns that bypass the hardened helper's
429-retry. The URL-fix touches their navigation but does NOT add the retry logic —
that is tracked as a separate out-of-scope concern (noted in Batch H review). This fix
makes their first navigation work; rate-limit flakes remain as they were before.

---

## `orgUrlPattern` regex proof

Pattern: `${orgSlug}(?:[./][^/]+)?${pathPattern}`

- Path mode, URL `https://preview.vercel.app/acme-glass/dashboard`:
  `acme-glass` found; optional group tries to match `/dashboard` (consuming it) but
  then `/dashboard` pattern fails (end of string) → backtracks → optional group
  skipped → `/dashboard` pattern matches next character. ✓

- Subdomain mode, URL `https://acme-glass.test.easeetool.com/dashboard`:
  `acme-glass` found; optional group matches `.test.easeetool.com` → `/dashboard`
  pattern matches. ✓

- `$`-anchored paths (e.g. `/inquiries$`): both modes produce URLs ending with
  `/inquiries` with no trailing chars → `$` anchor works in both. ✓

- UUID paths (e.g. `/inquiries/[0-9a-f-]{36}$`): pathPattern is passed as a regex
  string, so `[…]` and `{…}` are regex quantifiers, not literals — correct. ✓

---

## Verification

I cannot run the suite (no local server, no local DB — per repo rules). Requested
verification after push:

```bash
PLAYWRIGHT_BASE_URL=https://test.easeetool.com \
VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
npx playwright test --project=chromium
```

Expected outcome: 0 failures due to URL-routing causes. Known residual failures
(not changed by this fix): the 3 rate-limit flakes in `login.spec.ts`,
`org-nav.spec.ts`, `pricing-stage3.spec.ts` that bypass the 429-retry helper.
