import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { validateSuperAdminPassword } from "@/lib/superadmin-accounts";
import { changeSuperAdminPassword, deleteSuperAdmin } from "@/lib/data/superadmin/admins";
import { writeSuperAdminAudit } from "@/lib/data/superadmin/audit";

// Never cached.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/superadmin/admins/[adminId] ───────────────────────────────
//
// Changes a SuperAdmin's password (hotfix 2026-10-02). Allowed for every account, including the
// protected `devadmin` and the caller's own. Body: { newPassword }.
// Revokes the target's sessions — except the caller's current one when changing their own password.
// Audit "superadmin.password_change" (never the password).
//
// Returns 200 { admin: { id }, sessionsRevoked }; 400 invalid; 401; 404.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ adminId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[PATCH /api/v1/superadmin/admins/[adminId]] auth error", err);
    return apiServerError();
  }

  const { adminId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiBadRequest("Request body must be a JSON object");
  }
  const { newPassword } = body as Record<string, unknown>;
  const passwordError = validateSuperAdminPassword(newPassword);
  if (passwordError) return apiBadRequest(passwordError.replace(/^password/, "newPassword"));

  let result;
  try {
    result = await changeSuperAdminPassword(
      adminId,
      newPassword as string,
      adminId === sa.superAdminId ? sa.sessionId : null,
    );
  } catch (err) {
    console.error("[PATCH /api/v1/superadmin/admins/[adminId]] changeSuperAdminPassword", err);
    return apiServerError();
  }
  if (!result.ok) return apiNotFound(result.message);

  await writeSuperAdminAudit({
    superAdminId: sa.superAdminId,
    action: "superadmin.password_change",
    targetType: "SuperAdmin",
    targetId: adminId,
    metadata: { username: result.username, sessionsRevoked: result.sessionsRevoked },
  });

  return NextResponse.json({ admin: { id: adminId }, sessionsRevoked: result.sessionsRevoked });
}

// ─── DELETE /api/v1/superadmin/admins/[adminId] ──────────────────────────────
//
// Deletes a SuperAdmin (sessions cascade; their audit rows survive — see the 20261002000001
// migration). Audit "superadmin.delete" with the deleted username.
//
// Returns 200 { deleted: true }; 400 self-delete or last remaining SuperAdmin;
// 403 protected account (`devadmin`); 401; 404.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ adminId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[DELETE /api/v1/superadmin/admins/[adminId]] auth error", err);
    return apiServerError();
  }

  const { adminId } = await params;

  let result;
  try {
    result = await deleteSuperAdmin(adminId, sa.superAdminId);
  } catch (err) {
    console.error("[DELETE /api/v1/superadmin/admins/[adminId]] deleteSuperAdmin", err);
    return apiServerError();
  }

  if (!result.ok) {
    if (result.reason === "not_found") return apiNotFound(result.message);
    if (result.reason === "protected") return apiForbidden(result.message);
    return apiBadRequest(result.message); // self | last_admin
  }

  await writeSuperAdminAudit({
    superAdminId: sa.superAdminId,
    action: "superadmin.delete",
    targetType: "SuperAdmin",
    targetId: adminId,
    metadata: { deletedUsername: result.username },
  });

  return NextResponse.json({ deleted: true });
}
