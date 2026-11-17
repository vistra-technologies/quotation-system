import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiForbidden, apiNotFound, apiServerError } from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { deleteProductPricing } from "@/lib/data/product-pricing";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

export const dynamic = "force-dynamic";

/**
 * Stage 36 (S36-8): delete one product price row of the session org. Another org's id, a malformed id and a
 * missing id are all the same 404 (organizationId is part of the delete filter). MANAGE_PRICING.
 */
export const DELETE = withRoute(
  "DELETE /api/v1/orgs/[orgSlug]/product-pricing/[id]",
  async (request: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) => {
    const { orgSlug, id } = await params;

    let session;
    try {
      session = await getApiSession(request, orgSlug);
    } catch (err) {
      if (err instanceof ApiAuthError) return apiAuthErrorResponse(err);
      log.error("[DELETE /api/v1/orgs/[orgSlug]/product-pricing/[id]]", { err });
      return apiServerError();
    }

    try {
      await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
    } catch (err) {
      if (err instanceof ForbiddenError) return apiForbidden(err.message);
      log.error("[DELETE /api/v1/orgs/[orgSlug]/product-pricing/[id]] requirePermission", { err });
      return apiServerError();
    }

    try {
      const deleted = await deleteProductPricing(session, id);
      if (!deleted) return apiNotFound("Product price not found");
      return NextResponse.json({ ok: true });
    } catch (err) {
      log.error("[DELETE /api/v1/orgs/[orgSlug]/product-pricing/[id]] deleteProductPricing", { err });
      return apiServerError();
    }
  },
);
