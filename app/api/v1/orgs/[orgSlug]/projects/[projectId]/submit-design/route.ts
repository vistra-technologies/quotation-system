import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { submitDesign } from "@/lib/data/projects";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design ─────────

/**
 * Mark a project's design as submitted — the Design page's "Submit Design"
 * button. Unlocks the Summary/Quotation wizard steps (previously auto-unlocked
 * at partitionCount>0; now requires this explicit action).
 *
 * Auth: any authenticated org member (matches the project GET/PATCH gates).
 * Tenancy: enforced by getApiSession() and submitDesign() (org-scoped lookup).
 *
 * Returns 400 if the project has zero Partitions (nothing to submit).
 * Returns 404 if the project does not exist or belongs to a different org.
 * Returns 409 if the project has no active formula set / config snapshot pinned (defensive).
 * Returns 422 (CalculationProblemReport body) if Phase A or Phase B of the gate has problems
 *   (structural cell/selection issues, or unresolved/inactive/mismatched inventory codes).
 *   The stored calculation is NOT written on a 422 — the stored row remains unchanged.
 * Returns 200 { project } on success.
 */
export async function POST(
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
      "[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design]",
      err,
    );
    return apiServerError();
  }

  try {
    const result = await submitDesign(session, projectId);

    if (result === null) {
      return apiNotFound("Project not found");
    }

    if ("noPartitions" in result) {
      return apiBadRequest(
        "Add at least one partition before submitting the design.",
      );
    }

    if ("noFormulaSet" in result) {
      return apiConflict(
        "This organization has no active formula set or configuration snapshot pinned to this project.",
      );
    }

    if ("calculationRefused" in result) {
      // 422 with the full CalculationProblemReport as the body (decision 10a).
      return NextResponse.json(result.calculationRefused, { status: 422 });
    }

    return NextResponse.json({ project: result.project });
  } catch (err) {
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design] submitDesign",
      err,
    );
    return apiServerError();
  }
}
