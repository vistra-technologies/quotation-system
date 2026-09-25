import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { resetProject } from "@/lib/data/projects";
import { isFormulaPinError } from "@/lib/data/formula-pin";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/projects/[projectId]/reset ─────────────────

/**
 * Reset a DRAFT project to its just-created state (hotfix 2026-09-25, H-3):
 * deletes its Selections, Floors/Rooms/Partitions and ProjectCalculation,
 * re-freezes configSnapshot, re-pins the org's active formula set, and clears
 * designSubmittedAt — all in one transaction. The project row itself is kept.
 *
 * Auth: any authenticated org member — same gate as the project DELETE route.
 * Tenancy: enforced by getApiSession() and resetProject() (org-scoped lookup).
 *
 * Returns 200 { id } on success.
 * Returns 404 if the project does not exist or belongs to a different org.
 * Returns 409 if the project is not DRAFT, or the org's active formula set is
 * missing / incompatible with its current config (nothing is changed).
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
    console.error("[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/reset]", err);
    return apiServerError();
  }

  try {
    const result = await resetProject(session, projectId);

    if (result === null) {
      return apiNotFound("Project not found");
    }
    if ("notResettable" in result) {
      return apiConflict("Project cannot be reset: it is not in DRAFT status");
    }
    return NextResponse.json({ id: result.id });
  } catch (err) {
    if (isFormulaPinError(err)) {
      return apiConflict(err.message);
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/projects/[projectId]/reset] resetProject",
      err,
    );
    return apiServerError();
  }
}
