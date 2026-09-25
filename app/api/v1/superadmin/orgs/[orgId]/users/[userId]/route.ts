import { NextResponse } from "next/server";
import {
  requireSuperAdminFromRequest,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { createOrgAuditLog } from "@/lib/data/superadmin/orgs";
import { updateUserInOrg, type UpdateUserInOrgInput } from "@/lib/data/superadmin/users";

// Never cached.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/superadmin/orgs/[orgId]/users/[userId] ─────────────────────
//
// Edit an existing user (hotfix 2026-09-25, H-5). Lifts the Stage 17 add-only boundary.
// Tenancy checks (user in org, role in org, U3 company rule) live in updateUserInOrg().
// Writes one SuperAdminAuditLog row: action "user.update", targetType "User", with the
// changed field names in metadata — never the password.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body (all optional, at least one): { firstName, lastName, mobile, profileEmail, roleId,
//   active, newPassword } — mobile/profileEmail accept "" or null to clear. Username is not editable.
//
// Returns 200 { user: { id }, changedFields } on success.
// Returns 400 on invalid fields, a role from another org, or the U3 company rule.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the user is not in this org.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[PATCH /api/v1/superadmin/orgs/[orgId]/users/[userId]] auth error", err);
    return apiServerError();
  }

  const { orgId, userId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiBadRequest("Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if ("username" in b) return apiBadRequest("username cannot be changed");

  const input: UpdateUserInOrgInput = {};

  for (const key of ["firstName", "lastName"] as const) {
    if (b[key] !== undefined) {
      if (typeof b[key] !== "string" || !(b[key] as string).trim()) {
        return apiBadRequest(`${key} must be a non-empty string`);
      }
      input[key] = (b[key] as string).trim();
    }
  }
  for (const key of ["mobile", "profileEmail"] as const) {
    if (b[key] !== undefined) {
      if (b[key] !== null && typeof b[key] !== "string") {
        return apiBadRequest(`${key} must be a string or null`);
      }
      input[key] = typeof b[key] === "string" && (b[key] as string).trim() ? (b[key] as string).trim() : null;
    }
  }
  if (b.roleId !== undefined) {
    if (typeof b.roleId !== "string" || !b.roleId.trim()) {
      return apiBadRequest("roleId must be a non-empty string");
    }
    input.roleId = b.roleId.trim();
  }
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") return apiBadRequest("active must be a boolean");
    input.active = b.active;
  }
  if (b.newPassword !== undefined && b.newPassword !== null && b.newPassword !== "") {
    if (typeof b.newPassword !== "string" || b.newPassword.length < 8) {
      return apiBadRequest("newPassword must be at least 8 characters");
    }
    input.newPassword = b.newPassword;
  }

  if (Object.keys(input).length === 0) {
    return apiBadRequest("At least one editable field must be provided");
  }

  let result;
  try {
    result = await updateUserInOrg(orgId, userId, input);
  } catch (err) {
    console.error("[PATCH /api/v1/superadmin/orgs/[orgId]/users/[userId]] updateUserInOrg", err);
    return apiServerError();
  }

  if (!result.ok) {
    if (result.reason === "user_not_found") return apiNotFound(result.message);
    return apiBadRequest(result.message);
  }

  // Audit after commit; not wrapped — a failed audit write surfaces as 500.
  await createOrgAuditLog(
    sa.superAdminId,
    userId,
    "user.update",
    { organizationId: orgId, changedFields: result.changedFields },
    "User",
  );

  return NextResponse.json({ user: { id: userId }, changedFields: result.changedFields });
}
