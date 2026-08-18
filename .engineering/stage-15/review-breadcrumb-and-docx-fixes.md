# Review: feature/fix-subdomain-auth-and-breadcrumb (166f027..b55da17)

**Diff:** `.engineering/stage-15/diff-breadcrumb-and-docx-fixes.patch` (269 lines)

## Verdict: APPROVE

All focus questions answered cleanly — no CRITICAL, no IMPORTANT, no MINOR findings.

## Key verifications performed

- `step.linkHref` correctly matches `usePathname()` in both path-based (org-prefixed) and subdomain
  (no-prefix) modes; path mode is a no-op regression-wise since `linkHref === href` there.
- `isDone = activeIndex > -1 && index < activeIndex` — strict `<` means the active step is never also
  marked done; no off-by-one.
- The `h-screen` → `main flex-1 overflow-auto` → `h-full flex-col` → `flex-1 min-h-0` →
  `overflow-y-auto` flex chain is correct; `min-h-0` is present at the two `flex-1` elements that need
  it (table card and inner wrapper), and absent elsewhere because those elements use explicit `h-full`
  instead.
- `colNumber` key rename in the `projects` namespace hits only
  `app/[orgSlug]/projects/[projectId]/page.tsx:110` — the list table in `projects/page.tsx` uses
  hardcoded string literals for column headers, not this key.
- No new automated DOM/layout assertions were added, consistent with the repo's wireframe-stage rule.
