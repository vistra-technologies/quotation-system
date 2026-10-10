import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { reassignUserWork } from "@/lib/data/users";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/users/[userId]/reassign-work ────────────────

/**
 * Reassign work (Stage 31 S31-4a): move every project and inquiry created by [userId] to another
 * active user of the same org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body: { toUserId: string }
 *
 * Returns 200 { projects: n, inquiries: m } (counts moved).
 * Returns 400 for a missing toUserId, the same user, an inactive target, or an external target
 *   that cannot access some of the records ("Target user cannot access N of these records",
 *   nothing moves).
 * Returns 404 if either user does not exist in the org (other-org ids look identical).
 *
 * Tenancy: both users are checked against session.organizationId inside reassignUserWork()'s
 *          transaction before any write.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/users/[userId]/reassign-work",
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
    log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/reassign-work]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/reassign-work] requirePermission", { err });
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiBadRequest("Request body must be a JSON object");
  }

  const toUserId = typeof body.toUserId === "string" ? body.toUserId.trim() : "";
  if (!toUserId) return apiBadRequest("toUserId is required");

  try {
    const moved = await reassignUserWork(session, userId, toUserId);
    return NextResponse.json(moved);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("not found or access denied")) {
        return apiNotFound("User not found");
      }
      if (
        err.message.includes("same user") ||
        err.message.includes("must be active") ||
        err.message.includes("cannot access")
      ) {
        return apiBadRequest(err.message);
      }
    }
    log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/reassign-work] reassignUserWork", { err });
    return apiServerError();
  }
});
