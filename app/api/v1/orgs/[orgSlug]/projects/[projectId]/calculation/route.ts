import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { getProjectCalculationForRead, getMissingPrices } from "@/lib/data/calculations";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation ────────────

/**
 * Read a project's stored ProjectCalculation (Stage 26 Batch 1) — backs the Summary page.
 *
 * Auth: any authenticated org member (no specific RBAC permission required — matches the project
 *       GET/PATCH/DELETE gates on the sibling route).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getProjectCalculationForRead()
 *          filtering on session.organizationId — returns null for projects that belong to a
 *          different org, surfaced as 404.
 *
 * Returns 404 both when the project doesn't exist/belongs to another org AND when the project exists
 * but has never been computed — the client doesn't need to distinguish the two (the Summary page reads
 * either as "no calculation to show").
 *
 * Stage 38: the body also carries `missingPrices: { currency, items: [{ code, name }] }`, the material-list
 * items with no Inventory price in the project currency.
 *
 * Response body never includes `materialByRoom` (can reach ~90 KB, never needed by any read path —
 * see lib/prisma.ts's client-level omit).
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string }> },
) => {
  const { orgSlug, projectId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("[GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation]", { err });
    return apiServerError();
  }

  try {
    const result = await getProjectCalculationForRead(session, projectId);

    if (result === null) {
      return apiNotFound("Project not found");
    }
    if ("noCalculation" in result) {
      return apiNotFound("No calculation found for this project");
    }

    // Stage 38: material-list items with no price in the project currency (one query for the whole list).
    const missing = await getMissingPrices(session, result.projectCurrency, result.materialList);

    return NextResponse.json({
      computedAt: result.computedAt,
      status: result.status,
      errorDetail: result.errorDetail,
      summary: result.summary,
      materialList: result.materialList,
      formulaSet: result.formulaSet,
      missingPrices: { currency: result.projectCurrency, items: missing },
    });
  } catch (err) {
    log.error("[GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation] getProjectCalculationForRead", { err });
    return apiServerError();
  }
});
