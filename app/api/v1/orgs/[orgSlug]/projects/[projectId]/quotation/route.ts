import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiBadRequest, apiServerError } from "@/lib/api-error";
import { createQuotation, getQuotation, updateQuotationInputs } from "@/lib/data/quotations";
import { log } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac";
import { parseQuotationPatch } from "@/lib/quotation/inputs";
import { quotationGate, quotationResponse } from "@/lib/quotation-api";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ orgSlug: string; projectId: string }> };

// ─── GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation ──────────────────────────────────────────

/**
 * The project's quotation (Stage 38, S38-1): the stored snapshot plus live flags (`designChanged`,
 * `currencyDiffers`, derived `status`), money as 2 dp strings, totals recomputed server-side.
 *
 * Auth: QUOTE (an architect gets 403) plus the project ownership filter: a foreign or cross-company project is 404,
 * identical to a nonexistent one. 404 `NO_QUOTATION` when the project has none yet.
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation",
  async (request: Request, { params }: Params) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.QUOTE, "GET quotation");
    if (denied) return denied;
    try {
      return quotationResponse(await getQuotation(session, projectId));
    } catch (err) {
      log.error("[GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation] getQuotation", { err });
      return apiServerError();
    }
  },
);

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation ─────────────────────────────────────────

/**
 * Create the quotation from the project's calculation, priced from Inventory (Q-D1, Q-D6). No body.
 *
 * Auth: QUOTE + ownership. 201 `{ quotation }`; 404 project; 409 one already exists; 422 "Submit the design first"
 * (no finished calculation); 422 problem report (kind MISSING_PRICE, scope INVENTORY, code + item name) when any
 * material-list item has no price in the project currency, nothing written.
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation",
  async (request: Request, { params }: Params) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.QUOTE, "POST quotation");
    if (denied) return denied;
    try {
      return quotationResponse(await createQuotation(session, projectId), 201);
    } catch (err) {
      log.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation] createQuotation", { err });
      return apiServerError();
    }
  },
);

// ─── PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation ────────────────────────────────────────

/**
 * Edit the money inputs: `transport`, `otherCharges`, `discount` + `discountType` (PERCENT | FIXED), `taxPercent`
 * (any subset, at least one). Totals are recomputed server-side, never taken from the client.
 *
 * Auth: APPLY_DISCOUNT + ownership. 400 on bad input, or a typed FIXED discount above the subtotal (Q-D33) or a
 * PERCENT above 100, nothing written; 409 when ordered.
 */
export const PATCH = withRoute(
  "PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation",
  async (request: Request, { params }: Params) => {
    const { orgSlug, projectId } = await params;
    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation]", { err });
      return apiServerError();
    }
    const denied = await quotationGate(session, PERMISSIONS.APPLY_DISCOUNT, "PATCH quotation");
    if (denied) return denied;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiBadRequest("Invalid JSON body");
    }
    const parsed = parseQuotationPatch(body);
    if (!parsed.ok) return apiBadRequest(parsed.error);

    try {
      return quotationResponse(await updateQuotationInputs(session, projectId, parsed.patch));
    } catch (err) {
      log.error("[PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation] updateQuotationInputs", { err });
      return apiServerError();
    }
  },
);
