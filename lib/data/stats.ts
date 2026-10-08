import { ownedProjectWhere, ownedInquiryWhere } from "@/lib/data/ownership";
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
 *
 * D3 Stage 15 / Hotfix 2026-10-05: role-based scoping via ownedProjectWhere /
 * ownedInquiryWhere.  Internal roles -> org-wide totals; external roles
 * (session.isExternal) -> their company's records only, zero if unlinked.
 *
 * The filter is externalCompanyId = session.externalCompanyId, NOT
 * createdByUserId = session.userId — so the card total matches the list page
 * total (decision 1 in stage-15.md).
 */
export async function getDashboardStats(
  session: SessionData,
): Promise<DashboardStats> {
  const projectWhere = ownedProjectWhere(session);
  const inquiryWhere = ownedInquiryWhere(session);

  const [projectsTotal, projectsInProgress, inquiriesTotal, inquiriesNew] =
    await Promise.all([
      prisma.project.count({ where: projectWhere }),
      prisma.project.count({
        where: { ...projectWhere, status: "DRAFT" },
      }),
      prisma.inquiry.count({ where: inquiryWhere }),
      prisma.inquiry.count({
        where: { ...inquiryWhere, status: "NEW" },
      }),
    ]);

  return { projectsTotal, projectsInProgress, inquiriesTotal, inquiriesNew };
}
