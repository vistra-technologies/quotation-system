# Plan — breadcrumb active-step fix + stale href assertion

**Branch:** `feature/fix-subdomain-auth-and-breadcrumb`
**Date:** 2026-08-18

## No design decisions required

Both fixes are mechanical and unambiguous. No human gate needed.

---

## Bug 1 — wizard breadcrumb never marks a step active in subdomain mode

**Root cause confirmed** (file read at `app/[orgSlug]/projects/[projectId]/project-wizard-breadcrumb.tsx`):

- Line 36: `const base = \`/${orgSlug}/projects/${projectId}\`` — always org-slug-prefixed.
- Line 39: `const hrefBase = isSubdomain ? \`/projects/${projectId}\` : \`/${orgSlug}/projects/${projectId}\`` — subdomain-aware.
- The `steps` array stores two hrefs per step:
  - `href` — built from `base` (org-prefixed, used for active detection at lines 57–61).
  - `linkHref` — built from `hrefBase` (subdomain-aware, used for `<Link href=>`).
- In subdomain mode, `usePathname()` returns `/projects/{projectId}/...` (no org-slug prefix). The `activeIndex` comparison uses `step.href` which has the org-slug prefix — so it never matches → `activeIndex = -1` → no step is ever active.

**Fix:** Change the `activeIndex` `findIndex` callback to compare `pathname` against `step.linkHref` instead of `step.href`.

- In path-based mode: `linkHref === href` (both equal `base`-derived value), so behaviour is identical.
- In subdomain mode: `linkHref` = `/projects/${projectId}/...` which matches what `usePathname()` returns.

This reuses the already-existing `hrefBase` / `linkHref` pattern already in the file — no new logic introduced.

**File changed:** `app/[orgSlug]/projects/[projectId]/project-wizard-breadcrumb.tsx`
- Lines 57–61: change `step.href` → `step.linkHref` in both `startsWith` calls.

**Comment update:** The comment block at lines 33–35 claims "usePathname() always returns the internal path-based route even in subdomain mode" — this is incorrect per the tester's finding. Update it to reflect reality.

---

## Bug 2 — stale org-prefixed href regex in stage13.spec.ts

**Root cause confirmed** (file read at `tests/e2e/stage13.spec.ts` lines 499–500):

```js
expect(href).toMatch(/\/acme-glass\/inquiries\/([0-9a-f-]{36})/);
const match = href!.match(/\/acme-glass\/inquiries\/([0-9a-f-]{36})/);
```

In subdomain mode, `<Link href>` for an inquiry is path-only (`/inquiries/{uuid}`), not org-prefixed. The regex fails to match → `match` is `null` → `match![1]` throws → test crashes.

The pattern used in stage7.spec.ts:128, stage7.spec.ts:147, and stage12.spec.ts:138 (already fixed in the prior batch) is simply `/\/inquiries\/[0-9a-f-]{36}/` — no org prefix.

**Fix:** Drop `/acme-glass` from both regexes on lines 499 and 500 of `tests/e2e/stage13.spec.ts`.

- `expect(href).toMatch(/\/inquiries\/([0-9a-f-]{36})/)` — still validates that the href contains a UUID-shaped inquiry path segment.
- `const match = href!.match(/\/inquiries\/([0-9a-f-]{36})/)` — still extracts the UUID into `match[1]`.

The UUID capture group `([0-9a-f-]{36})` is preserved in both lines — the only change is removing the leading `\/acme-glass`.

Note: line 545 in the same file already uses `/\/inquiries\/([0-9a-f-]{36})/` without the org prefix — consistent with this fix.

**File changed:** `tests/e2e/stage13.spec.ts`
- Line 499: remove `\/acme-glass` prefix from regex.
- Line 500: remove `\/acme-glass` prefix from regex.

---

## Verification

Cannot run live (no local server, per project rule). The tester must run the Playwright suite against the pushed Vercel preview for this branch once committed and deployed:

1. **Bug 1 (breadcrumb):** Manually navigate to `{orgSlug}.easeetool.com/projects/{id}` in the preview. Confirm the correct step pill is highlighted with `aria-current="step"`. Also check `/{orgSlug}/projects/{id}` in a Vercel-preview (path-based) URL to confirm no regression.
2. **Bug 2 (test):** Run `npx playwright test tests/e2e/stage13.spec.ts` with `PLAYWRIGHT_BASE_URL=https://test.easeetool.com` — the formerly-crashing test should now extract the UUID and proceed.
3. **Static:** `npm run lint` + `npx tsc --noEmit` locally before push.
