import { NextResponse } from "next/server";
import {
  requireSuperAdminFromRequest,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";
import {
  apiUnauthorized,
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { deleteOrganization, createOrgAuditLog } from "@/lib/data/superadmin/orgs";

// Never cached.
export const dynamic = "force-dynamic";

// ─── DELETE /api/v1/superadmin/orgs/[orgId] ──────────────────────────────────
//
// Hard-deletes a suspended organization and all of its org-scoped child rows
// in FK-safe order inside one transaction.
//
// Safety gate: only a currently-suspended org (isSuspended: true) may be
// deleted — returns 400 if the org is active.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
//
// Returns 200 with { ok: true } on success.
// Returns 400 if the org exists but is not suspended.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 when the orgId is not found.
// Returns 500 on unexpected errors (including audit log write failure — every
//   mutation must have an audit row; propagating as 500 is the correct signal).

export async function DELETE(
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
    console.error("[DELETE /api/v1/superadmin/orgs/[orgId]] auth error", err);
    return apiServerError();
  }

  const { orgId } = await params;

  // Execute the hard delete (DAL handles the suspended gate + transaction).
  const result = await deleteOrganization(orgId);

  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiNotFound(result.message);
    }
    if (result.reason === "not_suspended") {
      return apiBadRequest(result.message);
    }
    console.error(
      "[DELETE /api/v1/superadmin/orgs/[orgId]] deleteOrganization error",
      result.message,
    );
    return apiServerError();
  }

  // Write audit log after the transaction committed.
  // Not wrapped in try/catch — audit failure propagates as 500 (spec requires
  // every mutation to have an audit row). The { slug, name } snapshot was
  // captured before deletion so the record survives the now-gone Organization row.
  await createOrgAuditLog(
    sa.superAdminId,
    result.org.id,
    "org.delete",
    { slug: result.org.slug, name: result.org.name },
  );

  return NextResponse.json({ ok: true });
}
