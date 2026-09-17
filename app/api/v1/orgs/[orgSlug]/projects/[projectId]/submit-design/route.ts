import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
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

    return NextResponse.json({ project: result.project });
  } catch (err) {
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design] submitDesign",
      err,
    );
    return apiServerError();
  }
}
