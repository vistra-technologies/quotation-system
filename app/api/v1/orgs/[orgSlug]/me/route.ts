import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import {
  getOrgById,
  getSessionRole,
  getSessionRolePermissions,
} from "@/lib/data/admin";
import { PERMISSIONS } from "@/lib/rbac";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/me ───────────────────────────────────────────

/**
 * Return the current session user's identity and permissions for this org.
 *
 * Auth: any authenticated org member — no RBAC gate beyond a valid session.
 * Returns 401 if there is no session; 403 if the session belongs to a different
 * org; 404 if the org slug is not found.
 *
 * Response shape:
 *   {
 *     userId, name, username,          // identity
 *     externalCompanyId,               // null for internal users
 *     orgName,                         // organization display name
 *     roleName,                        // user's role display name
 *     permissionCodes: string[],       // ALL effective permission codes for this role
 *     adminPermissions: string[],      // subset: MANAGE_USERS / MANAGE_FEATURES only
 *   }
 *
 * Consumers:
 *   - app/[orgSlug]/layout.tsx  — uses name, username, adminPermissions for shell chrome
 *   - app/[orgSlug]/admin/layout.tsx  — uses adminPermissions for admin gate + nav links
 *   - app/[orgSlug]/dashboard/page.tsx  — uses orgName, roleName, permissionCodes
 *   - admin/roles/*, admin/permissions/*, admin/components/*, admin/external-companies/*
 *     — use adminPermissions to gate MANAGE_FEATURES / MANAGE_USERS checks at page level
 *   - app/[orgSlug]/projects/new/page.tsx, inquiries/new/page.tsx
 *     — use externalCompanyId for locked-client UI branching
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/me]", err);
    return apiServerError();
  }

  try {
    // Parallel: org name, role name, all permission codes.
    const [org, role, permissionCodes] = await Promise.all([
      getOrgById(session.organizationId),
      getSessionRole(session),
      getSessionRolePermissions(session),
    ]);

    const adminPermissions = permissionCodes.filter(
      (c) => c === PERMISSIONS.MANAGE_USERS || c === PERMISSIONS.MANAGE_FEATURES,
    );

    return NextResponse.json({
      userId: session.userId,
      name: session.name,
      username: session.username,
      externalCompanyId: session.externalCompanyId,
      orgName: org?.name ?? session.organizationId,
      roleName: role?.name ?? session.roleId,
      permissionCodes,
      adminPermissions,
    });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/me] data fetch", err);
    return apiServerError();
  }
}
