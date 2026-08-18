import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import {
  getInquiryById,
  dismissInquiry,
  updateInquiry,
} from "@/lib/data/inquiries";

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
 * Two operations share this PATCH endpoint, discriminated by body presence:
 *
 * 1. Dismiss (no body, or body without editable fields):
 *    Sets status → DISMISSED. Any authenticated org member may call this.
 *    Returns 404 if not found; 409 if already DISMISSED or CONVERTED.
 *
 * 2. Update (body contains one or more of: name, currency, projectLocation):
 *    Note: destinationCountry is derived server-side from the linked company's country (D19, Stage 14)
 *    and is not accepted from the client.
 *    Updates the supplied editable fields. Only allowed while status === "NEW";
 *    returns 409 otherwise. `externalCompanyId` is silently excluded from the
 *    update payload even if the client sends it (locked for the life of the record).
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and DAL findFirst on
 *          (id, organizationId).
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

  // Discriminate: parse the body to detect whether this is an update or dismiss.
  // The dismiss action sends no body; the update action sends a JSON object with
  // one or more editable fields. internalFetch always sets Content-Type:
  // application/json, so we can't use that header to discriminate — read the body
  // text instead.
  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch {
    // ignore — treat as empty
  }

  // destinationCountry excluded from UPDATE_FIELDS — locked at create time (D19)
  const UPDATE_FIELDS = [
    "name", "currency", "projectLocation",
    // Stage 14 extended intake fields
    "submissionDate", "projectDeadline", "projectBudget",
    "mainContractorName", "interiorContractorName", "mainConsultantName", "interiorConsultantName",
    "endClientName", "endClientPhone", "endClientEmail",
    "endClientAddressLine1", "endClientAddressLine2", "endClientCity", "endClientState",
    "endClientGstNumber",
  ] as const;

  let parsedBody: Record<string, unknown> | null = null;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return apiBadRequest("Invalid JSON body.");
    }
  }

  const isUpdate =
    parsedBody !== null &&
    UPDATE_FIELDS.some((f) => f in (parsedBody as Record<string, unknown>));

  // ── Update path ──────────────────────────────────────────────────────────────
  if (isUpdate) {
    // Silently strip externalCompanyId and destinationCountry (both locked for life of record).
    const body = parsedBody as Record<string, unknown>;
    const name = body.name as string | undefined;
    // destinationCountry intentionally excluded (D19)
    const currency = body.currency as string | undefined;
    const projectLocation = body.projectLocation as string | null | undefined;

    // Basic validation: if a field is present it must be a non-empty string
    // (except projectLocation which may be null/empty = clear).
    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return apiBadRequest("name must be a non-empty string.");
    }
    if (currency !== undefined && (typeof currency !== "string" || !currency.trim())) {
      return apiBadRequest("currency must be a non-empty string.");
    }

    // Stage 14 — extended intake field helpers
    const parseDate = (v: unknown): Date | null | undefined =>
      v === undefined ? undefined :
      typeof v === "string" && v.trim() ? new Date(`${v.trim()}T00:00:00.000Z`) : null;
    const parseStr = (v: unknown): string | null | undefined =>
      v === undefined ? undefined :
      typeof v === "string" && v.trim() ? v.trim() : null;

    try {
      const inquiry = await updateInquiry(session, inquiryId, {
        name: name?.trim(),
        currency: currency?.trim().toUpperCase(),
        projectLocation:
          projectLocation !== undefined
            ? (typeof projectLocation === "string" && projectLocation.trim()
              ? projectLocation.trim()
              : null)
            : undefined,
        // Stage 14 extended intake fields
        submissionDate: parseDate(body.submissionDate),
        projectDeadline: parseDate(body.projectDeadline),
        projectBudget: parseStr(body.projectBudget),
        mainContractorName: parseStr(body.mainContractorName),
        interiorContractorName: parseStr(body.interiorContractorName),
        mainConsultantName: parseStr(body.mainConsultantName),
        interiorConsultantName: parseStr(body.interiorConsultantName),
        endClientName: parseStr(body.endClientName),
        endClientPhone: parseStr(body.endClientPhone),
        endClientEmail: parseStr(body.endClientEmail),
        endClientAddressLine1: parseStr(body.endClientAddressLine1),
        endClientAddressLine2: parseStr(body.endClientAddressLine2),
        endClientCity: parseStr(body.endClientCity),
        endClientState: parseStr(body.endClientState),
        endClientGstNumber: parseStr(body.endClientGstNumber),
      });
      return NextResponse.json({ inquiry });
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err) {
        const code = (err as { code: string }).code;
        if (code === "NOT_FOUND") return apiNotFound("Inquiry not found.");
        if (code === "NOT_EDITABLE")
          return apiConflict("Only NEW inquiries can be edited.");
      }
      console.error(
        "[PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]] updateInquiry",
        err,
      );
      return apiServerError();
    }
  }

  // ── Dismiss path (existing behavior) ─────────────────────────────────────────
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
