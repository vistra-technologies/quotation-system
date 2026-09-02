import { NextResponse } from "next/server";
import {
  requireSuperAdminFromRequest,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { toggleOrgSuspension, createOrgAuditLog } from "@/lib/data/superadmin/orgs";

// Never cached.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/superadmin/orgs/[orgId]/suspend ────────────────────────────
//
// Suspends or reactivates an organization. Flips the isSuspended boolean on the
// Organization row and writes one SuperAdminAuditLog row.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
//
// Body: { suspend: boolean }
//   true  → suspend org   → action "org.suspend"
//   false → reactivate    → action "org.reactivate"
//
// Returns 200 with { ok: true } on success.
// Returns 400 on missing/invalid body.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 when the orgId is not found.
// Returns 500 on unexpected errors (including audit log write failure — every
//   mutation must have an audit row; propagating as 500 is the correct signal).

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<NextResponse> {
  // Authenticate.
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/orgs/[orgId]/suspend] auth error", err);
    return apiServerError();
  }

  const { orgId } = await params;

  // Parse body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).suspend !== "boolean"
  ) {
    return apiBadRequest("suspend (boolean) is required");
  }

  const suspend = (body as { suspend: boolean }).suspend;

  // Apply the toggle.
  const result = await toggleOrgSuspension(orgId, suspend);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiNotFound(result.message);
    }
    console.error(
      "[POST /api/v1/superadmin/orgs/[orgId]/suspend] toggleOrgSuspension error",
      result.message,
    );
    return apiServerError();
  }

  // Write audit log after the update committed.
  // Not wrapped in try/catch — an audit failure propagates as 500 (spec requires
  // every mutation to have an audit row). Consistent with the same discipline in
  // app/api/v1/superadmin/orgs/route.ts (Batch C round-2 fix).
  const action = suspend ? "org.suspend" : "org.reactivate";
  await createOrgAuditLog(sa.superAdminId, orgId, action);

  return NextResponse.json({ ok: true });
}
