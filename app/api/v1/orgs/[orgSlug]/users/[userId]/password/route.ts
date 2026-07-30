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
import { setUserPassword } from "@/lib/data/users";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/users/[userId]/password ─────────────────────

/**
 * Admin-set password for a user.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body: { password: string }
 *
 * The password is hashed with better-auth's own Scrypt hasher (same as sign-in
 * path) inside setUserPassword() — it is never logged, echoed, or returned.
 *
 * Returns 200 { ok: true } on success.
 * Returns 400 on missing password.
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and setUserPassword()
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
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/password]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/password] requirePermission",
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

  const password =
    typeof body.password === "string" ? body.password : null;

  if (!password) return apiBadRequest("password is required");

  try {
    await setUserPassword(session, userId, password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users/[userId]/password] setUserPassword",
      err,
    );
    return apiServerError();
  }
}
