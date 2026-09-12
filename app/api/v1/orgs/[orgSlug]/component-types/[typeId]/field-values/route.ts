import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  getComponentTypeById,
  setComponentTypeOrgConfig,
} from "@/lib/data/components";
import { validateFieldOptionsConfig } from "@/lib/validate-field-options-config";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values ────────

/**
 * Get a single ComponentType's fieldsSchema + its org-level fieldOptionsConfig — Stage 20 Batch 3.
 * Backs the Catalog screen (org-admin "fill in the values" page).
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission — same gate as the sibling
 * `/component-types/[typeId]` admin-detail route (decision #2 in stage-20.md).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and
 *          getComponentTypeById() filtering on session.organizationId — cross-org
 *          typeId returns null here, surfaced as 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; typeId: string }> },
) {
  const { orgSlug, typeId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const componentType = await getComponentTypeById(session, typeId);
    if (!componentType) {
      return apiNotFound("Component type not found");
    }
    return NextResponse.json({ componentType });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values] getComponentTypeById",
      err,
    );
    return apiServerError();
  }
}

// ─── PUT /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values ────────

/**
 * Replace the whole fieldOptionsConfig for a ComponentType — Stage 20 Batch 3.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Body: { fieldOptionsConfig: Record<fieldKey, { options: string[] } | { valueMap: Record<string, string[]> }> }
 *
 * Every key must exist in the ComponentType's current fieldsSchema and name a dropdown/radio
 * field; shape must match the field's dependsOn-ness (flat → options, dependent → valueMap).
 * Any attempt to set/change `dependsOn` from this endpoint is rejected — wiring is SuperAdmin-
 * authored and read-only here by construction (decision #3, stage-20.md).
 *
 * Returns 200 with the updated componentType (fieldsSchema + fieldOptionsConfig) on success.
 * Returns 400 on malformed body or a payload that fails validateFieldOptionsConfig.
 * Returns 403 if the session role lacks MANAGE_FEATURES.
 * Returns 404 if the component type does not exist in the org.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; typeId: string }> },
) {
  const { orgSlug, typeId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error(
      "[PUT /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[PUT /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values] requirePermission",
      err,
    );
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  if (
    typeof body.fieldOptionsConfig !== "object" ||
    body.fieldOptionsConfig === null ||
    Array.isArray(body.fieldOptionsConfig)
  ) {
    return apiBadRequest("fieldOptionsConfig must be an object");
  }

  // Load the ComponentType's current fieldsSchema (tenancy-scoped) to validate against —
  // also doubles as the existence/tenancy check the PUT needs before writing.
  const componentType = await getComponentTypeById(session, typeId);
  if (!componentType) {
    return apiNotFound("Component type not found");
  }

  const result = validateFieldOptionsConfig(
    componentType.fieldsSchema,
    body.fieldOptionsConfig as Record<string, unknown>,
  );
  if (!result.valid) {
    return apiBadRequest(result.error);
  }

  try {
    await setComponentTypeOrgConfig(session, typeId, result.parsed);
    const updated = await getComponentTypeById(session, typeId);
    return NextResponse.json({ componentType: updated });
  } catch (err) {
    if (err instanceof Error && err.message.includes("access denied")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[PUT /api/v1/orgs/[orgSlug]/component-types/[typeId]/field-values] setComponentTypeOrgConfig",
      err,
    );
    return apiServerError();
  }
}
