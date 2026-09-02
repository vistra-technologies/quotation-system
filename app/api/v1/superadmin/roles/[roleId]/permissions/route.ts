import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import {
  listRolePermissionsForOrg,
  grantRolePermissionForOrg,
  revokeRolePermissionForOrg,
  createRoleAuditLog,
} from "@/lib/data/superadmin/roles";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/roles/[roleId]/permissions?orgId=xxx ─────────────
//
// Returns permissions currently granted to the role.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query: ?orgId=<organizationId>   — used to verify role belongs to that org.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
): Promise<NextResponse> {
  const { roleId } = await params;

  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/roles/[roleId]/permissions] auth error", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId")?.trim();

  if (!orgId) {
    return apiBadRequest("orgId query parameter is required");
  }

  try {
    const rolePermissions = await listRolePermissionsForOrg(orgId, roleId);
    if (rolePermissions === null) {
      return apiNotFound("Role not found or does not belong to the specified organization");
    }
    return NextResponse.json({ rolePermissions });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/roles/[roleId]/permissions] listRolePermissionsForOrg", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/roles/[roleId]/permissions ─────────────────────
//
// Grant a permission to a role (upsert — idempotent if already granted).
// Writes one SuperAdminAuditLog row with action "permission.assign" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; permissionId: string }
//
// Returns 201 on success.
// Returns 400 if orgId or permissionId is missing.
// Returns 404 if role not found or belongs to a different org.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
): Promise<NextResponse> {
  const { roleId } = await params;

  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/roles/[roleId]/permissions] auth error", err);
    return apiServerError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).orgId !== "string" ||
    typeof (body as Record<string, unknown>).permissionId !== "string"
  ) {
    return apiBadRequest("orgId and permissionId are required");
  }

  const orgId = ((body as Record<string, unknown>).orgId as string).trim();
  const permissionId = ((body as Record<string, unknown>).permissionId as string).trim();

  if (!orgId) return apiBadRequest("orgId is required");
  if (!permissionId) return apiBadRequest("permissionId is required");

  let ok: boolean;
  try {
    ok = await grantRolePermissionForOrg(orgId, roleId, permissionId);
  } catch (err) {
    console.error("[POST /api/v1/superadmin/roles/[roleId]/permissions] grantRolePermissionForOrg", err);
    return apiServerError();
  }

  if (!ok) {
    return apiNotFound("Role not found or does not belong to the specified organization");
  }

  // Write audit log after the mutation committed.
  // Not wrapped in try/catch — an audit failure propagates as 500.
  await createRoleAuditLog(sa.superAdminId, roleId, "permission.assign", {
    orgId,
    permissionId,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

// ─── DELETE /api/v1/superadmin/roles/[roleId]/permissions ────────────────────
//
// Revoke a permission from a role.
// Writes one SuperAdminAuditLog row with action "permission.revoke" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; permissionId: string }
//
// Returns 200 on success.
// Returns 400 if orgId or permissionId is missing.
// Returns 404 if role not found or belongs to a different org.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
): Promise<NextResponse> {
  const { roleId } = await params;

  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[DELETE /api/v1/superadmin/roles/[roleId]/permissions] auth error", err);
    return apiServerError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).orgId !== "string" ||
    typeof (body as Record<string, unknown>).permissionId !== "string"
  ) {
    return apiBadRequest("orgId and permissionId are required");
  }

  const orgId = ((body as Record<string, unknown>).orgId as string).trim();
  const permissionId = ((body as Record<string, unknown>).permissionId as string).trim();

  if (!orgId) return apiBadRequest("orgId is required");
  if (!permissionId) return apiBadRequest("permissionId is required");

  let ok: boolean;
  try {
    ok = await revokeRolePermissionForOrg(orgId, roleId, permissionId);
  } catch (err) {
    console.error("[DELETE /api/v1/superadmin/roles/[roleId]/permissions] revokeRolePermissionForOrg", err);
    return apiServerError();
  }

  if (!ok) {
    return apiNotFound("Role not found or does not belong to the specified organization");
  }

  // Write audit log after the mutation committed.
  // Not wrapped in try/catch — an audit failure propagates as 500.
  await createRoleAuditLog(sa.superAdminId, roleId, "permission.revoke", {
    orgId,
    permissionId,
  });

  return NextResponse.json({ success: true });
}
