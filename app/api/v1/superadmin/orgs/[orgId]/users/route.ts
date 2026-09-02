import { NextResponse } from "next/server";
import {
  requireSuperAdminFromRequest,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiConflict,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { getOrgById, createOrgAuditLog } from "@/lib/data/superadmin/orgs";
import {
  listUsersInOrg,
  listExternalCompaniesInOrg,
  createUserInOrg,
} from "@/lib/data/superadmin/users";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/orgs/[orgId]/users ────────────────────────────────
//
// Returns all users in the given org (A→Z by username) alongside the org's
// external companies (for the add-user form dropdown).
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Returns 404 if the org does not exist.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/orgs/[orgId]/users] auth error", err);
    return apiServerError();
  }

  const { orgId } = await params;

  // Verify the org exists.
  const org = await getOrgById(orgId);
  if (!org) {
    return apiNotFound("Organization not found");
  }

  try {
    const [users, externalCompanies] = await Promise.all([
      listUsersInOrg(orgId),
      listExternalCompaniesInOrg(orgId),
    ]);
    return NextResponse.json({ users, externalCompanies });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/orgs/[orgId]/users]", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/orgs/[orgId]/users ───────────────────────────────
//
// Creates a new user + credential account in the given org.
// All tenancy checks (role in org, externalCompany in org, U3) are enforced by
// createUserInOrg() in the DAL.
// Writes one SuperAdminAuditLog row: action "user.create", targetType "User".
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { firstName, lastName, username, roleId, password, mobile?, profileEmail?, externalCompanyId? }
//
// Returns 201 with { user: { id, username } } on success.
// Returns 400 on missing/invalid fields or tenancy violations.
// Returns 404 if the org does not exist.
// Returns 409 on duplicate username within the org.
// Returns 401 when not authenticated as SuperAdmin.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/orgs/[orgId]/users] auth error", err);
    return apiServerError();
  }

  const { orgId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (typeof body !== "object" || body === null) {
    return apiBadRequest("Request body must be a JSON object");
  }

  const b = body as Record<string, unknown>;

  const firstName = typeof b.firstName === "string" ? b.firstName.trim() : null;
  const lastName = typeof b.lastName === "string" ? b.lastName.trim() : null;
  const username = typeof b.username === "string" ? b.username.trim() : null;
  const roleId = typeof b.roleId === "string" ? b.roleId.trim() : null;
  const password = typeof b.password === "string" ? b.password : null;
  const mobile =
    typeof b.mobile === "string" && b.mobile.trim() ? b.mobile.trim() : null;
  const profileEmail =
    typeof b.profileEmail === "string" && b.profileEmail.trim()
      ? b.profileEmail.trim()
      : null;
  const externalCompanyId =
    typeof b.externalCompanyId === "string" && b.externalCompanyId.trim()
      ? b.externalCompanyId.trim()
      : null;

  if (!firstName) return apiBadRequest("firstName is required");
  if (!lastName) return apiBadRequest("lastName is required");
  if (!username) return apiBadRequest("username is required");
  if (!roleId) return apiBadRequest("roleId is required");
  if (!password) return apiBadRequest("password is required");
  if (password.length < 8) {
    return apiBadRequest("password must be at least 8 characters");
  }

  const result = await createUserInOrg(orgId, {
    username,
    firstName,
    lastName,
    mobile,
    profileEmail,
    roleId,
    externalCompanyId,
    password,
  });

  if (!result.ok) {
    if (result.reason === "org_not_found") {
      return apiNotFound(result.message);
    }
    if (result.reason === "duplicate_username") {
      return apiConflict(result.message);
    }
    // role_not_in_org, company_not_in_org, company_required → 400
    if (
      result.reason === "role_not_in_org" ||
      result.reason === "company_not_in_org" ||
      result.reason === "company_required"
    ) {
      return apiBadRequest(result.message);
    }
    console.error("[POST /api/v1/superadmin/orgs/[orgId]/users] createUserInOrg", result.message);
    return apiServerError();
  }

  // Write audit log after the transaction committed.
  // Not wrapped in try/catch — audit failure propagates as 500 (every mutation must have a row).
  await createOrgAuditLog(
    sa.superAdminId,
    result.user.id,
    "user.create",
    { organizationId: orgId },
    "User",
  );

  return NextResponse.json({ user: result.user }, { status: 201 });
}
