# Batch 6 Plan — Admin: Roles, Permissions, Components, Me, Shell Layouts (Capstone)

## Deviations / decisions to call out

### D1 — `/api/v1/permissions` auth (the question in the brief)
**Decision: session's own org used implicitly — no change to `lib/api-auth.ts`.**
The global `/api/v1/permissions` endpoint (no `orgSlug` in URL) cannot call `getApiSession(request, orgSlug)` because there is no org slug to resolve tenancy against. The data is global (no `organizationId` on `Permission` rows), so the cross-tenant guard in `getApiSession()` is inapplicable. The handler calls `auth.api.getSession({ headers: request.headers })` directly (the same call `getApiSession()` makes internally), checks the `active` flag, then calls `requirePermission(sessionData, PERMISSIONS.MANAGE_FEATURES)`. This does NOT modify `lib/api-auth.ts`. This is the "session's own org is used implicitly" path the brief describes.

### D2 — `/me` route returns extra fields beyond the spec's `{ userId, name, username, adminPermissions }`
The dashboard page (`dashboard/page.tsx`) currently fetches org name, role name, and all permission codes via DAL. The ESLint ban rule will prevent it from keeping those calls. Since no separate API routes exist for those resources, the `/me` route is expanded to also return `{ orgName, roleName, permissionCodes, externalCompanyId }`. Shell layouts only read `{ name, username, adminPermissions }` — the extra fields are ignored by them. The dashboard page reads all fields. `projects/new/page.tsx` and `inquiries/new/page.tsx` use `externalCompanyId` for UI branching — after migration they use `/me` instead of `requireSession`.

### D3 — `GET /api/v1/orgs/[orgSlug]/roles` updated: full data + MANAGE_USERS-or-MANAGE_FEATURES gate
Batch 5 implemented GET /roles as MANAGE_USERS-only, returning `{ id, name }` pairs for the users dropdown. The admin roles list page requires MANAGE_FEATURES. To serve both without a sequential `/me` + `/roles` chain, the GET /roles handler is updated to: (a) accept MANAGE_USERS OR MANAGE_FEATURES, and (b) return full `listRoles` data (including `description`). The users dropdown form only reads `id` and `name` — backward-compatible.

### D4 — `FieldEntry` type moved to `lib/types/field-entry.ts`
`edit-component-form.tsx`, `create-component-form.tsx`, and `actions.ts` (all in `app/[orgSlug]/`) import `FieldEntry` type from `@/lib/data/components`. The new ESLint ban rule would flag these. The type is extracted to `lib/types/field-entry.ts` (re-exported from `lib/data/components.ts` for backward compat). The form files and `actions.ts` import from `@/lib/types/field-entry` instead. API route files (already in `app/api/`) are unaffected.

### D5 — `lib/data/session.ts` CANNOT be deleted this batch
Three deferred files still import from it: `design/page.tsx`, `design/add-wall/page.tsx`, `design/add-wall/actions.ts`. The stage doc says to delete it "only once you've confirmed via grep that nothing still imports from it." Confirmed: it cannot be deleted. ESLint disable comments (with "deferred per stage-12.md" notes) added to those three files so lint passes.

### D6 — `login/page.tsx` migrated to `internalFetch('/api/v1/orgs')` 
The login page imports `getOrgBySlug`, `getOrgById` from `@/lib/data/admin`. The new ESLint rule would catch it. Migration: call the public `/api/v1/orgs` endpoint (returns all orgs with `{ id, slug, name }`), find org by slug (defensive guard), find session org by id (cross-org notice). This removes the DAL dependency cleanly.

### D7 — `orders/page.tsx`, `projects/new/page.tsx`, `inquiries/new/page.tsx` migrated
All three import `requireSession` from `@/lib/data/session`. After migration: `orders/page.tsx` uses `/me` for auth check. `projects/new/page.tsx` and `inquiries/new/page.tsx` switch `requireSession` to `internalFetch('/api/v1/orgs/${orgSlug}/me')`, using the `externalCompanyId` from the response for UI branching (D2 above).

---

## Files to change

### New files (11)
- `lib/types/field-entry.ts` — FieldEntry type extracted from lib/data/components.ts
- `app/api/v1/orgs/route.ts` — GET, public, org selector list
- `app/api/v1/orgs/[orgSlug]/me/route.ts` — GET, auth-only, returns rich session data
- `app/api/v1/orgs/[orgSlug]/roles/[roleId]/route.ts` — GET, MANAGE_FEATURES
- `app/api/v1/orgs/[orgSlug]/roles/[roleId]/permissions/route.ts` — GET/POST/DELETE, MANAGE_FEATURES
- `app/api/v1/permissions/route.ts` — GET/POST, global, MANAGE_FEATURES (D1)
- `app/[orgSlug]/admin/roles/loading.tsx`
- `app/[orgSlug]/admin/permissions/loading.tsx`
- `app/[orgSlug]/admin/components/loading.tsx`
- `app/[orgSlug]/admin/external-companies/loading.tsx`

### Modified files (30)
- `lib/data/components.ts` — re-export FieldEntry from lib/types/ (D4)
- `app/api/v1/orgs/[orgSlug]/roles/route.ts` — add POST; update GET (D3)
- `app/[orgSlug]/admin/roles/page.tsx` — parallel /me + GET /roles, gate MANAGE_FEATURES
- `app/[orgSlug]/admin/roles/new/page.tsx` — /me auth+MANAGE_FEATURES gate
- `app/[orgSlug]/admin/roles/actions.ts` — thin marshalers: POST /roles, POST/DELETE /roles/[id]/permissions
- `app/[orgSlug]/admin/roles/[roleId]/page.tsx` — parallel GET /roles/[id] + GET /roles/[id]/permissions + GET /permissions
- `app/[orgSlug]/admin/permissions/page.tsx` — internalFetch GET /permissions
- `app/[orgSlug]/admin/permissions/new/page.tsx` — /me auth+MANAGE_FEATURES gate
- `app/[orgSlug]/admin/permissions/actions.ts` — thin marshaler: POST /permissions
- `app/[orgSlug]/admin/components/page.tsx` — /me MANAGE_FEATURES check + GET /component-types
- `app/[orgSlug]/admin/components/new/page.tsx` — /me MANAGE_FEATURES check + GET /component-categories
- `app/[orgSlug]/admin/components/[typeId]/page.tsx` — GET /component-types/[id] + GET /component-categories
- `app/[orgSlug]/admin/components/actions.ts` — thin marshalers; import FieldEntry from lib/types/ (D4)
- `app/[orgSlug]/admin/components/[typeId]/edit-component-form.tsx` — import FieldEntry from lib/types/ (D4)
- `app/[orgSlug]/admin/components/new/create-component-form.tsx` — import FieldEntry from lib/types/ (D4)
- `app/[orgSlug]/admin/external-companies/page.tsx` — /me MANAGE_USERS check + GET /external-companies
- `app/[orgSlug]/admin/external-companies/new/page.tsx` — /me MANAGE_USERS check
- `app/[orgSlug]/admin/external-companies/actions.ts` — thin marshaler: POST /external-companies
- `app/[orgSlug]/layout.tsx` — switch to internalFetch /me
- `app/[orgSlug]/admin/layout.tsx` — switch to internalFetch /me
- `app/[orgSlug]/dashboard/page.tsx` — switch to internalFetch /me (rich response per D2)
- `app/[orgSlug]/orders/page.tsx` — switch to internalFetch /me (D7)
- `app/[orgSlug]/projects/new/page.tsx` — switch requireSession → /me (D7)
- `app/[orgSlug]/inquiries/new/page.tsx` — switch requireSession → /me (D7)
- `app/[orgSlug]/login/page.tsx` — switch DAL → internalFetch /api/v1/orgs (D6)
- `app/page.tsx` — switch listOrganizationsForSelector → internalFetch /api/v1/orgs
- `app/[orgSlug]/projects/[projectId]/design/page.tsx` — eslint-disable for deferred imports (D5)
- `app/[orgSlug]/projects/[projectId]/design/add-wall/page.tsx` — eslint-disable (D5)
- `app/[orgSlug]/projects/[projectId]/design/add-wall/actions.ts` — eslint-disable (D5)
- `eslint.config.mjs` — add lib/data/* ban for app/[orgSlug]/**
- `quotation-system-docs/design-docs/sql-queries/by-page.sql` — add batch 6 SQL sections

### Deleted (0 — lib/data/session.ts cannot be deleted; deferred files still import it per D5)

---

## Reused patterns (by path)
- `lib/api-auth.ts` — `getApiSession`, `ApiAuthError` — frozen, reused by all org-scoped routes
- `lib/api-error.ts` — all factories — frozen
- `lib/internal-fetch.ts` — `internalFetch` — frozen
- `lib/orgHref.ts` — for redirect targets in actions
- `lib/rbac.ts` — `requirePermission`, `PERMISSIONS`, `ForbiddenError`
- `lib/data/admin.ts` — DAL: `listRoles`, `createRole`, `getRoleById`, `listRolePermissions`, `addRolePermission`, `removeRolePermission`, `listPermissions`, `createPermission`, `listOrganizationsForSelector`, `getAdminPermissions`, `getOrgById`, `getSessionRole`, `getSessionRolePermissions`
- `lib/data/components.ts` — DAL: `listComponentTypes`, `getComponentTypeById`, `listComponentCategories`, `createComponentType`, `updateComponentType`
- `lib/data/external-companies.ts` — DAL: `listExternalCompanies`, `createExternalCompany`
- `lib/auth.ts` — `auth.api.getSession` (used directly in /api/v1/permissions for no-orgSlug auth)
- Batch 3's `component-types/route.ts` and `component-categories/route.ts` — consumed by admin/components pages
- Batch 5's `roles/route.ts` — extended in this batch

## How I'll verify
1. `npm run lint` — 0 errors (including the new ban rule)
2. `npx tsc --noEmit` — 0 errors
3. Push `feature/batch6-admin-capstone` → wait for Vercel preview READY
4. Check build log route list for all new routes
5. Hit `/api/health` → `{ database: "connected" }`
6. Unauthenticated checks: `/api/v1/orgs` → 200 public; `/api/v1/orgs/vistra/me` → 401; `/api/v1/permissions` → 401
7. Manual functional verification with authenticated session (detailed in return report)
