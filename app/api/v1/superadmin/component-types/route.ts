import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import {
  listComponentTypesForOrg,
  createComponentTypeForOrg,
  createComponentTypeAuditLog,
} from "@/lib/data/superadmin/component-types";
import { getOrgById } from "@/lib/data/superadmin/orgs";
import { validateFieldsSchema } from "@/lib/validate-fields-schema";
import type { FieldEntry } from "@/lib/types/field-entry";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/component-types?orgId=xxx ─────────────────────────
//
// Returns all ComponentTypes for the given org, A→Z by code.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query: ?orgId=<organizationId>

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/component-types] auth error", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId")?.trim();

  if (!orgId) {
    return apiBadRequest("orgId query parameter is required");
  }

  // Verify the org exists.
  const org = await getOrgById(orgId);
  if (!org) {
    return apiNotFound("Organization not found");
  }

  try {
    const componentTypes = await listComponentTypesForOrg(orgId);
    return NextResponse.json({ componentTypes });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/component-types] listComponentTypesForOrg", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/superadmin/component-types ──────────────────────────────────
//
// Creates a new ComponentType for the given org.
// Writes one SuperAdminAuditLog row with action "componentType.create" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; code: string; name: string; categoryId: string; fieldsSchema?: FieldEntry[]; active?: boolean }
//
// Returns 201 with { componentType } on success.
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
    console.error("[POST /api/v1/superadmin/component-types] auth error", err);
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
    typeof (body as Record<string, unknown>).code !== "string" ||
    typeof (body as Record<string, unknown>).name !== "string" ||
    typeof (body as Record<string, unknown>).categoryId !== "string"
  ) {
    return apiBadRequest("orgId, code, name, and categoryId are required");
  }

  const b = body as Record<string, unknown>;
  const orgId = (b.orgId as string).trim();
  const code = (b.code as string).trim();
  const name = (b.name as string).trim();
  const categoryId = (b.categoryId as string).trim();
  const fieldsSchema = Array.isArray(b.fieldsSchema) ? (b.fieldsSchema as FieldEntry[]) : [];
  const active = typeof b.active === "boolean" ? b.active : true;

  if (!orgId) return apiBadRequest("orgId is required");
  if (!code) return apiBadRequest("code is required");
  if (!name) return apiBadRequest("name is required");
  if (!categoryId) return apiBadRequest("categoryId is required");

  // Stage 20 Batch 2: reject `options` outright (values now live in
  // ComponentTypeOrgConfig, org-authored) and enforce the earlier-field +
  // dropdown/radio-only rule on `dependsOn` — this is the server-side backstop
  // for a caller bypassing the SuperAdmin form/JSON-mode validators directly.
  const schemaCheck = validateFieldsSchema(fieldsSchema);
  if (!schemaCheck.valid) return apiBadRequest(schemaCheck.error);

  // Verify the org exists.
  const org = await getOrgById(orgId);
  if (!org) {
    return apiNotFound("Organization not found");
  }

  let componentType;
  try {
    componentType = await createComponentTypeForOrg(orgId, { code, name, categoryId, fieldsSchema, active });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Category not found")) {
      return apiBadRequest(err.message);
    }
    console.error("[POST /api/v1/superadmin/component-types] createComponentTypeForOrg", err);
    return apiServerError();
  }

  // Write audit log after the mutation committed.
  // Not wrapped in try/catch — an audit failure propagates as 500 (every mutation
  // must have an audit row per Stage 16/17 discipline).
  await createComponentTypeAuditLog(sa.superAdminId, componentType.id, "componentType.create", {
    orgId,
    orgName: org.name,
    code: componentType.code,
    name: componentType.name,
  });

  return NextResponse.json({ componentType }, { status: 201 });
}
