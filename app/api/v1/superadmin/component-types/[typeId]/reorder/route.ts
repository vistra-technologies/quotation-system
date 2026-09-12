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
import {
  moveComponentTypeForOrg,
  createComponentTypeAuditLog,
} from "@/lib/data/superadmin/component-types";
import { getOrgById } from "@/lib/data/superadmin/orgs";

// Never cached.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/superadmin/component-types/[typeId]/reorder ────────────────
//
// Swaps `sortOrder` between this ComponentType and its adjacent neighbour in the org's
// `sortOrder asc, code asc` list. Writes one SuperAdminAuditLog row with action
// "componentType.reorder" — only when an actual swap happened (a no-op edge move writes
// no audit row, mirroring the "no-op" cases across the SuperAdmin console).
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Body: { orgId: string; direction: "up" | "down" }
//
// Returns 200 with { ok: true, moved: boolean } on success (moved: false = already at
//   that edge of the list, e.g. Up on the first row).
// Returns 400 on missing/invalid body.
// Returns 401 when not authenticated as SuperAdmin.
// Returns 404 if the org or componentType does not exist.
//
// Stage 20 Batch 7.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ typeId: string }> },
): Promise<NextResponse> {
  let sa;
  try {
    sa = await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[POST /api/v1/superadmin/component-types/[typeId]/reorder] auth error", err);
    return apiServerError();
  }

  const { typeId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Invalid JSON body");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).orgId !== "string"
  ) {
    return apiBadRequest("orgId is required");
  }

  const b = body as Record<string, unknown>;
  const orgId = (b.orgId as string).trim();
  const direction = b.direction;

  if (!orgId) return apiBadRequest("orgId is required");
  if (direction !== "up" && direction !== "down") {
    return apiBadRequest('direction must be "up" or "down"');
  }

  // Verify the org exists.
  const org = await getOrgById(orgId);
  if (!org) {
    return apiNotFound("Organization not found");
  }

  let result;
  try {
    result = await moveComponentTypeForOrg(orgId, typeId, direction);
  } catch (err) {
    console.error(
      "[POST /api/v1/superadmin/component-types/[typeId]/reorder] moveComponentTypeForOrg",
      err,
    );
    return apiServerError();
  }

  if ("notFound" in result) return apiNotFound("ComponentType not found");

  if ("swapped" in result) {
    // Write audit log after the mutation committed — only on an actual swap.
    await createComponentTypeAuditLog(sa.superAdminId, typeId, "componentType.reorder", {
      orgId,
      orgName: org.name,
      direction,
    });
  }

  return NextResponse.json({ ok: true, moved: "swapped" in result });
}
