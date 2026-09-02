import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import { RESERVED_ORG_SLUGS } from "@/lib/auth-utils";
import {
  apiBadRequest,
  apiUnauthorized,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import {
  listAllOrganizations,
  createOrganizationWithDefaults,
  createOrgAuditLog,
} from "@/lib/data/superadmin/orgs";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/orgs ─────────────────────────────────────────────
//
// Returns all organizations with suspension status and user count.
// Auth: valid SuperAdmin session (qs-sa-token cookie).

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/orgs] auth error", err);
    return apiServerError();
  }

  try {
    const orgs = await listAllOrganizations();
    return NextResponse.json({ orgs });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/orgs] listAllOrganizations", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/orgs ────────────────────────────────────────────
//
// Creates a new organization and seeds its default roles.
// Writes one SuperAdminAuditLog row with action "org.create" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { name: string; slug: string }
//
// Returns 201 with { org: { id, slug, name } } on success.
// Returns 400 on missing/invalid fields or reserved slug.
// Returns 409 on duplicate slug.
// Returns 401 when not authenticated as SuperAdmin.

// Slug must be lowercase alphanumeric with hyphens; 1–63 chars; no leading/trailing hyphens.
const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export async function POST(request: Request): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/orgs] auth error", err);
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
    typeof (body as Record<string, unknown>).name !== "string" ||
    typeof (body as Record<string, unknown>).slug !== "string" ||
    typeof (body as Record<string, unknown>).adminPassword !== "string"
  ) {
    return apiBadRequest("name, slug, and adminPassword are required");
  }

  const name = ((body as Record<string, unknown>).name as string).trim();
  const slug = ((body as Record<string, unknown>).slug as string).trim().toLowerCase();
  const adminPassword = (body as Record<string, unknown>).adminPassword as string;

  if (!name) {
    return apiBadRequest("name is required");
  }
  if (!slug) {
    return apiBadRequest("slug is required");
  }
  if (adminPassword.length < 8) {
    return apiBadRequest("adminPassword must be at least 8 characters");
  }
  if (slug.length > 63) {
    return apiBadRequest("slug must be 63 characters or fewer");
  }
  if (!SLUG_RE.test(slug)) {
    return apiBadRequest(
      "slug must contain only lowercase letters, digits, and hyphens, and must start and end with a letter or digit",
    );
  }
  if (slug.includes("--")) {
    return apiBadRequest("slug must not contain consecutive hyphens");
  }

  // Wire up RESERVED_ORG_SLUGS — review-1.md nit from Batch A.
  if (RESERVED_ORG_SLUGS.includes(slug)) {
    return apiBadRequest(`"${slug}" is a reserved slug and cannot be used`);
  }

  const result = await createOrganizationWithDefaults(name, slug, adminPassword);

  if (!result.ok) {
    if (result.reason === "slug_conflict") {
      return apiConflict(result.message);
    }
    console.error("[POST /api/v1/superadmin/orgs] createOrganizationWithDefaults", result.message);
    return apiServerError();
  }

  // Write two audit rows after the transaction committed (GATE A — Option B decision).
  // Row 1: org creation.
  // Row 2: the auto-created admin user (separate mutation, separate audit row per policy).
  // Not wrapped in try/catch — audit failure propagates as 500 (every mutation must have a row).
  await createOrgAuditLog(sa.superAdminId, result.org.id, "org.create", {
    name: result.org.name,
    slug: result.org.slug,
  });
  await createOrgAuditLog(
    sa.superAdminId,
    result.adminUserId,
    "user.create",
    { organizationId: result.org.id },
    "User",
  );

  return NextResponse.json({ org: result.org }, { status: 201 });
}
