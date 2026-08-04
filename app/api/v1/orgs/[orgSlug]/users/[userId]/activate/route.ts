import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { activateUser } from "@/lib/data/users";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/users/[userId]/activate ─────────────────────

/**
 * Activate a user (sets active = true).
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Returns 200 { ok: true } on success.
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and activateUser()
 *          calling assertUserInOrg() before writing.
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
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/activate]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/activate] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    await activateUser(session, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/activate] activateUser",
      err,
    );
    return apiServerError();
  }
}
