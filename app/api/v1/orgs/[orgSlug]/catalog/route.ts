import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { listCatalogItems } from "@/lib/data/catalog";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/catalog ──────────────────────────────────────

/**
 * List all active CatalogItems for the org, with their prices.
 * Ordered category → code, then prices by currency within each item.
 *
 * Auth: authenticated org member with MANAGE_PRICING permission.
 *
 * Unlike component-types (where the list is open to all authenticated users
 * for the project configurator), catalog reads are fully gated at MANAGE_PRICING —
 * per the stage-12.md RBAC table: catalog/** reads and writes both require
 * MANAGE_PRICING.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listCatalogItems()
 *          filtering on session.organizationId.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/catalog]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_PRICING);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error("[GET /api/v1/orgs/[orgSlug]/catalog] requirePermission", err);
    return apiServerError();
  }

  try {
    const items = await listCatalogItems(session);
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/catalog] listCatalogItems", err);
    return apiServerError();
  }
}
