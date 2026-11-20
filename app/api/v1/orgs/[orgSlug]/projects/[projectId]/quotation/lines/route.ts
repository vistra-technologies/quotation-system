import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiBadRequest, apiForbidden, apiServerError } from "@/lib/api-error";
import { updateQuotationLine } from "@/lib/data/quotations";
import { log } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac";
import { parseLinePatch } from "@/lib/quotation/line-edit";
import { quotationGate, quotationResponse } from "@/lib/quotation-api";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/lines ──────────────────────────────────

/**
 * Edit ONE line's unit price (Stage 38 38c, Q-D13, Q-D14, Q-D33). Body `{ code, unitPrice }` sets the price (2 dp,
 * non-negative) or `{ code, reset: true }` puts the line back to its stored `defaultPrice`. The amount and the totals
 * are recomputed server-side. The range check uses the line's own stored copy (`minPrice <= unitPrice <=
 * defaultPrice`, or `>= minPrice` when `allowAbove`), never the live Inventory price, so a later Inventory change
 * never invalidates an edit.
 *
 * Auth: APPLY_DISCOUNT and an internal (non-external) user (Q-D14: external users see prices read-only, S38-9),
 * plus the project ownership filter. 400 on a bad body or an out-of-range price naming the range (nothing written);
 * 404 project, no quotation, or a code that is not on the quotation; 409 when ordered.
 */
export const PATCH = withRoute(
  "PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/lines",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string; projectId: string }> }) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/lines]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.APPLY_DISCOUNT, "PATCH quotation/lines");
    if (denied) return denied;
    if (session.isExternal) return apiForbidden("Forbidden: line prices are edited by internal staff only");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiBadRequest("Invalid JSON body");
    }
    const parsed = parseLinePatch(body);
    if (!parsed.ok) return apiBadRequest(parsed.error);

    try {
      return quotationResponse(await updateQuotationLine(session, projectId, parsed.patch));
    } catch (err) {
      log.error("[PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/lines] updateQuotationLine", { err });
      return apiServerError();
    }
  },
);
