import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  getExternalCompanyById,
  updateExternalCompany,
  deleteExternalCompany,
} from "@/lib/data/external-companies";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/external-companies/[companyId] ───────────────

/**
 * Get a single external company by ID, scoped to the org.
 *
 * Auth: any authenticated org member — no RBAC permission required.
 * Serves locked-company display on the project/inquiry create forms.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getExternalCompanyById()
 *          filtering on session.organizationId — returns null for companies
 *          that belong to a different org, surfaced as 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  const { orgSlug, companyId } = await params;

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
      "[GET /api/v1/orgs/[orgSlug]/external-companies/[companyId]]",
      err,
    );
    return apiServerError();
  }

  try {
    const company = await getExternalCompanyById(session, companyId);
    if (!company) {
      return apiNotFound("External company not found");
    }
    return NextResponse.json({ company });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/external-companies/[companyId]] getExternalCompanyById",
      err,
    );
    return apiServerError();
  }
}

// ─── PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId] ─────────────

/**
 * Update an existing external company in the org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body: { name, type, country, defaultCurrency } — all required.
 * Returns 200 on success, 404 if not found in org, 403 if lacking MANAGE_USERS.
 *
 * Stage 13 Batch 2.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  const { orgSlug, companyId } = await params;

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
      "[PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId]]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId]] requirePermission",
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

  const name = typeof body.name === "string" ? body.name.trim() : null;
  const type = typeof body.type === "string" ? body.type : null;
  const country = typeof body.country === "string" ? body.country : null;
  const defaultCurrency =
    typeof body.defaultCurrency === "string" ? body.defaultCurrency : null;

  if (!name || !type || !country || !defaultCurrency) {
    return apiBadRequest("name, type, country, and defaultCurrency are required");
  }

  if (type !== "DISTRIBUTOR" && type !== "ARCHITECTURAL_FIRM") {
    return apiBadRequest(
      'type must be "DISTRIBUTOR" or "ARCHITECTURAL_FIRM"',
    );
  }

  if (country !== "INDIA" && country !== "UAE") {
    return apiBadRequest('country must be "INDIA" or "UAE"');
  }

  if (
    defaultCurrency !== "INR" &&
    defaultCurrency !== "AED" &&
    defaultCurrency !== "USD"
  ) {
    return apiBadRequest('defaultCurrency must be "INR", "AED", or "USD"');
  }

  try {
    const updated = await updateExternalCompany(session, companyId, {
      name,
      type,
      country,
      defaultCurrency,
    });
    if (!updated) return apiNotFound("External company not found");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId]] updateExternalCompany",
      err,
    );
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId] ────────────

/**
 * Delete an external company from the org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * FK cascade: User/Project/Inquiry.externalCompanyId use ON DELETE SET NULL —
 *   clean cascade, no dependent-records guard needed, no 409.
 * Returns 200 on success, 404 if not found in org, 403 if lacking MANAGE_USERS.
 *
 * Stage 13 Batch 2.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  const { orgSlug, companyId } = await params;

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
      "[DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]]",
      err,
    );
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const deleted = await deleteExternalCompany(session, companyId);
    if (!deleted) return apiNotFound("External company not found");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]] deleteExternalCompany",
      err,
    );
    return apiServerError();
  }
}
