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
 * Editable: name, currency, projectLocation.
 * Locked:   externalCompanyId — silently ignored if supplied (never rejected).
 * Derived:  destinationCountry — set at create time from the linked company's country (D19, Stage 14);
 *           not accepted from the client and never updated.
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
  // destinationCountry is derived at create time and never updated (D19, Stage 14).
  const parseStr = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const parseDate = (v: unknown): Date | null =>
    typeof v === "string" && v ? new Date(`${v}T00:00:00.000Z`) : null;

  const input: Parameters<typeof updateProject>[2] = {};

  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return apiBadRequest("name cannot be empty");
    input.name = trimmed;
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

  // Stage 14 Batch C — extended intake fields (only update if present in body)
  if ("submissionDate" in body) input.submissionDate = parseDate(body.submissionDate);
  if ("projectDeadline" in body) input.projectDeadline = parseDate(body.projectDeadline);
  if ("projectBudget" in body) input.projectBudget = parseStr(body.projectBudget);
  if ("mainContractorName" in body) input.mainContractorName = parseStr(body.mainContractorName);
  if ("interiorContractorName" in body) input.interiorContractorName = parseStr(body.interiorContractorName);
  if ("mainConsultantName" in body) input.mainConsultantName = parseStr(body.mainConsultantName);
  if ("interiorConsultantName" in body) input.interiorConsultantName = parseStr(body.interiorConsultantName);
  if ("endClientName" in body) input.endClientName = parseStr(body.endClientName);
  if ("endClientPhone" in body) input.endClientPhone = parseStr(body.endClientPhone);
  if ("endClientEmail" in body) input.endClientEmail = parseStr(body.endClientEmail);
  if ("endClientAddressLine1" in body) input.endClientAddressLine1 = parseStr(body.endClientAddressLine1);
  if ("endClientAddressLine2" in body) input.endClientAddressLine2 = parseStr(body.endClientAddressLine2);
  if ("endClientCity" in body) input.endClientCity = parseStr(body.endClientCity);
  if ("endClientState" in body) input.endClientState = parseStr(body.endClientState);
  if ("endClientGstNumber" in body) input.endClientGstNumber = parseStr(body.endClientGstNumber);

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
