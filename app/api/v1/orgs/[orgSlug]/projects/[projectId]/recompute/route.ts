import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { recomputeProject } from "@/lib/data/projects";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/recompute ─────────────

/**
 * Recompute a project's Summary (ProjectCalculation) — Stage 23 Batch 5, D-23. Re-runs the same
 * load-summary-write path as submit-design, but never touches `designSubmittedAt`.
 *
 * Stage 24 Batch 5: the same two-phase gate as submit-design now applies. If either phase emits
 * problems, the stored calculation row is left UNTOUCHED (G-3 — recompute refusal is not an
 * invalidation event). Returns 422 with a CalculationProblemReport body on refusal.
 *
 * Auth: any authenticated org member (matches the project GET/PATCH gates).
 * Tenancy: enforced by getApiSession() and recomputeProject() (org-scoped lookup).
 *
 * Returns 404 if the project does not exist or belongs to a different org.
 * Returns 409 if the project is not DRAFT, or if it has never been computed before, or if it has
 *   no formula set pinned (defensive).
 * Returns 422 (CalculationProblemReport body) if Phase A or Phase B has problems; stored row unchanged.
 * Returns 200 { calculation } on success.
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
      "[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/recompute]",
      err,
    );
    return apiServerError();
  }

  try {
    const result = await recomputeProject(session, projectId);

    if (result === null) {
      return apiNotFound("Project not found");
    }

    if ("notDraft" in result) {
      return apiConflict("Only a DRAFT project can be recomputed.");
    }

    if ("neverComputed" in result) {
      return apiConflict(
        "This project has never been submitted or computed — recompute is not the first computation.",
      );
    }

    if ("noFormulaSet" in result) {
      return apiConflict(
        "This organization has no active formula set pinned to this project.",
      );
    }

    if ("calculationRefused" in result) {
      // 422 with the full CalculationProblemReport as the body. Stored row is unchanged.
      return NextResponse.json(result.calculationRefused, { status: 422 });
    }

    return NextResponse.json({ calculation: result.calculation });
  } catch (err) {
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/recompute] recomputeProject",
      err,
    );
    return apiServerError();
  }
}
