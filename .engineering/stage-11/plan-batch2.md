# Batch 2 Implementation Plan — Server redirect call sites

## Decision notes (none — no deviations from spec)

`app/page.tsx`'s local `orgHref` function is untouched (per MINOR-2 in review-batch1.md).
`revalidatePath()` calls are untouched (internal filesystem paths per stage doc hard rule).
Client components (`sidebar.tsx`, `top-bar-actions.tsx`) are Batch 3.

---

## Files changed and what changes in each

### Server Action redirect() call sites

| File | Change |
|---|---|
| `lib/data/session.ts` | Import `orgHref`; change 2 redirect targets (`/login`, `/dashboard`) |
| `app/[orgSlug]/login/page.tsx` | Import `orgHref`; change 1 redirect (`/dashboard`) |
| `app/[orgSlug]/admin/layout.tsx` | Import `orgHref`; change 2 redirects (`/login`, `/dashboard`) |
| `app/[orgSlug]/admin/users/actions.ts` | Import `orgHref`; change 2 redirects (`/admin/users`, `/admin/users/${userId}`) |
| `app/[orgSlug]/admin/components/actions.ts` | Import `orgHref`; change 2 redirects (`/admin/components/${id}`) |
| `app/[orgSlug]/admin/permissions/actions.ts` | Import `orgHref`; change 1 redirect (`/admin/permissions`) |
| `app/[orgSlug]/admin/external-companies/actions.ts` | Import `orgHref`; change 2 redirects (`/dashboard`, `/admin/external-companies`) |
| `app/[orgSlug]/admin/roles/actions.ts` | Import `orgHref`; change 1 redirect (`/admin/roles/${role.id}`) |
| `app/[orgSlug]/admin/roles/new/page.tsx` | Import `orgHref`; change 2 redirects (`/login`, `/dashboard`) + 1 Link href |
| `app/[orgSlug]/admin/permissions/new/page.tsx` | Import `orgHref`; change 2 redirects (`/login`, `/dashboard`) + 1 Link href |
| `app/[orgSlug]/projects/actions.ts` | Import `orgHref`; change 1 redirect (`/projects/${id}`) |
| `app/[orgSlug]/projects/[projectId]/configuration/actions.ts` | Import `orgHref`; change 1 redirect (`/projects/${id}/configuration`) |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/actions.ts` | Import `orgHref`; change 1 redirect (`/projects/${id}/design`) |
| `app/[orgSlug]/page.tsx` | Import `orgHref`; change 1 redirect (`/login`) — found via broad grep |
| `app/[orgSlug]/dashboard/page.tsx` | Import `orgHref`; change 1 redirect (`/login`) — found via broad grep |
| `app/[orgSlug]/inquiries/actions.ts` | Import `orgHref`; change 4 redirects — found via broad grep |

### RSC pages — Link href call sites
(all use `const base = await orgHref(orgSlug, "")` pattern; loop case requires base approach)

| File | Links changed |
|---|---|
| `app/[orgSlug]/inquiries/page.tsx` | 3 (1 static + 2 in loop) |
| `app/[orgSlug]/inquiries/[inquiryId]/page.tsx` | 1 |
| `app/[orgSlug]/inquiries/new/page.tsx` | 1 |
| `app/[orgSlug]/pricing/page.tsx` | 1 (in loop) |
| `app/[orgSlug]/pricing/[itemId]/page.tsx` | 1 |
| `app/[orgSlug]/projects/page.tsx` | 3 (1 static + 2 in loop) |
| `app/[orgSlug]/projects/[projectId]/page.tsx` | 3 |
| `app/[orgSlug]/projects/new/page.tsx` | 1 |
| `app/[orgSlug]/projects/[projectId]/design/page.tsx` | 2 |
| `app/[orgSlug]/projects/[projectId]/design/add-wall/page.tsx` | 1 |
| `app/[orgSlug]/admin/users/page.tsx` | 2 (1 static + 1 in loop) |
| `app/[orgSlug]/admin/users/new/page.tsx` | 1 |
| `app/[orgSlug]/admin/users/[userId]/page.tsx` | 1 |
| `app/[orgSlug]/admin/roles/page.tsx` | 2 (1 static + 1 in loop) |
| `app/[orgSlug]/admin/roles/[roleId]/page.tsx` | 1 |
| `app/[orgSlug]/admin/permissions/page.tsx` | 1 |
| `app/[orgSlug]/admin/components/page.tsx` | 2 (1 static + 1 in loop) |
| `app/[orgSlug]/admin/components/new/page.tsx` | 1 |
| `app/[orgSlug]/admin/components/[typeId]/page.tsx` | 1 |
| `app/[orgSlug]/admin/external-companies/page.tsx` | 1 |
| `app/[orgSlug]/admin/external-companies/new/page.tsx` | 1 |

---

## Patterns reused

- `lib/orgHref.ts` (Batch 1) — `orgHref(orgSlug, subpath): Promise<string>`.
- All target functions are already `async` (Server Actions, async RSCs) — no promotion needed.
- For redirect() sites: `redirect(await orgHref(orgSlug, "/subpath"))` — straightforward.
- For Link href sites: `const base = await orgHref(orgSlug, "")` before the return; then `href={\`${base}/subpath\`}` in JSX. `base` is `""` in subdomain mode (giving `/subpath`) and `"/${orgSlug}"` in path mode (giving `/${orgSlug}/subpath`).
- Loop-based hrefs cannot use `await` inline in JSX; the `base` pattern resolves this.

## Explicitly NOT changed

- `revalidatePath(...)` calls — left exactly as `/${orgSlug}/...` (filesystem paths).
- `app/page.tsx` local `orgHref` function — different purpose/signature, untouched.
- `app/[orgSlug]/sidebar.tsx`, `app/[orgSlug]/top-bar-actions.tsx` — client components (Batch 3).
- Any other `"use client"` component hrefs.

---

## Verification

1. Write plan (this file).
2. Implement all edits.
3. `npm run lint` — 0 errors expected.
4. `npx tsc --noEmit` — 0 errors expected.
5. Final grep to confirm zero remaining `redirect(\`/${orgSlug}` and `href={\`/${orgSlug}` in server files (outside revalidatePath and client components).
6. Commit on `feature/batch2-server-redirects`.
