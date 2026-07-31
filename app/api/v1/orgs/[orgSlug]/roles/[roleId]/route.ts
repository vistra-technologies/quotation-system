import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { getRoleById } from "@/lib/data/admin";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/roles/[roleId] ───────────────────────────────

/**
 * Get a single role by ID, scoped to the org.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getRoleById()
 *          filtering on session.organizationId — returns null for roles that
 *          belong to a different org, surfaced as 404.
 *
 * Returns: { role } with the full role row (id, organizationId, name, description, ...).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; roleId: string }> },
) {
  const { orgSlug, roleId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/roles/[roleId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/roles/[roleId]] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const role = await getRoleById(session, roleId);
    if (!role) return apiNotFound("Role not found");
    return NextResponse.json({ role });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/roles/[roleId]] getRoleById",
      err,
    );
    return apiServerError();
  }
}
