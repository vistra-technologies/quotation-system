import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { getInquiryById, dismissInquiry } from "@/lib/data/inquiries";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/inquiries/[inquiryId] ────────────────────────

/**
 * Get a single inquiry by ID, scoped to the org.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getInquiryById()
 *          filtering on session.organizationId — returns null for inquiries that
 *          belong to a different org, surfaced as 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; inquiryId: string }> },
) {
  const { orgSlug, inquiryId } = await params;

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
      "[GET /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]]",
      err,
    );
    return apiServerError();
  }

  try {
    const inquiry = await getInquiryById(session, inquiryId);
    if (!inquiry) {
      return apiNotFound("Inquiry not found");
    }
    return NextResponse.json({ inquiry });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]] getInquiryById",
      err,
    );
    return apiServerError();
  }
}

// ─── PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId] ──────────────────────

/**
 * Dismiss an inquiry (status → DISMISSED).
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and dismissInquiry()
 *          via findFirst on (id, organizationId).
 *
 * Returns 200 with the updated inquiry on success.
 * Returns 404 if the inquiry is not found or belongs to a different org.
 * Returns 409 if the inquiry is already DISMISSED or CONVERTED (idempotency guard).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; inquiryId: string }> },
) {
  const { orgSlug, inquiryId } = await params;

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
      "[PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]]",
      err,
    );
    return apiServerError();
  }

  try {
    const inquiry = await dismissInquiry(session, inquiryId);
    return NextResponse.json({ inquiry });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err
    ) {
      const code = (err as { code: string }).code;
      if (code === "NOT_FOUND") {
        return apiNotFound("Inquiry not found");
      }
      if (code === "ALREADY_CLOSED") {
        return apiConflict("Inquiry is already closed.");
      }
    }
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]] dismissInquiry",
      err,
    );
    return apiServerError();
  }
}
