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
import {
  getRoleById,
  listRolePermissions,
  addRolePermission,
  removeRolePermission,
} from "@/lib/data/admin";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions ───────────────────

/**
 * List the permissions currently granted to a role, A→Z by code.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Tenancy: getRoleById() confirms the role belongs to the session's org before
 *          listRolePermissions() runs — mirrors the same guard in GET /roles/[roleId].
 *          Without this, a MANAGE_FEATURES user who knows a foreign role UUID could
 *          read that role's permission assignments (cross-org read leak).
 *
 * Returns: { rolePermissions: Array<{ permissionId, permission: { id, code, description } }> }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; roleId: string }> },
) {
  const { orgSlug, roleId } = await params;

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
      "[GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    // Org-membership guard: getRoleById() returns null for roles that don't
    // belong to the session's org. Mirrors the guard in GET /roles/[roleId].
    const role = await getRoleById(session, roleId);
    if (!role) return apiNotFound("Role not found");
    const rolePermissions = await listRolePermissions(roleId);
    return NextResponse.json({ rolePermissions });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions] listRolePermissions",
      err,
    );
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions ──────────────────

/**
 * Grant a permission to a role (upsert — idempotent if already granted).
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Body: { permissionId: string }
 * Tenancy: assertRoleInOrg inside addRolePermission() confirms the role belongs
 *          to the session's organization.
 *
 * Returns 201 on success (or no-op idempotent upsert).
 * Returns 400 if permissionId is missing.
 * Returns 403 if MANAGE_FEATURES is not held.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; roleId: string }> },
) {
  const { orgSlug, roleId } = await params;

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
      "[POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions] requirePermission",
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

  const permissionId =
    typeof body.permissionId === "string" ? body.permissionId.trim() : null;
  if (!permissionId) return apiBadRequest("permissionId is required");

  try {
    await addRolePermission(session, roleId, permissionId);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions] addRolePermission",
      err,
    );
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions ────────────────

/**
 * Revoke a permission from a role.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Body: { permissionId: string }
 * Tenancy: assertRoleInOrg inside removeRolePermission() confirms the role belongs
 *          to the session's organization.
 *
 * Returns 200 on success.
 * Returns 400 if permissionId is missing.
 * Returns 403 if MANAGE_FEATURES is not held.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; roleId: string }> },
) {
  const { orgSlug, roleId } = await params;

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
      "[DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions] requirePermission",
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

  const permissionId =
    typeof body.permissionId === "string" ? body.permissionId.trim() : null;
  if (!permissionId) return apiBadRequest("permissionId is required");

  try {
    await removeRolePermission(session, roleId, permissionId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/roles/[roleId]/permissions] removeRolePermission",
      err,
    );
    return apiServerError();
  }
}
