import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { getProjectById } from "@/lib/data/projects";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/projects/[projectId] ────────────────────────

/**
 * Get a single project by ID, scoped to the org.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getProjectById()
 *          filtering on session.organizationId — returns null for projects that
 *          belong to a different org, surfaced as 404.
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
      "[GET /api/v1/orgs/[orgSlug]/projects/[projectId]]",
      err,
    );
    return apiServerError();
  }

  try {
    const project = await getProjectById(session, projectId);
    if (!project) {
      return apiNotFound("Project not found");
    }
    return NextResponse.json({ project });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/projects/[projectId]] getProjectById",
      err,
    );
    return apiServerError();
  }
}
