import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiForbidden,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { changeUserRole, LAST_MANAGER_MESSAGE } from "@/lib/data/users";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

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
 * Returns 400 on missing roleId, if the new role does not belong to the org, if an external role
 *   is given to a user without an external company (U3), or if the change would leave the org
 *   with no active user manager (Stage 31 S31-3).
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and changeUserRole()
 *          calling assertUserInOrg() + verifying the new role belongs to
 *          session.organizationId before writing.
 */
export const PATCH = withRoute(
  "PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; userId: string }> },
) => {
  const { orgSlug, userId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("[PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role] requirePermission", { err });
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
      if (
        err.message.includes("not found") || // "User/Role not found or access denied"
        err.message.includes("External company is required") || // U3 (S31-3)
        err.message === LAST_MANAGER_MESSAGE // last active user manager (S31-3)
      ) {
        return apiBadRequest(err.message);
      }
    }
    log.error("[PATCH /api/v1/orgs/[orgSlug]/users/[userId]/role] changeUserRole", { err });
    return apiServerError();
  }
});
