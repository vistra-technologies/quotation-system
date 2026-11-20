import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiServerError } from "@/lib/api-error";
import { resetQuotationPrices } from "@/lib/data/quotations";
import { log } from "@/lib/logger";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { quotationGate, quotationResponse } from "@/lib/quotation-api";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices ────────────────────────────

/**
 * Reset all prices (Stage 38 Q-D15, Q-D33). No body. The STORED quantities are re-priced at the current Inventory
 * values (quotation currency), edited prices are discarded, `pricedAt` = now and `validUntil` restarts (+30 days).
 *
 * Auth: QUOTE while no line is edited; once any line is edited (unitPrice differs from its defaultPrice) it also
 * needs APPLY_DISCOUNT (403 otherwise). Plus ownership. 422 MISSING_PRICE problem report (nothing written); 409
 * when ordered.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.QUOTE, "POST quotation/reset-prices");
    if (denied) return denied;
    try {
      // The APPLY_DISCOUNT half of the gate depends on the stored lines, so the DAL decides it under the row lock.
      const canApplyDiscount = await hasPermission(session, PERMISSIONS.APPLY_DISCOUNT);
      return quotationResponse(await resetQuotationPrices(session, projectId, canApplyDiscount));
    } catch (err) {
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices] resetQuotationPrices", { err });
      return apiServerError();
    }
  },
);
