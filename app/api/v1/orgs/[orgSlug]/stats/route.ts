import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import { getDashboardStats } from "@/lib/data/stats";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/stats ────────────────────────────────────────

/**
 * Return dashboard KPI counts for the org.
 *
 * Auth: any authenticated org member — no RBAC gate (same as projects/inquiries).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and getDashboardStats()
 *          filtering every COUNT on session.organizationId.
 *
 * Response shape:
 *   {
 *     projectsTotal: number,       // all projects in org
 *     projectsInProgress: number,  // projects with status "DRAFT"
 *     inquiriesTotal: number,      // all inquiries in org
 *     inquiriesNew: number,        // inquiries with status "NEW" (awaiting reply)
 *     ordersTotal: 0,              // always 0 — no Order model exists yet
 *   }
 *
 * ordersTotal is hardcoded to 0 because the Orders pipeline (BOQ/Quotation/Order)
 * has not been built yet — see development-cycles/README.md stage tracker.
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
    console.error("[GET /api/v1/orgs/[orgSlug]/stats]", err);
    return apiServerError();
  }

  try {
    const stats = await getDashboardStats(session);
    return NextResponse.json({
      ...stats,
      ordersTotal: 0,
    });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/stats] getDashboardStats", err);
    return apiServerError();
  }
}
