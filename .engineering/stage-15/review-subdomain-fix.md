# Review: feature/fix-subdomain-test-urls (commit 4e6c21a)

**Diff:** `.engineering/stage-15/diff-subdomain-fix.patch` (3116 lines, test-files-only)

## Focus area 1 — Helper correctness

`_isSubdomainHost()`: Detects `easeetool.com` (apex) or `*.easeetool.com`. Catches `test.easeetool.com`,
`acme-glass.test.easeetool.com`, and the bare apex. Returns `false` on a malformed `PLAYWRIGHT_BASE_URL`.
Correct.

`orgUrl(orgSlug, path)`: Subdomain mode → `https://{orgSlug}.{host}{path}`; path mode → `/{orgSlug}{path}`.
Protocol taken from the parsed base URL. Correct.

`apiUrl(orgSlug, apiPath)`: Absolute URL in subdomain mode (avoids the apex-domain 404), bare relative path
in path mode (Playwright resolves via `baseURL`). Correct.

`orgUrlPattern(orgSlug, pathPattern)`: `new RegExp(`${orgSlug}(?:[./][^/]+)?${pathPattern}`)`. Traced
against path mode, subdomain mode, `$`-anchored paths, UUID quantifier paths, and negative-lookahead paths —
all correct in both modes.

`signIn()` update: `page.goto(orgUrl(...))` + `page.waitForURL(orgUrlPattern(...))` — correct and consistent.

## Focus area 2 — Coverage preservation

All `page.goto(orgUrl(...))` calls paired with matching `waitForURL`/`toHaveURL(orgUrlPattern(...))` in the
same test. No half-fixed cases across the 15 spec files.

`href` attribute assertions changed from org-prefixed (`/\/acme-glass\/inquiries\/[uuid]/`) to path-only
(`/\/inquiries\/[uuid]/`) in stage6/7/12 — not a weakening, a necessary correction: Next.js `<Link>` hrefs
are path-only in subdomain mode since the org is already encoded in the subdomain. Page-level tenancy
assertions remain via `orgUrlPattern`.

`stage15-b.spec.ts` unauthenticated stats-401 test correctly uses `apiUrl()` since it clears cookies first
and can't rely on page-origin resolution.

## Focus area 3 — Completeness

`stage15-user-mgmt.spec.ts` was not in the diff. Verified correct as-is: all its API calls are relative and
resolve against the page's current origin (set by `signIn()`), which is already subdomain-correct in both
modes — no change needed.

## Focus area 4 — Scope

All changes confined to `tests/e2e/`. No changes to `proxy.ts`, `app/**`, `lib/**`.

## MINOR finding

`orgUrlPattern` does not regex-escape `orgSlug`. Zero practical risk today (all slugs in use are
`[a-z-]+`). If the slug set ever includes regex metacharacters, escape it:
```typescript
const escaped = orgSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
```
Developer's call whether to harden now.

## Verdict

**APPROVE-WITH-NITS** — 0 CRITICAL, 0 IMPORTANT, 1 MINOR (no practical impact). Ship it.
