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
import { getUserById, deleteUser } from "@/lib/data/users";

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
export async function GET(
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
    console.error("[GET /api/v1/orgs/[orgSlug]/users/[userId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/users/[userId]] requirePermission",
      err,
    );
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
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/users/[userId]] getUserById",
      err,
    );
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/users/[userId] ────────────────────────────

/**
 * Delete a user from the org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Returns 204 on success (no body).
 * Returns 400 if the user cannot be deleted (self-delete guard, or has associated
 *   projects/inquiries that would violate FK constraints).
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and deleteUser()
 *          calling assertUserInOrg() before any mutation.
 */
export async function DELETE(
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
    console.error("[DELETE /api/v1/orgs/[orgSlug]/users/[userId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/users/[userId]] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    await deleteUser(session, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes("cannot delete your own account") ||
        err.message.includes("not found or access denied") ||
        err.message.includes("Cannot delete this user")
      ) {
        return apiBadRequest(err.message);
      }
    }
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/users/[userId]] deleteUser",
      err,
    );
    return apiServerError();
  }
}
