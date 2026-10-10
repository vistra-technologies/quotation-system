import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { getUserById, deleteUser } from "@/lib/data/users";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/users/[userId] ───────────────────────────────

/**
 * Get a single user by ID, scoped to the session org, with role name.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Returns { user, isSelf } where isSelf is true when the requesting user is
 * the same as the target — used by the detail page to gate the deactivate button
 * without needing a separate session lookup in the Server Component.
 *
 * Returns 404 if the user does not exist in the org (getUserById scopes by both
 * id and organizationId — items from other orgs are indistinguishable from missing).
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getUserById()
 *          filtering on session.organizationId.
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/users/[userId]",
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
    log.error("[GET /api/v1/orgs/[orgSlug]/users/[userId]]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[GET /api/v1/orgs/[orgSlug]/users/[userId]] requirePermission", { err });
    return apiServerError();
  }

  try {
    const user = await getUserById(session, userId);
    if (!user) {
      return apiNotFound("User not found");
    }
    const isSelf = session.userId === userId;
    return NextResponse.json({ user, isSelf });
  } catch (err) {
    log.error("[GET /api/v1/orgs/[orgSlug]/users/[userId]] getUserById", { err });
    return apiServerError();
  }
});

// ─── DELETE /api/v1/orgs/[orgSlug]/users/[userId] ────────────────────────────

/**
 * Delete a user from the org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Returns 204 on success (no body).
 * Never blocked by the user's records (Stage 31 S31-4): their projects/inquiries stay, attributed
 *   to a snapshot of the user's name.
 * Returns 400 for the self-delete guard (and, until S31-10, for an unknown/other-org id).
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and deleteUser()
 *          calling assertUserInOrg() before any mutation.
 */
export const DELETE = withRoute(
  "DELETE /api/v1/orgs/[orgSlug]/users/[userId]",
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
    log.error("[DELETE /api/v1/orgs/[orgSlug]/users/[userId]]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[DELETE /api/v1/orgs/[orgSlug]/users/[userId]] requirePermission", { err });
    return apiServerError();
  }

  try {
    await deleteUser(session, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes("cannot delete your own account") ||
        err.message.includes("not found or access denied")
      ) {
        return apiBadRequest(err.message);
      }
    }
    log.error("[DELETE /api/v1/orgs/[orgSlug]/users/[userId]] deleteUser", { err });
    return apiServerError();
  }
});
