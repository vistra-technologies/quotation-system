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
import {
  deleteOrganization,
  createOrgAuditLog,
  updateOrgSettings,
  computeOrgMismatchWarnings,
  getOrgForEdit,
} from "@/lib/data/superadmin/orgs";
import { getFormulaSet } from "@/lib/data/superadmin/formula-sets";

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

// ─── PATCH /api/v1/superadmin/orgs/[orgId] ───────────────────────────────────
//
// Updates org name and/or formula set assignment.
// At least one of { name, formulaSetId } must be provided.
// Returns mismatch warnings when the new formula set has a structural mismatch
// with the org's current component types (S25-13 — advisory, never blocking).
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
//
// Returns 200 { org: { id, name, slug, isSuspended, activeFormulaSetId }, warnings } on success.
// Returns 400 if no updatable fields supplied.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 when orgId or formulaSetId not found.

export async function PATCH(
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
    console.error("[PATCH /api/v1/superadmin/orgs/[orgId]] auth error", err);
    return apiServerError();
  }

  const { orgId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (typeof body !== "object" || body === null) {
    return apiBadRequest("Request body must be a JSON object");
  }

  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : undefined;
  const formulaSetId = typeof b.formulaSetId === "string" ? b.formulaSetId.trim() : undefined;

  if (name === undefined && formulaSetId === undefined) {
    return apiBadRequest("At least one of name or formulaSetId must be provided");
  }
  if (name !== undefined && name.length === 0) {
    return apiBadRequest("name must not be empty");
  }

  // Validate the formula set exists if a new one is being assigned.
  let formulaSetRecord: Awaited<ReturnType<typeof getFormulaSet>> = null;
  if (formulaSetId !== undefined) {
    formulaSetRecord = await getFormulaSet(formulaSetId);
    if (!formulaSetRecord) {
      return apiNotFound("Formula set not found");
    }
  }

  const result = await updateOrgSettings(orgId, { name, formulaSetId });
  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiNotFound(result.message);
    }
    console.error("[PATCH /api/v1/superadmin/orgs/[orgId]] updateOrgSettings error", result.message);
    return apiServerError();
  }

  // Audit log.
  await createOrgAuditLog(sa.superAdminId, orgId, "org.update", {
    ...(name !== undefined ? { name } : {}),
    ...(formulaSetId !== undefined ? { formulaSetId } : {}),
  });

  // Fetch the updated org for the response + mismatch warnings.
  const updatedOrg = await getOrgForEdit(orgId);
  if (!updatedOrg) {
    return apiNotFound("Organization not found after update");
  }

  const warnings = updatedOrg.activeFormulaSetId
    ? await computeOrgMismatchWarnings(orgId, updatedOrg.activeFormulaSetId)
    : [];

  const activeFs = updatedOrg.activeFormulaSet;
  return NextResponse.json({
    org: {
      id: updatedOrg.id,
      name: updatedOrg.name,
      slug: updatedOrg.slug,
      isSuspended: updatedOrg.isSuspended,
      activeFormulaSetId: updatedOrg.activeFormulaSetId,
      formulaSetLabel: activeFs ? `${activeFs.name} v${activeFs.version}` : null,
    },
    warnings,
  });
}
