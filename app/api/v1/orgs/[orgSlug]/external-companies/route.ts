import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiForbidden,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import {
  listExternalCompanies,
  createExternalCompany,
} from "@/lib/data/external-companies";
import { isSupportedCurrency, DEFAULT_CURRENCY_ERROR_MESSAGE } from "@/lib/currency";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/external-companies ───────────────────────────

/**
 * List all external companies for the org, A→Z by name.
 *
 * Auth: any authenticated org member — no RBAC permission required.
 * This endpoint is intentionally ungated beyond authentication because it
 * serves as the dropdown source for project and inquiry creation forms,
 * which any authenticated user may access.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listExternalCompanies()
 *          filtering on session.organizationId.
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/external-companies",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) => {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("[GET /api/v1/orgs/[orgSlug]/external-companies]", { err });
    return apiServerError();
  }

  try {
    const companies = await listExternalCompanies(session);
    return NextResponse.json({ companies });
  } catch (err) {
    log.error("[GET /api/v1/orgs/[orgSlug]/external-companies] listExternalCompanies", { err });
    return apiServerError();
  }
});

// ─── POST /api/v1/orgs/[orgSlug]/external-companies ──────────────────────────

/**
 * Create a new external company in the org.
 *
 * Auth: authenticated org member with MANAGE_USERS permission.
 * Body: { name, type, country, defaultCurrency } — all required.
 *   type: "DISTRIBUTOR" | "ARCHITECTURAL_FIRM"
 *   country: "INDIA" | "UAE"
 *   defaultCurrency: one of SUPPORTED_CURRENCIES (lib/currency.ts)
 *
 * Returns 201 on success.
 * Returns 400 on missing or invalid fields.
 * Returns 403 if the session role lacks MANAGE_USERS.
 *
 * Stage 13 Batch 2: added country + defaultCurrency (both required).
 */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/external-companies",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) => {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("[POST /api/v1/orgs/[orgSlug]/external-companies]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[POST /api/v1/orgs/[orgSlug]/external-companies] requirePermission", { err });
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

  if (!isSupportedCurrency(defaultCurrency)) {
    return apiBadRequest(DEFAULT_CURRENCY_ERROR_MESSAGE);
  }

  try {
    await createExternalCompany(session, { name, type, country, defaultCurrency });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    log.error("[POST /api/v1/orgs/[orgSlug]/external-companies] createExternalCompany", { err });
    return apiServerError();
  }
});
