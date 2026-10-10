import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { isUniqueViolation } from "@/lib/prisma-errors";
import {
  updateRoleNameForOrg,
  createRoleAuditLog,
} from "@/lib/data/superadmin/roles";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/superadmin/roles/[roleId] ─────────────────────────────────
//
// Renames an existing role.
// Writes one SuperAdminAuditLog row with action "role.rename" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; name: string }
//
// Returns 200 with { role } on success.
// Returns 400 on missing/invalid fields.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the role does not exist or belongs to a different org.
// Returns 409 if a role with this name already exists in the org.

export const PATCH = withRoute(
  "PATCH /api/v1/superadmin/roles/[roleId]",
  async (
  request: Request,
  { params }: { params: Promise<{ roleId: string }> },
): Promise<NextResponse> => {
  const { roleId } = await params;

  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    log.error("[PATCH /api/v1/superadmin/roles/[roleId]] auth error", { err });
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
    typeof (body as Record<string, unknown>).name !== "string"
  ) {
    return apiBadRequest("orgId and name are required");
  }

  const orgId = ((body as Record<string, unknown>).orgId as string).trim();
  const name = ((body as Record<string, unknown>).name as string).trim();

  if (!orgId) return apiBadRequest("orgId is required");
  if (!name) return apiBadRequest("name is required");

  let role;
  try {
    role = await updateRoleNameForOrg(orgId, roleId, name);
  } catch (err) {
    if (isUniqueViolation(err)) return apiConflict("A role with this name already exists");
    log.error("[PATCH /api/v1/superadmin/roles/[roleId]] updateRoleNameForOrg", { err });
    return apiServerError();
  }

  if (!role) {
    return apiNotFound("Role not found or does not belong to the specified organization");
  }

  // Write audit log after the mutation committed.
  // Not wrapped in try/catch — an audit failure propagates as 500.
  await createRoleAuditLog(sa.superAdminId, roleId, "role.rename", {
    orgId,
    newName: name,
  });

  return NextResponse.json({ role });
});
