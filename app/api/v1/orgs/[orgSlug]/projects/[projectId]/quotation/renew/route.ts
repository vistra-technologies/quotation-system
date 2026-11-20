import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiServerError } from "@/lib/api-error";
import { renewQuotation } from "@/lib/data/quotations";
import { log } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac";
import { quotationGate, quotationResponse } from "@/lib/quotation-api";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew ───────────────────────────────────

/**
 * Renew (Stage 38 Q-D18, Q-D20). No body. `validUntil` moves 30 days past the later of now and the current expiry;
 * nothing is repriced.
 *
 * Auth: EXTEND_QUOTE (Admin only by default) + ownership. 404 project / quotation; 409 when ordered.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.EXTEND_QUOTE, "POST quotation/renew");
    if (denied) return denied;
    try {
      return quotationResponse(await renewQuotation(session, projectId));
    } catch (err) {
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew] renewQuotation", { err });
      return apiServerError();
    }
  },
);
