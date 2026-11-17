import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiServerError } from "@/lib/api-error";
import { lookupProductPricing } from "@/lib/data/product-pricing";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached: reads the session cookie and live DB data.
export const dynamic = "force-dynamic";

/**
 * Stage 36 Fix batch F1 (S36-19): the Quick Estimate price read. Session-only gate, exactly like
 * GET .../component-types: every member of the org (internal or external) may read the org's rate card; there is
 * deliberately NO requirePermission here (MANAGE_PRICING gates only the admin page, the admin GET, PUT, DELETE).
 * Tenancy: getApiSession (401 / 403 cross-org / 403 ORG_SUSPENDED) plus organizationId from the session only.
 * Returns exactly the 4 fields the lookup needs; never id, label or timestamps.
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/product-pricing/lookup",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string }> }) => {
    const { orgSlug } = await params;

    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[GET /api/v1/orgs/[orgSlug]/product-pricing/lookup]", { err });
      return apiServerError();
    }

    try {
      const rows = await lookupProductPricing(session);
      return NextResponse.json({ rows });
    } catch (err) {
      log.error("[GET /api/v1/orgs/[orgSlug]/product-pricing/lookup] lookupProductPricing", { err });
      return apiServerError();
    }
  },
);
