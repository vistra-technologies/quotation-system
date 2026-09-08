import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { listFloorsByProject, createFloorIfNotExists } from "@/lib/data/floors";
import { getProjectById } from "@/lib/data/projects";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/floors?projectId= ─────────────────────────────

/**
 * List all Floors for a project, ordered by orderIndex.
 *
 * Stage 18: added so app/[orgSlug]/** pages (design page, add-wall flow) can
 * resolve Floors through the API layer instead of the banned direct
 * lib/data/floors import — Floor itself is unchanged this stage (still
 * Project -> Floor), this route just exposes the existing DAL function.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org); listFloorsByProject()
 *          filters by organizationId, so a foreign projectId simply yields [].
 *
 * Query params:
 *   projectId (required) — ID of the project to list floors for.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/floors]", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return apiBadRequest("projectId query parameter is required");
  }

  try {
    const floors = await listFloorsByProject(projectId, session.organizationId);
    return NextResponse.json({ floors });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/floors] listFloorsByProject", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/floors ───────────────────────────────────────

/**
 * Create-or-get a Floor by label within a project (wraps
 * lib/data/floors.ts's createFloorIfNotExists — idempotent by
 * (projectId, label)).
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { projectId, label }
 *
 * Returns 200/201 with the floor (existing rows also return 200 body shape
 * { floor } — callers don't need to distinguish create vs. reuse).
 * Returns 400 on missing required fields or a concurrent-race label conflict.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/floors]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : null;
  const label = typeof body.label === "string" ? body.label.trim() : null;

  if (!projectId || !label) {
    return apiBadRequest("projectId and label are required");
  }

  // Verify the project belongs to the session's org before creating a Floor
  // under it — prevents cross-org Floor creation via a foreign projectId
  // (mirrors the check the pre-Stage-18 add-wall action performed inline).
  const project = await getProjectById(session, projectId);
  if (!project) {
    return apiBadRequest("Project not found or access denied.");
  }

  try {
    const floor = await createFloorIfNotExists(
      projectId,
      label,
      session.organizationId,
    );
    return NextResponse.json({ floor }, { status: 201 });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "DUPLICATE_FLOOR_LABEL"
    ) {
      return apiBadRequest(err instanceof Error ? err.message : "Invalid request");
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/floors] createFloorIfNotExists", err);
    return apiServerError();
  }
}
