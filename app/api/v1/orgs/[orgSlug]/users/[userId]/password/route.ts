import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { auth } from "@/lib/auth";
import { setUserPassword } from "@/lib/data/users";
import { isValidPassword, PASSWORD_TOO_SHORT_MESSAGE } from "@/lib/user-validation";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

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
 * Returns 400 on a missing or too-short (under 8 characters) password.
 * Revokes the target's sessions in the same transaction (the caller's own session survives when
 * they reset their own password).
 * Returns 404 if the user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and setUserPassword()
 *          calling assertUserInOrg() before writing.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/users/[userId]/password",
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
    log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/password]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/password] requirePermission", { err });
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
  if (!isValidPassword(password)) return apiBadRequest(PASSWORD_TOO_SHORT_MESSAGE);

  // Stage 31 S31-2 P2: every session of the target is revoked with the reset. When the admin resets
  // their OWN password, keep the acting session so they stay signed in (other sessions still go).
  let keepSessionId: string | null = null;
  if (userId === session.userId) {
    try {
      const current = await auth.api.getSession({ headers: request.headers });
      keepSessionId = current?.session.id ?? null;
    } catch (err) {
      log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/password] getSession", { err });
      return apiServerError();
    }
  }

  try {
    await setUserPassword(session, userId, password, keepSessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    log.error("[POST /api/v1/orgs/[orgSlug]/users/[userId]/password] setUserPassword", { err });
    return apiServerError();
  }
});
