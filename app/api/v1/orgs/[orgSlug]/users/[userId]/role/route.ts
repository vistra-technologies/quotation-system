import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { changeUserRole } from "@/lib/data/users";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role ────────────────────────

/**
 * Change a user's role.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body: { roleId: string }
 *
 * Returns 200 { ok: true } on success.
 * Returns 400 on missing roleId or if the new role does not belong to the org.
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and changeUserRole()
 *          calling assertUserInOrg() + verifying the new role belongs to
 *          session.organizationId before writing.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; userId: string }> },
) {
  const { orgSlug, userId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role] requirePermission",
      err,
    );
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const roleId =
    typeof body.roleId === "string" ? body.roleId.trim() : null;

  if (!roleId) return apiBadRequest("roleId is required");

  try {
    await changeUserRole(session, userId, roleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("not found")) {
        // "User not found or access denied" or "Role not found or access denied"
        return apiBadRequest(err.message);
      }
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role] changeUserRole",
      err,
    );
    return apiServerError();
  }
}
