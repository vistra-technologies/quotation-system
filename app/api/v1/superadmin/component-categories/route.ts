import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import {
  apiBadRequest,
  apiUnauthorized,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { listComponentCategoriesForOrg } from "@/lib/data/superadmin/component-types";
import { getOrgById } from "@/lib/data/superadmin/orgs";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/component-categories?orgId=xxx ───────────────────
//
// Returns all ComponentCategories for the given org, A→Z by name.
// Used by the create/edit form category dropdown on /controls/component-types.
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query: ?orgId=<organizationId>

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/component-categories] auth error", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId")?.trim();

  if (!orgId) {
    return apiBadRequest("orgId query parameter is required");
  }

  // Verify the org exists.
  const org = await getOrgById(orgId);
  if (!org) {
    return apiNotFound("Organization not found");
  }

  try {
    const categories = await listComponentCategoriesForOrg(orgId);
    return NextResponse.json({ categories });
  } catch (err) {
    console.error("[GET /api/v1/superadmin/component-categories] listComponentCategoriesForOrg", err);
    return apiServerError();
  }
}
