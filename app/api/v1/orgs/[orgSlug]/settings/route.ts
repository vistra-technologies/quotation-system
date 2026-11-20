import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import { apiBadRequest, apiForbidden, apiNotFound, apiServerError } from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { CURRENCY_ERROR_MESSAGE, isSupportedCurrency } from "@/lib/currency";
import { getOrgSettings, updateOrgDefaultCurrency } from "@/lib/data/org-settings";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached: reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/settings ─────────────────────────────────────

/**
 * The org's settings (Stage 38, S38-7): `{ defaultCurrency }`.
 *
 * Auth: authenticated org member with MANAGE_ORG (403 otherwise). A suspended org is refused by
 * getApiSession (403 ORG_SUSPENDED). Every user can still read the default currency through `/me`
 * (`orgDefaultCurrency`).
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/settings",
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
    log.error("[GET /api/v1/orgs/[orgSlug]/settings]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_ORG);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[GET /api/v1/orgs/[orgSlug]/settings] requirePermission", { err });
    return apiServerError();
  }

  try {
    const settings = await getOrgSettings(session);
    if (!settings) return apiNotFound("Organization not found");
    return NextResponse.json({ defaultCurrency: settings.defaultCurrency });
  } catch (err) {
    log.error("[GET /api/v1/orgs/[orgSlug]/settings] getOrgSettings", { err });
    return apiServerError();
  }
});

// ─── PATCH /api/v1/orgs/[orgSlug]/settings ───────────────────────────────────

/**
 * Update the org's settings. Body `{ defaultCurrency }` (trimmed, upper-cased, INR|AED|USD).
 *
 * Auth: MANAGE_ORG. Returns 200 `{ defaultCurrency }`; 400 on a missing/unsupported currency or bad body.
 * The target org is always the session org.
 */
export const PATCH = withRoute(
  "PATCH /api/v1/orgs/[orgSlug]/settings",
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
    log.error("[PATCH /api/v1/orgs/[orgSlug]/settings]", { err });
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_ORG);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    log.error("[PATCH /api/v1/orgs/[orgSlug]/settings] requirePermission", { err });
    return apiServerError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiBadRequest("Request body must be a JSON object");
  }

  const raw = (body as Record<string, unknown>).defaultCurrency;
  const defaultCurrency = typeof raw === "string" ? raw.trim().toUpperCase() : raw;
  if (!isSupportedCurrency(defaultCurrency)) return apiBadRequest(CURRENCY_ERROR_MESSAGE);

  try {
    const updated = await updateOrgDefaultCurrency(session, defaultCurrency);
    return NextResponse.json({ defaultCurrency: updated.defaultCurrency });
  } catch (err) {
    log.error("[PATCH /api/v1/orgs/[orgSlug]/settings] updateOrgDefaultCurrency", { err });
    return apiServerError();
  }
});
