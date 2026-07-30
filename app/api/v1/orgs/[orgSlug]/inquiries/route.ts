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
import { listInquiries, createInquiry } from "@/lib/data/inquiries";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/inquiries ────────────────────────────────────

/**
 * List all inquiries for the org, newest-first.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listInquiries()
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
    console.error("[GET /api/v1/orgs/[orgSlug]/inquiries]", err);
    return apiServerError();
  }

  try {
    const inquiries = await listInquiries(session);
    return NextResponse.json({ inquiries });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/inquiries] listInquiries", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/inquiries ───────────────────────────────────

/**
 * Create a new inquiry in the org.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { name, destinationCountry, currency, externalCompanyId? }
 *
 * Returns 201 with the created inquiry on success.
 * Returns 400 on missing required fields or invalid external company.
 * Returns 409 on concurrent inquiryNumber collision.
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
    console.error("[POST /api/v1/orgs/[orgSlug]/inquiries]", err);
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
  const externalCompanyId =
    typeof body.externalCompanyId === "string" && body.externalCompanyId
      ? body.externalCompanyId
      : null;

  if (!name || !destinationCountry || !currency) {
    return apiBadRequest("name, destinationCountry, and currency are required");
  }

  try {
    const inquiry = await createInquiry(session, {
      name,
      destinationCountry,
      currency,
      externalCompanyId,
    });
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SEQUENCE_CONFLICT"
    ) {
      return apiConflict(
        "An inquiry number conflict occurred — please try again.",
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
    console.error("[POST /api/v1/orgs/[orgSlug]/inquiries] createInquiry", err);
    return apiServerError();
  }
}
