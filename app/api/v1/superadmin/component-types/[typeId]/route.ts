import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import {
  getComponentTypeForOrg,
  updateComponentTypeForOrg,
  deleteComponentTypeForOrg,
  createComponentTypeAuditLog,
} from "@/lib/data/superadmin/component-types";
import { getOrgById } from "@/lib/data/superadmin/orgs";
import { validateFieldsSchema } from "@/lib/validate-fields-schema";
import type { FieldEntry } from "@/lib/types/field-entry";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/component-types/[typeId]?orgId=xxx ────────────────
//
// Returns a single ComponentType, verified to belong to the given org.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query: ?orgId=<organizationId>

export async function GET(
  request: Request,
  { params }: { params: Promise<{ typeId: string }> },
): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/component-types/[typeId]] auth error", err);
    return apiServerError();
  }

  const { typeId } = await params;
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
    const componentType = await getComponentTypeForOrg(orgId, typeId);
    if (!componentType) return apiNotFound("ComponentType not found");
    return NextResponse.json({ componentType });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/component-types/[typeId]] getComponentTypeForOrg", err);
    return apiServerError();
  }
}

// ─── PATCH /api/v1/superadmin/component-types/[typeId] ───────────────────────
//
// Updates an existing ComponentType, verified to belong to the given org.
// Writes one SuperAdminAuditLog row with action "componentType.update" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; name?: string; code?: string; categoryId?: string; fieldsSchema?: FieldEntry[]; active?: boolean }
//
// Returns 200 with { componentType } on success.
// Returns 400 on missing/invalid fields.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the org or componentType does not exist.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ typeId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[PATCH /api/v1/superadmin/component-types/[typeId]] auth error", err);
    return apiServerError();
  }

  const { typeId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).orgId !== "string"
  ) {
    return apiBadRequest("orgId is required");
  }

  const b = body as Record<string, unknown>;
  const orgId = (b.orgId as string).trim();

  if (!orgId) return apiBadRequest("orgId is required");

  // Verify the org exists.
  const org = await getOrgById(orgId);
  if (!org) {
    return apiNotFound("Organization not found");
  }

  // Build the patch from optional fields.
  const patch: Parameters<typeof updateComponentTypeForOrg>[2] = {};
  if (typeof b.name === "string") patch.name = b.name;
  if (typeof b.code === "string") patch.code = b.code;
  if (typeof b.categoryId === "string") patch.categoryId = b.categoryId;
  if (Array.isArray(b.fieldsSchema)) patch.fieldsSchema = b.fieldsSchema as FieldEntry[];
  if (typeof b.active === "boolean") patch.active = b.active;

  // Stage 20 Batch 2: same server-side backstop as the POST route — only runs
  // when fieldsSchema is actually part of this patch.
  if (patch.fieldsSchema !== undefined) {
    const schemaCheck = validateFieldsSchema(patch.fieldsSchema);
    if (!schemaCheck.valid) return apiBadRequest(schemaCheck.error);
  }

  let componentType;
  try {
    componentType = await updateComponentTypeForOrg(orgId, typeId, patch);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Category not found")) {
      return apiBadRequest(err.message);
    }
    console.error("[PATCH /api/v1/superadmin/component-types/[typeId]] updateComponentTypeForOrg", err);
    return apiServerError();
  }

  if (!componentType) return apiNotFound("ComponentType not found");

  // Write audit log after the mutation committed.
  await createComponentTypeAuditLog(sa.superAdminId, typeId, "componentType.update", {
    orgId,
    orgName: org.name,
    code: componentType.code,
    name: componentType.name,
    ...patch,
  });

  return NextResponse.json({ componentType });
}

// ─── DELETE /api/v1/superadmin/component-types/[typeId] ──────────────────────
//
// Hard-deletes a ComponentType, verified to belong to the given org.
// Writes one SuperAdminAuditLog row with action "componentType.delete" on success.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query: ?orgId=<organizationId>
//
// Returns 200 with { ok: true } on success.
// Returns 400 on missing orgId.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the org or componentType does not exist.
// Returns 409 if the componentType is referenced by existing Selections (cannot delete).

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ typeId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[DELETE /api/v1/superadmin/component-types/[typeId]] auth error", err);
    return apiServerError();
  }

  const { typeId } = await params;
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

  let result;
  try {
    result = await deleteComponentTypeForOrg(orgId, typeId);
  } catch (err) {
    console.error("[DELETE /api/v1/superadmin/component-types/[typeId]] deleteComponentTypeForOrg", err);
    return apiServerError();
  }

  if ("notFound" in result) return apiNotFound("ComponentType not found");
  if ("inUse" in result) {
    return apiConflict(
      `Cannot delete: this component type is used by ${result.selectionCount} selection${result.selectionCount !== 1 ? "s" : ""}. Remove those selections first.`,
    );
  }

  // Write audit log after the mutation committed.
  await createComponentTypeAuditLog(sa.superAdminId, typeId, "componentType.delete", {
    orgId,
    orgName: org.name,
  });

  return NextResponse.json({ ok: true });
}
