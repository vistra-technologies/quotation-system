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
import { upsertItemPrice, deleteItemPrice } from "@/lib/data/catalog";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices ─────────────────────

/**
 * Upsert (add or update) an ItemPrice for a CatalogItem + currency pair.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 * Body: { currency: string, price: number }
 *
 * Idempotent — calling again with the same currency updates the existing price.
 * Returns 200 on success (upsert has no "created vs updated" distinction worth
 * surfacing; both cases leave the row in the expected state).
 *
 * Returns 400 on missing/invalid input.
 * Returns 403 if the session role lacks MANAGE_PRICING.
 * Returns 404 if the CatalogItem does not exist in the org.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and upsertItemPrice()
 *          calling assertCatalogItemInOrg() before writing — double guard.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  const { orgSlug, itemId } = await params;

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
      "[POST /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices] requirePermission",
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

  const currency =
    typeof body.currency === "string"
      ? body.currency.trim().toUpperCase()
      : null;
  const priceRaw =
    typeof body.price === "number"
      ? body.price
      : typeof body.price === "string"
        ? parseFloat(body.price)
        : NaN;

  if (!currency) {
    return apiBadRequest("currency is required");
  }
  if (isNaN(priceRaw) || priceRaw < 0) {
    return apiBadRequest("price must be a non-negative number");
  }

  try {
    await upsertItemPrice(session, itemId, currency, priceRaw);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices] upsertItemPrice",
      err,
    );
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices ───────────────────

/**
 * Delete a single ItemPrice row.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 * Body: { priceId: string }
 *
 * The [itemId] URL param anchors the operation to the correct CatalogItem for
 * routing clarity; the actual tenancy guard is enforced by deleteItemPrice()
 * via itemPrice.organizationId === session.organizationId (defense in depth).
 *
 * Returns 200 with { catalogItemId } on success (same as the DAL return shape,
 * lets callers revalidate the right item-detail page without a second lookup).
 * Returns 400 on missing priceId in body.
 * Returns 403 if the session role lacks MANAGE_PRICING.
 * Returns 404 if the ItemPrice does not exist in the org.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
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
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices] requirePermission",
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

  const priceId =
    typeof body.priceId === "string" ? body.priceId.trim() : null;

  if (!priceId) {
    return apiBadRequest("priceId is required");
  }

  try {
    const { catalogItemId } = await deleteItemPrice(session, priceId);
    return NextResponse.json({ catalogItemId });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiNotFound(err.message);
    }
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/catalog/[itemId]/prices] deleteItemPrice",
      err,
    );
    return apiServerError();
  }
}
