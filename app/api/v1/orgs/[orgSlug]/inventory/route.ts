import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiBadRequest,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  listAllInventoryItems,
  createInventoryItem,
  DuplicateInventoryCodeError,
} from "@/lib/data/catalog";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/inventory ────────────────────────────────────

/**
 * List ALL InventoryItems for the org (active + inactive), with their prices.
 * Ordered category → code, then prices by currency within each item.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Unlike component-types (where the list is open to all authenticated users
 * for the project configurator), inventory reads are fully gated at MANAGE_PRICING —
 * per the stage-12.md RBAC table: catalog/** reads and writes both require
 * MANAGE_PRICING.
 *
 * Returns all items (including inactive) so the management page can display
 * and edit inactive items (Stage 25 Batch 8). Formula-engine code uses
 * loadInventoryMap() (lib/data/inventory.ts) which also loads ALL items
 * (active + inactive) so it can emit INACTIVE_ITEM problems for inactive codes.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listAllInventoryItems()
 *          filtering on session.organizationId.
 *
 * Stage 25 Batch 6 (S25-4): route moved from /catalog to /inventory.
 * Stage 25 Batch 8: switched from listInventoryItems (active-only) to
 * listAllInventoryItems so the management page shows inactive items for editing.
 * Old path /api/v1/orgs/[orgSlug]/catalog returns 404 (no redirect, S25-5).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/inventory]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error("[GET /api/v1/orgs/[orgSlug]/inventory] requirePermission", err);
    return apiServerError();
  }

  try {
    const items = await listAllInventoryItems(session);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/inventory] listAllInventoryItems", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/inventory ───────────────────────────────────

/**
 * Create a new InventoryItem for the org.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Required body fields: code (string), name (string), measurementUnit (string).
 * Optional body fields: perUnitQuantity (number > 0), active (boolean), attributes (object).
 *
 * Returns 201 with { item } on success.
 * Returns 400 on missing/invalid required fields.
 * Returns 409 if an item with the same code already exists in the org (duplicate code).
 *
 * Stage 25 Batch 7.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/inventory]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error("[POST /api/v1/orgs/[orgSlug]/inventory] requirePermission", err);
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

  const code = b.code;
  const name = b.name;
  const measurementUnit = b.measurementUnit;
  const category = b.category;
  const perUnitQuantity = b.perUnitQuantity;
  const active = b.active;
  const attributes = b.attributes;

  if (typeof code !== "string" || code.trim() === "") {
    return apiBadRequest("code is required and must be a non-empty string");
  }
  if (typeof name !== "string" || name.trim() === "") {
    return apiBadRequest("name is required and must be a non-empty string");
  }
  if (typeof measurementUnit !== "string" || measurementUnit.trim() === "") {
    return apiBadRequest("measurementUnit is required and must be a non-empty string");
  }
  if (category !== undefined && typeof category !== "string") {
    return apiBadRequest("category must be a string");
  }
  if (perUnitQuantity !== undefined) {
    if (typeof perUnitQuantity !== "number" || perUnitQuantity <= 0) {
      return apiBadRequest("perUnitQuantity must be a positive number");
    }
  }
  if (active !== undefined && typeof active !== "boolean") {
    return apiBadRequest("active must be a boolean");
  }
  if (attributes !== undefined && (typeof attributes !== "object" || attributes === null || Array.isArray(attributes))) {
    return apiBadRequest("attributes must be an object");
  }

  try {
    const item = await createInventoryItem(session, {
      code,
      name,
      measurementUnit,
      category: category as string | undefined,
      perUnitQuantity: perUnitQuantity as number | undefined,
      active: active as boolean | undefined,
      attributes: attributes as object | undefined,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateInventoryCodeError) {
      return apiConflict(err.message);
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/inventory] createInventoryItem", err);
    return apiServerError();
  }
}
