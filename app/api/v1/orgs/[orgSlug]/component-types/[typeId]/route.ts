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
  updateComponentType,
} from "@/lib/data/components";
import type { FieldEntry } from "@/lib/data/components";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/component-types/[typeId] ─────────────────────

/**
 * Get a single ComponentType by ID, scoped to the org.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * This endpoint serves the admin component-type edit form and is intentionally
 * gated at MANAGE_FEATURES — the admin CRUD detail view is not open to all
 * authenticated users.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getComponentTypeById()
 *          filtering on session.organizationId — returns null for types that
 *          belong to a different org, surfaced as 404.
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
      "[GET /api/v1/orgs/[orgSlug]/component-types/[typeId]]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/component-types/[typeId]] requirePermission",
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
      "[GET /api/v1/orgs/[orgSlug]/component-types/[typeId]] getComponentTypeById",
      err,
    );
    return apiServerError();
  }
}

// ─── PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId] ───────────────────

/**
 * Update a ComponentType (name, code, categoryId, fieldsSchema, active).
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Body: partial { name?, code?, categoryId?, fieldsSchema?, active? }
 *
 * Returns 200 with the updated component type on success.
 * Returns 400 if categoryId is invalid (not in org) or required fields are missing.
 * Returns 403 if the session role lacks MANAGE_FEATURES.
 * Returns 404 if the component type does not exist in the org.
 */
export async function PATCH(
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
      "[PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId]]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId]] requirePermission",
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

  // Build a partial update — only include fields present in the body.
  const patch: {
    name?: string;
    code?: string;
    categoryId?: string;
    fieldsSchema?: FieldEntry[];
    active?: boolean;
  } = {};

  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.code === "string")
    patch.code = body.code.trim().toUpperCase();
  if (typeof body.categoryId === "string")
    patch.categoryId = body.categoryId.trim();
  if (Array.isArray(body.fieldsSchema))
    patch.fieldsSchema = body.fieldsSchema as FieldEntry[];
  if (typeof body.active === "boolean") patch.active = body.active;

  if (Object.keys(patch).length === 0) {
    return apiBadRequest("No updatable fields provided");
  }

  try {
    const componentType = await updateComponentType(session, typeId, patch);
    return NextResponse.json({ componentType });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes("not found") ||
        err.message.includes("access denied")
      ) {
        return apiNotFound(err.message);
      }
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/component-types/[typeId]] updateComponentType",
      err,
    );
    return apiServerError();
  }
}
