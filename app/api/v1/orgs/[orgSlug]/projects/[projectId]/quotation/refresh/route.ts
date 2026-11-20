import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiServerError } from "@/lib/api-error";
import { refreshQuotation } from "@/lib/data/quotations";
import { log } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac";
import { quotationGate, quotationResponse } from "@/lib/quotation-api";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh ─────────────────────────────────

/**
 * Refresh (Stage 38 Q-D10, Q-D15, Q-D35). No body. Quantities are rebuilt from the latest calculation; with the
 * same currency every existing code keeps its (possibly edited) price and range, new codes take the current
 * Inventory values, dropped codes drop; after a project currency change every line is re-priced at the current
 * max (edited prices replaced, a fixed discount reset to 0). `pricedAt` = now; `validUntil` is untouched.
 *
 * Auth: QUOTE only, never APPLY_DISCOUNT (Q-D35) + ownership. 404 project / quotation; 422 "Submit the design
 * first" (no finished calculation); 422 MISSING_PRICE problem report (nothing written); 409 when ordered.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.QUOTE, "POST quotation/refresh");
    if (denied) return denied;
    try {
      return quotationResponse(await refreshQuotation(session, projectId));
    } catch (err) {
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh] refreshQuotation", { err });
      return apiServerError();
    }
  },
);
