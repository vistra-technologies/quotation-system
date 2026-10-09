import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import { apiUnauthorized, apiServerError } from "@/lib/api-error";
import { listAllPermissionsCatalog } from "@/lib/data/superadmin/roles";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/permissions ──────────────────────────────────────
//
// Returns the global Permission catalog (all codes), A→Z by code.
// The catalog is read-only from the SuperAdmin console — permission rows are
// created/managed via seeding, not runtime UI.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).

export const GET = withRoute(
  "GET /api/v1/superadmin/permissions",
  async (request: Request): Promise<NextResponse> => {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    log.error("[GET /api/v1/superadmin/permissions] auth error", { err });
    return apiServerError();
  }

  try {
    const permissions = await listAllPermissionsCatalog();
    return NextResponse.json({ permissions });
  } catch (err) {
    log.error("[GET /api/v1/superadmin/permissions] listAllPermissionsCatalog", { err });
    return apiServerError();
  }
});
