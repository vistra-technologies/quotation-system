import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { getProjectCalculationForRead } from "@/lib/data/calculations";

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
 * Response body never includes `materialByRoom` (can reach ~90 KB, never needed by any read path —
 * see lib/prisma.ts's client-level omit).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string }> },
) {
  const { orgSlug, projectId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation]",
      err,
    );
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

    return NextResponse.json({
      computedAt: result.computedAt,
      status: result.status,
      errorDetail: result.errorDetail,
      summary: result.summary,
      materialList: result.materialList,
      formulaSet: result.formulaSet,
    });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation] getProjectCalculationForRead",
      err,
    );
    return apiServerError();
  }
}
