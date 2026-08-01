# Batch 7d — Projects list-page pattern — Implementation Plan

## Scope

Bring `app/[orgSlug]/projects/page.tsx` and its API route up to the same shared
list-page pattern that Batch 7c built for Inquiries.

## Deviations / decisions at the top

D1 (Value column): No `value` field exists on the `Project` model in
`prisma/schema.prisma`. Render "—" and flag as a schema gap. No migration in this batch.

D2 (Submission Date column): No `submittedAt` field exists on `Project`. Same
treatment as Batch 7c's `submittedAt` gap on Inquiry — render "—", note it.

D3 (Layout width change): `projects/layout.tsx` is updated from `max-w-5xl px-6 py-8`
to `max-w-[1180px] px-8 pt-7 pb-12` to match inquiries layout (Batch 7c). Project
detail pages have their own inner `[projectId]/layout.tsx` wrapper
(`mx-auto w-full max-w-5xl px-6 py-8`) which constrains content to 896px regardless,
so widening the outer layout does not break project detail layout.

No new schema migrations. No modifications to frozen lib/api-auth.ts,
lib/api-error.ts, lib/internal-fetch.ts.

## Files changed

### App repo

1. **`lib/data/projects.ts`**
   - Add `ListProjectsParams` interface (mirror of `ListInquiriesParams` in inquiries.ts)
   - Add `listProjectsPaginated(session, params)` function
     - Same RBAC shape: scope=mine → createdByUserId filter; scope=all + external user → own
       company filter from session (URL param ignored); scope=all + internal → full org scope
     - Optional `externalCompanyId` filter for internal users only
     - Search: `name` + `externalCompany.name` (ILIKE, case-insensitive)
     - Date filter on `createdAt`
     - Returns `{ projects, total }`
   - Mark `listProjects` as `@deprecated`

2. **`app/api/v1/orgs/[orgSlug]/projects/route.ts`**
   - Copy `resolveDateRange` helper verbatim from inquiries route
   - Update GET: parse `scope/search/dateRange/page/pageSize/externalCompanyId` params;
     call `listProjectsPaginated`; return `{ projects, total, page, pageSize }`
   - POST: unchanged (no changes to body parsing or DAL call)
   - Update import: add `listProjectsPaginated`

3. **`app/[orgSlug]/projects/page.tsx`**
   - Rewrite to match inquiries page pattern (Batch 7c reference)
   - Accept `searchParams` with `scope/search/dateRange/page/externalCompanyId`
   - Parallel fetch `/me` + `/projects?…`; sequential external-companies fetch for internal users
   - Internal discriminator: `me.externalCompanyId === null`
   - Column schema: Project Name (link to detail), Client Name/Company, Location, Status,
     Value ("—"), Created On, Submission Date ("—")
   - No row checkboxes (removed)
   - "New Project" button: same placement as "New Inquiry" in inquiries page
   - `ListPageControls` + `ListPagePagination` from `components/list-page-controls.tsx`
   - Status badges matching inquiries badge style (DRAFT → shipped-like; other → muted)
   - Remove `getTranslations` import (no i18n strings used in new render)

4. **`app/[orgSlug]/projects/layout.tsx`**
   - Update margins: `max-w-[1180px] px-8 pt-7 pb-12` (was `max-w-5xl px-6 py-8`)

5. **`app/[orgSlug]/projects/loading.tsx`**
   - Update skeleton: new header + 7-column toolbar + table card + pagination footer style
     matching Batch 7c's inquiries loading skeleton

### Docs repo

6. **`quotation-system-docs/design-docs/sql-queries/by-page.sql`**
   - Add Batch 7d section under the GET /api/v1/orgs/[orgSlug]/projects entry
   - `listProjectsPaginated`: count + paginated data queries with scope/search/date conditions

## Reuse

- `components/list-page-controls.tsx` — `ListPageControls`, `ListPagePagination` (unchanged)
- `lib/data/inquiries.ts` — reference pattern for `listProjectsPaginated`
- `app/api/v1/orgs/[orgSlug]/inquiries/route.ts` — reference for `resolveDateRange` + param handling
- `app/[orgSlug]/inquiries/page.tsx` — reference for page structure (parallel fetch, external-companies, column rendering)
- `lib/api-auth.ts`, `lib/api-error.ts`, `lib/internal-fetch.ts`, `lib/orgHref.ts` — all frozen/used as-is

## Verify

- `npm run lint` → 0 errors
- `npx tsc --noEmit` → 0 errors
- Push branch → Vercel preview READY
- `GET /api/v1/orgs/vistra/projects` (unauthenticated) → 401
- `GET /api/v1/orgs/vistra/projects?scope=all&page=1&pageSize=20` (unauthenticated) → 401
- `GET /api/v1/orgs/vistra/projects` with Bearer token → 401 "Bearer token authentication not yet supported"
- Functional: filter/search/pagination work against preview URL
