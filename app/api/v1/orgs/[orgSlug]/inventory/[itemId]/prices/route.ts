import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiBadRequest, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { replaceItemPrices } from "@/lib/data/catalog";
import { serializeItemPrice, validateItemPrices } from "@/lib/item-price";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PUT /api/v1/orgs/[orgSlug]/inventory/[itemId]/prices ────────────────────

/**
 * Replace the whole price list of one InventoryItem (Stage 38, S38-3).
 *
 * Auth: authenticated org member with MANAGE_PRICING.
 * Body: `[{ currency, price, minPrice, allowAbove }]` (or `{ prices: [...] }`). price is the Max (list)
 * price. Money is a JSON number or numeric string with at most 2 decimals. Currencies not in the list are
 * deleted; the empty list clears every price. Inactive items may be priced.
 *
 * Returns 200 `{ prices }` (2 dp strings, ordered by currency); 400 on validation (not an array, bad or
 * duplicate currency, bad money, minPrice above price, non-boolean allowAbove); 404 when the item is
 * missing or belongs to another org (indistinguishable).
 */
export const PUT = withRoute(
  "PUT /api/v1/orgs/[orgSlug]/inventory/[itemId]/prices",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) => {
  const { orgSlug, itemId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("[PUT /api/v1/orgs/[orgSlug]/inventory/[itemId]/prices]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[PUT /api/v1/orgs/[orgSlug]/inventory/[itemId]/prices] requirePermission", { err });
    return apiServerError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  const parsed = validateItemPrices(body);
  if (!parsed.ok) return apiBadRequest(parsed.error);

  try {
    const prices = await replaceItemPrices(session, itemId, parsed.rows);
    if (!prices) return apiNotFound("Inventory item not found");
    return NextResponse.json({ prices: prices.map(serializeItemPrice) });
  } catch (err) {
    log.error("[PUT /api/v1/orgs/[orgSlug]/inventory/[itemId]/prices] replaceItemPrices", { err });
    return apiServerError();
  }
});
