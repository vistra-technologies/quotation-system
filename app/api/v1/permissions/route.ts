import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiConflict,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { ApiAuthError, apiAuthErrorResponse, assertSessionOrgNotSuspended } from "@/lib/api-auth";
import { listPermissions, createPermission } from "@/lib/data/admin";
import type { SessionData } from "@/lib/session";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── Shared auth helper ───────────────────────────────────────────────────────

/**
 * Authenticate for the global (no-orgSlug) /api/v1/permissions endpoint.
 *
 * Cannot call getApiSession(request, orgSlug) here because there is no orgSlug
 * in the URL — Permission rows are global (no organizationId), so the cross-tenant
 * guard in getApiSession() does not apply.  Instead we read the session cookie
 * directly (same call getApiSession() makes internally) and check active + MANAGE_FEATURES.
 *
 * Suspension (Stage 29 fix round 1): refused via assertSessionOrgNotSuspended() in lib/api-auth.ts.
 * The session's own org is used
 * implicitly: the user's MANAGE_FEATURES permission comes from their org's role, and
 * the data returned is global (not org-scoped), so no additional tenant check is needed.
 */
async function getPermissionsSession(
  request: Request,
): Promise<{ session: SessionData } | NextResponse> {
  // Bearer token seam — placeholder, same as getApiSession().
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return apiUnauthorized("Bearer token authentication not yet supported");
  }

  const rawSession = await auth.api.getSession({ headers: request.headers });

  if (!rawSession) {
    return apiUnauthorized("Not authenticated");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = rawSession.user as any;

  if (!u.active) {
    return apiUnauthorized("Account is deactivated");
  }

  // Suspended means no org-user access at all (Stage 29 S29-9), same as getApiSession() step 4.
  try {
    await assertSessionOrgNotSuspended(u.organizationId as string);
  } catch (err) {
    if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
    throw err;
  }

  const session: SessionData = {
    userId: u.id as string,
    organizationId: u.organizationId as string,
    roleId: u.roleId as string,
    externalCompanyId: (u.externalCompanyId as string | null | undefined) ?? null,
    // Hotfix 2026-10-05: required by SessionData.  This session only feeds the MANAGE_FEATURES
    // check (roleId/organizationId) and never reaches project/inquiry data, so we do not spend a
    // role read on it; true is the fail-closed value.
    isExternal: true,
    username: u.username as string,
    name: u.name as string,
  };

  return { session };
}

// ─── GET /api/v1/permissions ──────────────────────────────────────────────────

/**
 * List the global permission catalog, A→Z by code.
 *
 * Auth: authenticated user with MANAGE_FEATURES permission.
 * Note: Permission rows are GLOBAL — no organizationId; all orgs see the same catalog.
 *
 * Returns: { permissions: Array<{ id, code, description }> }
 */
export const GET = withRoute(
  "GET /api/v1/permissions",
  async (request: Request): Promise<NextResponse> => {
  const authResult = await getPermissionsSession(request);
  if (authResult instanceof NextResponse) return authResult;
  const { session } = authResult;

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[GET /api/v1/permissions] requirePermission", { err });
    return apiServerError();
  }

  try {
    const permissions = await listPermissions();
    return NextResponse.json({ permissions });
  } catch (err) {
    log.error("[GET /api/v1/permissions] listPermissions", { err });
    return apiServerError();
  }
});

// ─── POST /api/v1/permissions ─────────────────────────────────────────────────

/**
 * Create a new global Permission row.
 *
 * Auth: authenticated user with MANAGE_FEATURES permission.
 * Body: { code: string, description: string }
 *
 * Returns 201 on success.
 * Returns 400 if code or description is missing.
 * Returns 409 if the code already exists (unique constraint P2002).
 * Returns 403 if MANAGE_FEATURES is not held by the session role.
 *
 * ⚠ Creating a Permission row grants NO capability until a developer wires it
 *   in code via requirePermission(session, "<code>").
 */
export const POST = withRoute(
  "POST /api/v1/permissions",
  async (request: Request): Promise<NextResponse> => {
  const authResult = await getPermissionsSession(request);
  if (authResult instanceof NextResponse) return authResult;
  const { session } = authResult;

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[POST /api/v1/permissions] requirePermission", { err });
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const code =
    typeof body.code === "string" ? body.code.trim().toUpperCase() : null;
  const description =
    typeof body.description === "string" ? body.description.trim() : null;

  if (!code) return apiBadRequest("code is required");
  if (!description) return apiBadRequest("description is required");

  try {
    await createPermission({ code, description });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err: unknown) {
    // P2002 = unique constraint violation — code already exists in the global catalog.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return apiConflict(`Permission code "${code}" already exists`);
    }
    log.error("[POST /api/v1/permissions] createPermission", { err });
    return apiServerError();
  }
});
