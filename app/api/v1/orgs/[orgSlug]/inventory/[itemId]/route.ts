import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { isMeasurementUnit, MEASUREMENT_UNIT_LIST } from "@/lib/units";
import {
  apiBadRequest,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiUnprocessable,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  getInventoryItemById,
  updateInventoryItem,
  deleteInventoryItem,
  DuplicateInventoryCodeError,
  InvalidComponentTypeError,
} from "@/lib/data/catalog";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/inventory/[itemId] ───────────────────────────

/**
 * Get a single InventoryItem by ID, scoped to the org, with its prices.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Returns 404 if the item does not exist in the org (tenancy guard: items
 * belonging to another org are indistinguishable from missing items).
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getInventoryItemById()
 *          filtering on session.organizationId — returns null for items that
 *          belong to a different org, surfaced as 404.
 *
 * Stage 25 Batch 6 (S25-4): route moved from /catalog/[itemId] to /inventory/[itemId].
 * Old path /api/v1/orgs/[orgSlug]/catalog/[itemId] returns 404 (no redirect, S25-5).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  const { orgSlug, itemId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/inventory/[itemId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/inventory/[itemId]] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const item = await getInventoryItemById(session, itemId);
    if (!item) {
      return apiNotFound("Inventory item not found");
    }
    return NextResponse.json({ item });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/inventory/[itemId]] getInventoryItemById",
      err,
    );
    return apiServerError();
  }
}

// ─── PATCH /api/v1/orgs/[orgSlug]/inventory/[itemId] ─────────────────────────

/**
 * Update an existing InventoryItem.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Body: at least one of code, name, measurementUnit, perUnitQuantity, active.
 * All fields are optional; only supplied fields are updated.
 *
 * Returns 200 with { item } on success.
 * Returns 400 on invalid field types or empty body.
 * Returns 404 if the item is not found in the org (tenancy guard: wrong-org items
 *   are indistinguishable from missing items).
 * Returns 409 if the new code collides with an existing item in the org.
 *
 * Stage 25 Batch 7.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  const { orgSlug, itemId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/inventory/[itemId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/inventory/[itemId]] requirePermission",
      err,
    );
    return apiServerError();
  }

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

  // Validate only the fields that are present.
  if (b.code !== undefined && (typeof b.code !== "string" || (b.code as string).trim() === "")) {
    return apiBadRequest("code must be a non-empty string");
  }
  if (b.name !== undefined && (typeof b.name !== "string" || (b.name as string).trim() === "")) {
    return apiBadRequest("name must be a non-empty string");
  }
  // H-17: componentTypeId replaces category as the Component field.
  // Accept string (to set FK), null (to clear FK), or absent (leave unchanged).
  if (b.componentTypeId !== undefined && b.componentTypeId !== null && typeof b.componentTypeId !== "string") {
    return apiBadRequest("componentTypeId must be a string or null");
  }
  // Hotfix 2026-09-28 U-1: must be a unit the formula engine can match.
  if (b.measurementUnit !== undefined && !isMeasurementUnit(b.measurementUnit)) {
    return apiBadRequest(`measurementUnit must be ${MEASUREMENT_UNIT_LIST}`);
  }
  if (b.perUnitQuantity !== undefined && (typeof b.perUnitQuantity !== "number" || b.perUnitQuantity <= 0)) {
    return apiBadRequest("perUnitQuantity must be a positive number");
  }
  if (b.active !== undefined && typeof b.active !== "boolean") {
    return apiBadRequest("active must be a boolean");
  }

  const updateFields = ["code", "name", "componentTypeId", "measurementUnit", "perUnitQuantity", "active"];
  const hasAnyField = updateFields.some((f) => b[f] !== undefined);
  if (!hasAnyField) {
    return apiBadRequest("At least one field must be provided for update");
  }

  try {
    const item = await updateInventoryItem(session, itemId, {
      code: b.code as string | undefined,
      name: b.name as string | undefined,
      componentTypeId: b.componentTypeId as string | null | undefined,
      measurementUnit: b.measurementUnit as string | undefined,
      perUnitQuantity: b.perUnitQuantity as number | undefined,
      active: b.active as boolean | undefined,
    });
    if (!item) {
      return apiNotFound("Inventory item not found");
    }
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof DuplicateInventoryCodeError) {
      return apiConflict(err.message);
    }
    if (err instanceof InvalidComponentTypeError) {
      return apiUnprocessable(err.message);
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/inventory/[itemId]] updateInventoryItem",
      err,
    );
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId] ────────────────────────

/**
 * Delete an InventoryItem from the org, including its ItemPrice rows (Cascade).
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Returns 204 on success.
 * Returns 404 if the item is not found in the org (tenancy guard: wrong-org items
 *   are indistinguishable from missing items).
 *
 * ItemPrice rows cascade-delete automatically (onDelete: Cascade on the FK).
 *
 * Hotfix 2026-09-27 H-6.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  const { orgSlug, itemId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    console.error("[DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId]] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const deleted = await deleteInventoryItem(session, itemId);
    if (!deleted) {
      return apiNotFound("Inventory item not found");
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/inventory/[itemId]] deleteInventoryItem",
      err,
    );
    return apiServerError();
  }
}
