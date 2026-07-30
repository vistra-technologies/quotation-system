import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { listRolesForDropdown } from "@/lib/data/admin";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/roles ────────────────────────────────────────

/**
 * List all roles for the session org as id/name pairs (A→Z), for use in
 * form dropdowns (e.g. create-user and user-detail role-change forms).
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Permission note: the roles list needs only MANAGE_USERS (not MANAGE_FEATURES)
 * because it is consumed by the user-admin form's role dropdown — a user with
 * MANAGE_USERS but not MANAGE_FEATURES must be able to assign roles when
 * creating or editing users.  Batch 6 will add the MANAGE_FEATURES-gated
 * role-admin CRUD endpoints (GET detail, POST create, role permissions CRUD).
 *
 * NOTE: POST (create role) is NOT implemented here — that is Batch 6's scope.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and
 *          listRolesForDropdown() filtering on session.organizationId.
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
    console.error("[GET /api/v1/orgs/[orgSlug]/roles]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/roles] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const roles = await listRolesForDropdown(session);
    return NextResponse.json({ roles });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/roles] listRolesForDropdown",
      err,
    );
    return apiServerError();
  }
}
