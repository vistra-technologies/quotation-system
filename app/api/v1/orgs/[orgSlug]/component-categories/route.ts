import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiServerError,
} from "@/lib/api-error";
import { listComponentCategories } from "@/lib/data/components";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/component-categories ─────────────────────────

/**
 * List all ComponentCategories for the org, A→Z by name.
 *
 * Auth: any authenticated org member — no RBAC permission required.
 * The existing DAL has no permission gate on this read; the endpoint preserves
 * that behavior. Categories serve as the dropdown source for admin component-type
 * forms; gating will be enforced at the page level when those forms are migrated
 * in Batch 6.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listComponentCategories()
 *          filtering on session.organizationId.
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/component-categories",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) => {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("[GET /api/v1/orgs/[orgSlug]/component-categories]", { err });
    return apiServerError();
  }

  try {
    const categories = await listComponentCategories(session);
    return NextResponse.json({ categories });
  } catch (err) {
    log.error("[GET /api/v1/orgs/[orgSlug]/component-categories] listComponentCategories", { err });
    return apiServerError();
  }
});
