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
import { deactivateUser } from "@/lib/data/users";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate ───────────────────

/**
 * Deactivate a user (sets active = false).
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Self-deactivation guard (business-critical):
 *   deactivateUser() in lib/data/users.ts throws Error("You cannot deactivate
 *   your own account") when userId === session.userId.  This handler catches
 *   that specific error and returns 400 — never 500 — so the client receives a
 *   descriptive error response rather than an unhandled crash.
 *
 *   The UI already disables the deactivate button when isSelf === true (computed
 *   in GET /users/[userId] response), so this is a defense-in-depth fallback.
 *   Critically, the guard lives in the DAL — not just the UI — so no bypass is
 *   possible through a direct API call.
 *
 * Returns 200 { ok: true } on success.
 * Returns 400 on self-deactivation attempt.
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and deactivateUser()
 *          calling assertUserInOrg() before any state change.
 */
export async function POST(
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
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    await deactivateUser(session, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      // Self-deactivation guard: DAL throws this; surface as 400 (not 500).
      if (err.message.includes("cannot deactivate your own account")) {
        return apiBadRequest(err.message);
      }
      if (err.message.includes("not found")) {
        return apiNotFound(err.message);
      }
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/deactivate] deactivateUser",
      err,
    );
    return apiServerError();
  }
}
