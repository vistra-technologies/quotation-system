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
import { updateUserProfile } from "@/lib/data/users";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile ────────────────────────

/**
 * Update editable profile fields for a user in the session org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body (all fields optional — only supplied fields are updated):
 *   { firstName?, lastName?, mobile?, profileEmail?, externalCompanyId? }
 *
 * Returns 200 with { ok: true } on success.
 * Returns 400 if a field fails validation (e.g. external company required by role).
 * Returns 403 if the session role lacks MANAGE_USERS.
 * Returns 404 if the target user does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and updateUserProfile()
 *          filtering on both userId AND organizationId.
 *
 * Stage 15 Batch G (U4).
 */
export async function PUT(
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
    console.error("[PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile] requirePermission",
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

  // Build input — only include keys that were explicitly supplied in the body.
  // undefined means "not supplied"; null means "clear the field".
  const input: {
    firstName?: string;
    lastName?: string;
    mobile?: string | null;
    profileEmail?: string | null;
    externalCompanyId?: string | null;
  } = {};

  if ("firstName" in body) {
    const v = typeof body.firstName === "string" ? body.firstName.trim() : null;
    if (!v) return apiBadRequest("firstName cannot be empty");
    input.firstName = v;
  }
  if ("lastName" in body) {
    const v = typeof body.lastName === "string" ? body.lastName.trim() : null;
    if (!v) return apiBadRequest("lastName cannot be empty");
    input.lastName = v;
  }
  if ("mobile" in body) {
    input.mobile =
      typeof body.mobile === "string" && body.mobile.trim()
        ? body.mobile.trim()
        : null;
  }
  if ("profileEmail" in body) {
    input.profileEmail =
      typeof body.profileEmail === "string" && body.profileEmail.trim()
        ? body.profileEmail.trim()
        : null;
  }
  if ("externalCompanyId" in body) {
    input.externalCompanyId =
      typeof body.externalCompanyId === "string" && body.externalCompanyId
        ? body.externalCompanyId.trim()
        : null;
  }

  try {
    await updateUserProfile(session, userId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("not found or access denied")) {
        return apiNotFound("User not found");
      }
      if (
        err.message.includes("External company is required") ||
        err.message.includes("External company not found")
      ) {
        return apiBadRequest(err.message);
      }
    }
    console.error(
      "[PUT /api/v1/orgs/[orgSlug]/users/[userId]/profile] updateUserProfile",
      err,
    );
    return apiServerError();
  }
}
