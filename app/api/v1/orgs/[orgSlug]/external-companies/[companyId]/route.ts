import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { getExternalCompanyById } from "@/lib/data/external-companies";

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
