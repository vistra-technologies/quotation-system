import { redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

interface MeResponse {
  name: string;
  username: string;
  orgName: string;
}

interface StatsResponse {
  projectsTotal: number;
  projectsInProgress: number;
  inquiriesTotal: number;
  inquiriesNew: number;
  ordersTotal: number;
}

const EMPTY_STATS: StatsResponse = {
  projectsTotal: 0,
  projectsInProgress: 0,
  inquiriesTotal: 0,
  inquiriesNew: 0,
  ordersTotal: 0,
};

/**
 * Dashboard landing page (Server Component).
 *
 * Shows a welcome header and KPI tiles for Orders, Projects, and Inquiries.
 * Redirects to /{orgSlug}/login if no valid session exists.
 *
 * Stage 12 Batch 6: switched from getSession()/getOrgById()/getSessionRole()/
 * getSessionRolePermissions() DAL to a single internalFetch against
 * /api/v1/orgs/[orgSlug]/me (rich response per plan-batch6.md D2).
 *
 * Stage 12 Batch 7b: added parallel internalFetch against
 * /api/v1/orgs/[orgSlug]/stats for real KPI counts. Stats fall back to 0
 * on any error — never shows "—". The Orders count is always 0 (no Order
 * model exists yet; see development-cycles/README.md). The "in progress" chip
 * counts DRAFT projects (the only active status currently in use). The
 * "awaiting reply" chip counts NEW inquiries. See plan-batch7b.md for the
 * full trend-chip interpretation rationale.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [meRes, statsRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/stats`),
  ]);

  if (meRes.status === 401 || meRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const me = (await meRes.json()) as MeResponse;

  // Stats degrade gracefully to 0 if the route fails — never `—`
  let stats: StatsResponse = EMPTY_STATS;
  if (statsRes.ok) {
    stats = (await statsRes.json()) as StatsResponse;
  }

  // Full name for greeting (D1 — Stage 15: show full name, not just the first word)
  const displayName = me.name ?? me.username;

  return (
    <div className="px-8 py-7">
      {/* Welcome heading */}
      <h1 className="mb-1 text-[27px] font-extrabold leading-tight text-text-heading">
        Welcome, {displayName}
      </h1>
      <p className="mb-6 text-sm text-text-muted">
        Here&apos;s what&apos;s happening across your workspace today.
      </p>

      {/* KPI tiles */}
      <div className="flex flex-wrap gap-4">
        {/* Orders — always 0; no Order model exists yet */}
        <div className="flex min-w-[230px] flex-1 flex-col rounded-md border border-border bg-bg-card p-[18px] shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary-softer text-primary">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
              </svg>
            </div>
            <span className="whitespace-nowrap rounded-pill bg-status-refunded-bg px-2.5 py-0.5 text-[11px] font-bold text-status-refunded-text">
              No orders yet
            </span>
          </div>
          <div className="text-[25px] font-extrabold leading-none text-text-heading">
            {stats.ordersTotal}
          </div>
          <div className="mt-1.5 text-[11.5px] font-bold text-text-muted">
            Orders
          </div>
        </div>

        {/* Projects — total count + DRAFT "in progress" chip */}
        <div className="flex min-w-[230px] flex-1 flex-col rounded-md border border-border bg-bg-card p-[18px] shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary-softer text-primary">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
              </svg>
            </div>
            <span className="whitespace-nowrap rounded-pill bg-status-pending-bg px-2.5 py-0.5 text-[11px] font-bold text-status-pending-text">
              {stats.projectsInProgress} in progress
            </span>
          </div>
          <div className="text-[25px] font-extrabold leading-none text-text-heading">
            {stats.projectsTotal}
          </div>
          <div className="mt-1.5 text-[11.5px] font-bold text-text-muted">
            Projects
          </div>
        </div>

        {/* Inquiries — total count + NEW "awaiting reply" chip */}
        <div className="flex min-w-[230px] flex-1 flex-col rounded-md border border-border bg-bg-card p-[18px] shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary-softer text-primary">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <span className="whitespace-nowrap rounded-pill bg-status-pending-bg px-2.5 py-0.5 text-[11px] font-bold text-status-pending-text">
              {stats.inquiriesNew} awaiting reply
            </span>
          </div>
          <div className="text-[25px] font-extrabold leading-none text-text-heading">
            {stats.inquiriesTotal}
          </div>
          <div className="mt-1.5 text-[11.5px] font-bold text-text-muted">
            Inquiries
          </div>
        </div>
      </div>
    </div>
  );
}
