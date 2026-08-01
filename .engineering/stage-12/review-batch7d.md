# Review — Stage 12 Batch 7d (Projects — shared list-page pattern)

**Branch:** `feature/batch7d-projects-list-pattern`, commit `7f7bf0a`

## What was checked

**Tenancy/RBAC** — verified against `lib/data/projects.ts`:
- `organizationId: session.organizationId` unconditionally the first AND condition in
  `listProjectsPaginated`; every other filter is additive after this.
- `scope=all` for external users: the externalCompany filter uses `session.externalCompanyId`
  (server-side), not the URL param. The URL-param `externalCompanyId` is only applied when
  `session.externalCompanyId === null` (internal-user guard). External users cannot smuggle a different
  company ID through the URL.
- `scope=mine` filter uses `session.userId`.
- route.ts passes `externalCompanyId: externalCompanyId || undefined` to the DAL — consistent with the
  DAL's truthiness check.

**Frozen infrastructure** — merge-base diff on `lib/api-auth.ts`/`lib/api-error.ts`/`lib/internal-fetch.ts`
produced no output. Byte-for-byte unchanged.

**Shared component untouched** — `components/list-page-controls.tsx` does not appear in the diff at all;
identical to the Batch 7c version.

**`[projectId]/layout.tsx` independence** — confirmed: that layout has its own inner wrapper
(`mx-auto w-full max-w-5xl px-6 py-8`) independent of the list layout's margin change. The margin change to
`projects/layout.tsx` controls only the list page's outer shell.

**"New Project" button / no checkboxes / filters wired** — verified in page.tsx: button placement matches
"New Inquiry" exactly; no checkboxes anywhere in the new table; `ListPageControls` receives all filter
props wired through URL params, matching the inquiries page.

**Old `listProjects` deprecation** — grep confirms only the function's own definition remains; the route
imports `listProjectsPaginated` only.

**Column schema matches spec** — 7 columns: Project Name (link), Company/Client Name (header switches on
`isInternal`), Location, Status, Value ("—", schema gap D1), Created On, Submission Date ("—", schema gap
D2). Matches `stage-12.md`'s column table exactly.

**Lint/TypeScript** — `npm run lint`: 0 errors (1 pre-existing warning). `npx tsc --noEmit`: 0 errors.

**Docs repo** — `65b1c87` on docs `main`: `by-page.sql` updated for `listProjectsPaginated`.

**No direct Prisma in page** — zero matches for `@/lib/data`/`prisma` in `projects/page.tsx`.

## Findings

**[MINOR-1]** Superfluous `createdBy` JOIN — `lib/data/projects.ts`'s `findMany` includes a `createdBy`
select that no table column renders (no "Created By" column in the spec). Unnecessary JOIN on every list
request. Fix: drop `createdBy` from the `include` and the `ProjectListItem` interface. No measurable impact
at current scale; worth taking when convenient.

**[MINOR-2]** Empty-state text misses `externalCompanyId` filter — same gap accepted in Batch 7c's
Inquiries review: the empty-state condition (`search || dateRange || scope === "mine"`) omits
`externalCompanyId`, so a company-only filter with zero results shows the generic "create your first
project" message. Fix (when taken): add `|| externalCompanyId` to the condition in both `projects/page.tsx`
and `inquiries/page.tsx` together.

## Verdict: APPROVE-WITH-NITS

0 CRITICAL · 0 IMPORTANT · 2 MINOR (both developer's discretion, non-blocking). Tenancy model correct and
enforced at the right layer; shared component genuinely unmodified; `[projectId]/layout.tsx` independence
claim checks out; lint/tsc clean. Ready to merge.
