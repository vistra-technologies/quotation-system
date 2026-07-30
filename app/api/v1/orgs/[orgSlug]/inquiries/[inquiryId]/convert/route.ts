import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { convertInquiryToProject } from "@/lib/data/inquiries";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert ───────────────

/**
 * Convert an inquiry into a Project ("Start Project" action).
 *
 * Runs the full conversion in a single atomic transaction (see lib/data/inquiries.ts):
 * 1. Fetch + tenancy-guard the inquiry (must be NEW).
 * 2. MAX+1 projectNumber for the org.
 * 3. Create the Project from the inquiry's fields + inquiryId link.
 * 4. Flip Inquiry.status → "CONVERTED".
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and convertInquiryToProject()
 *          via findFirst on (id, organizationId).
 *
 * Returns 201 with the new project on success.
 * Returns 404 if the inquiry is not found or belongs to a different org.
 * Returns 409 if the inquiry is already DISMISSED or CONVERTED, or on a
 *         concurrent projectNumber race collision.
 */
export async function POST(
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
      "[POST /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert]",
      err,
    );
    return apiServerError();
  }

  try {
    const project = await convertInquiryToProject(session, inquiryId);
    return NextResponse.json({ project }, { status: 201 });
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
        return apiConflict("This inquiry is already closed.");
      }
      if (code === "SEQUENCE_CONFLICT") {
        return apiConflict(
          "A project number conflict occurred — please try again.",
        );
      }
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert] convertInquiryToProject",
      err,
    );
    return apiServerError();
  }
}
