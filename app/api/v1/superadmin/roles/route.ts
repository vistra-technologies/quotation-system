import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import {
  listRolesForOrg,
  createRoleForOrg,
  createRoleAuditLog,
} from "@/lib/data/superadmin/roles";
import { prisma } from "@/lib/prisma";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/roles?orgId=xxx ───────────────────────────────────
//
// Returns all roles for the given org, A→Z by name.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query: ?orgId=<organizationId>

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/roles] auth error", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId")?.trim();

  if (!orgId) {
    return apiBadRequest("orgId query parameter is required");
  }

  // Verify the org exists (prevents leaking role data for non-existent orgs).
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });
  if (!org) {
    return apiNotFound("Organization not found");
  }

  try {
    const roles = await listRolesForOrg(orgId);
    return NextResponse.json({ roles });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/roles] listRolesForOrg", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/roles ───────────────────────────────────────────
//
// Creates a new role for the given org.
// Writes one SuperAdminAuditLog row with action "role.create" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; name: string; description?: string }
//
// Returns 201 with { role } on success.
// Returns 400 on missing/invalid fields.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the org does not exist.

export async function POST(request: Request): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/roles] auth error", err);
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
  const rawDescription = (body as Record<string, unknown>).description;
  const description =
    typeof rawDescription === "string" ? rawDescription.trim() || null : null;

  if (!orgId) return apiBadRequest("orgId is required");
  if (!name) return apiBadRequest("name is required");

  // Verify the org exists.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    return apiNotFound("Organization not found");
  }

  let role;
  try {
    role = await createRoleForOrg(orgId, name, description);
  } catch (err) {
    console.error("[POST /api/v1/superadmin/roles] createRoleForOrg", err);
    return apiServerError();
  }

  // Write audit log after the mutation committed.
  // Not wrapped in try/catch — an audit failure propagates as 500 (spec requires
  // every mutation to have an audit row).
  await createRoleAuditLog(sa.superAdminId, role.id, "role.create", {
    orgId,
    orgName: org.name,
    name: role.name,
    description: role.description,
  });

  return NextResponse.json({ role }, { status: 201 });
}
