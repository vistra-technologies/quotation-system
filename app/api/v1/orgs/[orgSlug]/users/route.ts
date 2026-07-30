import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { listUsers, createUser } from "@/lib/data/users";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/users ────────────────────────────────────────

/**
 * List all users in the session org, A→Z by username, with role name.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listUsers()
 *          filtering on session.organizationId.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/users]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error("[GET /api/v1/orgs/[orgSlug]/users] requirePermission", err);
    return apiServerError();
  }

  try {
    const users = await listUsers(session);
    return NextResponse.json({ users });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/users] listUsers", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/users ───────────────────────────────────────

/**
 * Create a new user + better-auth credential account in the session org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body: { username, roleId, password, externalCompanyId? }
 *
 * Returns 201 with { user: { id } } on success.
 * Returns 400 on missing/invalid fields or FK violations (role/company not found).
 * Returns 409 on duplicate username within the org.
 * Returns 403 if the session role lacks MANAGE_USERS.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and createUser()
 *          verifying role + externalCompany belong to session org.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/users]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/users] requirePermission",
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

  const username =
    typeof body.username === "string" ? body.username.trim() : null;
  const roleId =
    typeof body.roleId === "string" ? body.roleId.trim() : null;
  const password =
    typeof body.password === "string" ? body.password : null;
  const externalCompanyId =
    typeof body.externalCompanyId === "string" && body.externalCompanyId
      ? body.externalCompanyId.trim()
      : null;

  if (!username) return apiBadRequest("username is required");
  if (!roleId) return apiBadRequest("roleId is required");
  if (!password) return apiBadRequest("password is required");

  try {
    await createUser(session, { username, roleId, externalCompanyId, password });
    return NextResponse.json({ user: { username } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("already taken")) {
        return apiConflict(err.message);
      }
      if (
        err.message.includes("not found or access denied") ||
        err.message.includes("Role not found") ||
        err.message.includes("External company not found")
      ) {
        return apiBadRequest(err.message);
      }
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/users] createUser", err);
    return apiServerError();
  }
}
