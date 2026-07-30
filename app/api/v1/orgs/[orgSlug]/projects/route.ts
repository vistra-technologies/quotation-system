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
import { listProjects, createProject } from "@/lib/data/projects";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/projects ────────────────────────────────────

/**
 * List all projects for the org, newest-first.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listProjects()
 *          filtering on session.organizationId.
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
    console.error("[GET /api/v1/orgs/[orgSlug]/projects]", err);
    return apiServerError();
  }

  try {
    const projects = await listProjects(session);
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/projects] listProjects", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/projects ────────────────────────────────────

/**
 * Create a new project in the org.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { name, destinationCountry, currency, status?, externalCompanyId? }
 *
 * Returns 201 with the created project on success.
 * Returns 400 on missing required fields.
 * Returns 409 on concurrent projectNumber collision.
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
    console.error("[POST /api/v1/orgs/[orgSlug]/projects]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : null;
  const destinationCountry =
    typeof body.destinationCountry === "string"
      ? body.destinationCountry.trim()
      : null;
  const currency =
    typeof body.currency === "string"
      ? body.currency.trim().toUpperCase()
      : null;
  const status =
    typeof body.status === "string" ? body.status.trim() : "DRAFT";
  const externalCompanyId =
    typeof body.externalCompanyId === "string" && body.externalCompanyId
      ? body.externalCompanyId
      : null;

  if (!name || !destinationCountry || !currency) {
    return apiBadRequest("name, destinationCountry, and currency are required");
  }

  try {
    const project = await createProject(session, {
      name,
      destinationCountry,
      currency,
      status,
      externalCompanyId,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SEQUENCE_CONFLICT"
    ) {
      return apiConflict(
        "A project number conflict occurred — please try again.",
      );
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "INVALID_EXTERNAL_COMPANY"
    ) {
      return apiBadRequest("Selected company is invalid.");
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/projects] createProject", err);
    return apiServerError();
  }
}
