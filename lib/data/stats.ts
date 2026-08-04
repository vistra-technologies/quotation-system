import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardStats {
  projectsTotal: number;
  /** Count of projects with status "DRAFT" — the only active status currently in use. */
  projectsInProgress: number;
  inquiriesTotal: number;
  /** Count of inquiries with status "NEW" — not yet dismissed or converted. */
  inquiriesNew: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Return KPI counts for the dashboard, scoped to the session org.
 *
 * Uses COUNT queries (not SELECT *) so we never pull full row payloads just to
 * count them — the existing list routes are too heavy for a dashboard summary.
 *
 * Note on Orders: there is no Order model yet (the BOQ/quotation/order pipeline
 * does not exist as of Stage 12 — see README.md stage tracker). The route handler
 * hardcodes ordersTotal = 0; we don't query a non-existent table here.
 *
 * Note on "in progress" interpretation: Project.status is a plain string with
 * "DRAFT" as the only value in use (no status-update DAL exists). "In progress"
 * is interpreted as DRAFT projects — recorded in plan-batch7b.md.
 */
export async function getDashboardStats(
  session: SessionData,
): Promise<DashboardStats> {
  const orgId = session.organizationId;

  const [projectsTotal, projectsInProgress, inquiriesTotal, inquiriesNew] =
    await Promise.all([
      prisma.project.count({ where: { organizationId: orgId } }),
      prisma.project.count({
        where: { organizationId: orgId, status: "DRAFT" },
      }),
      prisma.inquiry.count({ where: { organizationId: orgId } }),
      prisma.inquiry.count({
        where: { organizationId: orgId, status: "NEW" },
      }),
    ]);

  return { projectsTotal, projectsInProgress, inquiriesTotal, inquiriesNew };
}
