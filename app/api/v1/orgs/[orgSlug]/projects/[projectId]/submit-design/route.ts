import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiConflict,
  apiUnprocessable,
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
 *
 * Stage 23 Batch 5: also builds and writes the project's Summary (ProjectCalculation) in the same
 * transaction as the stamp.
 * Returns 409 if the project has no active formula set / config snapshot pinned (defensive — shouldn't
 * happen post-creation-pin).
 * Returns 422 if the design has a data problem (13b — a cell with no/unresolvable selection), or if the
 * summary build itself failed (a FAILED row is still written in that case, but the submit is blocked).
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

    if ("designIncomplete" in result) {
      return apiUnprocessable(
        `Design is incomplete: ${result.designIncomplete.map((v) => v.message).join("; ")}`,
      );
    }

    if ("buildFailed" in result) {
      return apiUnprocessable(`Could not build the design summary: ${result.buildFailed}`);
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
