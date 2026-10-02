import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import { apiBadRequest, apiUnauthorized, apiConflict, apiServerError } from "@/lib/api-error";
import {
  validateSuperAdminUsername,
  validateSuperAdminPassword,
} from "@/lib/superadmin-accounts";
import { listSuperAdmins, createSuperAdmin } from "@/lib/data/superadmin/admins";
import { writeSuperAdminAudit } from "@/lib/data/superadmin/audit";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/admins ───────────────────────────────────────────
//
// Lists SuperAdmin accounts (hotfix 2026-10-02). Never returns the password hash.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Returns 200 { admins: [{ id, username, createdAt, protected, isSelf }] }.

export async function GET(request: Request): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/admins] auth error", err);
    return apiServerError();
  }

  try {
    return NextResponse.json({ admins: await listSuperAdmins(sa.superAdminId) });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/admins] listSuperAdmins", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/admins ──────────────────────────────────────────
//
// Creates a SuperAdmin account. Body: { username, password }.
// Writes one SuperAdminAuditLog row (action "superadmin.create") — never the password.
//
// Returns 201 { admin: { id, username } }; 400 invalid fields; 409 duplicate username; 401.

export async function POST(request: Request): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/admins] auth error", err);
    return apiServerError();
  }

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

  if (typeof b.username !== "string" || typeof b.password !== "string") {
    return apiBadRequest("username and password are required");
  }
  const username = b.username.trim().toLowerCase();
  const usernameError = validateSuperAdminUsername(username);
  if (usernameError) return apiBadRequest(usernameError);
  const passwordError = validateSuperAdminPassword(b.password);
  if (passwordError) return apiBadRequest(passwordError);

  let result;
  try {
    result = await createSuperAdmin(username, b.password);
  } catch (err) {
    console.error("[POST /api/v1/superadmin/admins] createSuperAdmin", err);
    return apiServerError();
  }
  if (!result.ok) return apiConflict(result.message);

  // Audit after commit; not wrapped — a failed audit write surfaces as 500.
  await writeSuperAdminAudit({
    superAdminId: sa.superAdminId,
    action: "superadmin.create",
    targetType: "SuperAdmin",
    targetId: result.admin.id,
    metadata: { username: result.admin.username },
  });

  return NextResponse.json({ admin: result.admin }, { status: 201 });
}
