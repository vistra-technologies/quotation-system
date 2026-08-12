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
import { getProjectById, updateProject } from "@/lib/data/projects";

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

// ─── PATCH /api/v1/orgs/[orgSlug]/projects/[projectId] ──────────────────────

/**
 * Update editable fields on a DRAFT project.
 *
 * Auth: any authenticated org member (no specific RBAC permission required —
 *       matches the GET gate on this same route and the project create flow).
 * Tenancy: enforced by getApiSession() and updateProject() (org-scoped lookup).
 *
 * Editable: name, destinationCountry, currency, projectLocation.
 * Locked:   externalCompanyId — silently ignored if supplied (never rejected).
 *
 * Returns 409 if the project exists but is not in DRAFT status.
 * Returns 404 if the project does not exist or belongs to a different org.
 */
export async function PATCH(
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
      "[PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]]",
      err,
    );
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  // Build the update input — only include fields that were provided.
  // externalCompanyId is silently ignored even if the client sends it.
  const input: {
    name?: string;
    destinationCountry?: string;
    currency?: string;
    projectLocation?: string | null;
  } = {};

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return apiBadRequest("name cannot be empty");
    input.name = trimmed;
  }

  if (typeof body.destinationCountry === "string") {
    const trimmed = body.destinationCountry.trim();
    if (!trimmed) return apiBadRequest("destinationCountry cannot be empty");
    input.destinationCountry = trimmed;
  }

  if (typeof body.currency === "string") {
    const trimmed = body.currency.trim().toUpperCase();
    if (!trimmed) return apiBadRequest("currency cannot be empty");
    input.currency = trimmed;
  }

  if ("projectLocation" in body) {
    input.projectLocation =
      typeof body.projectLocation === "string" && body.projectLocation.trim()
        ? body.projectLocation.trim()
        : null;
  }

  try {
    const result = await updateProject(session, projectId, input);

    if (result === null) {
      return apiNotFound("Project not found");
    }

    if ("notEditable" in result) {
      return apiConflict(
        "This project cannot be edited — only DRAFT projects are editable.",
      );
    }

    return NextResponse.json({ project: result.project });
  } catch (err) {
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]] updateProject",
      err,
    );
    return apiServerError();
  }
}
