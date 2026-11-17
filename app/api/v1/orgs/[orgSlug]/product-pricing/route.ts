import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiBadRequest, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-error";
import { readJsonObject } from "@/lib/api-body";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  listProductPricing,
  getComponentTypeForPricing,
  upsertProductPricing,
} from "@/lib/data/product-pricing";
import { validateCombinationKey, validateCombinationLabel } from "@/lib/product-pricing/combination";
import { validatePriceEntries, validateDescription } from "@/lib/product-pricing/price-entries";
import { unitForCode } from "@/lib/quick-estimate/palette";
import { UNIT_AREA } from "@/lib/quick-estimate/estimate";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached: reads the session cookie and live DB data.
export const dynamic = "force-dynamic";

/**
 * Stage 36 (S36-8, O-1 = c): the org's product price rows. Both verbs require MANAGE_PRICING.
 * Tenancy: getApiSession (403 cross-org) plus organizationId from the session in every query.
 */

// ─── GET /api/v1/orgs/[orgSlug]/product-pricing ──────────────────────────────

export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/product-pricing",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string }> }) => {
    const { orgSlug } = await params;

    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[GET /api/v1/orgs/[orgSlug]/product-pricing]", { err });
      return apiServerError();
    }

    try {
      await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
    } catch (err) {
      if (err instanceof ForbiddenError) return apiForbidden(err.message);
      log.error("[GET /api/v1/orgs/[orgSlug]/product-pricing] requirePermission", { err });
      return apiServerError();
    }

    const componentTypeId = new URL(request.url).searchParams.get("componentTypeId") ?? undefined;

    try {
      const rows = await listProductPricing(session, { componentTypeId });
      return NextResponse.json({ rows });
    } catch (err) {
      log.error("[GET /api/v1/orgs/[orgSlug]/product-pricing] listProductPricing", { err });
      return apiServerError();
    }
  },
);

// ─── PUT /api/v1/orgs/[orgSlug]/product-pricing ──────────────────────────────

/**
 * Upsert one combination's prices and description. Body:
 * { componentTypeId, combinationKey, combinationLabel, prices, description? }.
 * Empty prices and a blank description delete the row and return { row: null }.
 */
export const PUT = withRoute(
  "PUT /api/v1/orgs/[orgSlug]/product-pricing",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string }> }) => {
    const { orgSlug } = await params;

    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[PUT /api/v1/orgs/[orgSlug]/product-pricing]", { err });
      return apiServerError();
    }

    try {
      await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
    } catch (err) {
      if (err instanceof ForbiddenError) return apiForbidden(err.message);
      log.error("[PUT /api/v1/orgs/[orgSlug]/product-pricing] requirePermission", { err });
      return apiServerError();
    }

    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;
    const b = parsed.body;

    if (typeof b.componentTypeId !== "string" || b.componentTypeId === "") {
      return apiBadRequest("componentTypeId is required");
    }
    const keyError = validateCombinationKey(b.combinationKey);
    if (keyError) return apiBadRequest(keyError);
    const label = validateCombinationLabel(b.combinationLabel);
    if (!label.ok) return apiBadRequest(label.error);
    const description = validateDescription(b.description);
    if (!description.ok) return apiBadRequest(description.error);

    try {
      // Foreign and nonexistent ids are indistinguishable: both 404.
      const type = await getComponentTypeForPricing(session, b.componentTypeId);
      if (!type) return apiNotFound("Component type not found");

      const prices = validatePriceEntries(b.prices, unitForCode(type.code) === UNIT_AREA);
      if (!prices.ok) return apiBadRequest(prices.error);

      const row = await upsertProductPricing(session, {
        componentTypeId: type.id,
        combinationKey: b.combinationKey as string,
        combinationLabel: label.label,
        prices: prices.entries,
        description: description.description,
      });
      return NextResponse.json({ row });
    } catch (err) {
      log.error("[PUT /api/v1/orgs/[orgSlug]/product-pricing] upsertProductPricing", { err });
      return apiServerError();
    }
  },
);
