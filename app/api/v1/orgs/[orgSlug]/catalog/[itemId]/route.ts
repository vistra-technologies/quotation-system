import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { getCatalogItemById } from "@/lib/data/catalog";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/catalog/[itemId] ─────────────────────────────

/**
 * Get a single CatalogItem by ID, scoped to the org, with its prices.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Returns 404 if the item does not exist in the org (tenancy guard: items
 * belonging to another org are indistinguishable from missing items).
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getCatalogItemById()
 *          filtering on session.organizationId — returns null for items that
 *          belong to a different org, surfaced as 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; itemId: string }> },
) {
  const { orgSlug, itemId } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/catalog/[itemId]]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/catalog/[itemId]] requirePermission",
      err,
    );
    return apiServerError();
  }

  try {
    const item = await getCatalogItemById(session, itemId);
    if (!item) {
      return apiNotFound("Catalog item not found");
    }
    return NextResponse.json({ item });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/catalog/[itemId]] getCatalogItemById",
      err,
    );
    return apiServerError();
  }
}
