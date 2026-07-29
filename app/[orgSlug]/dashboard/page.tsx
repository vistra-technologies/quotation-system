import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { orgHref } from "@/lib/orgHref";
import { getOrgById, getSessionRole, getSessionRolePermissions } from "@/lib/data/admin";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

/**
 * Dashboard landing page (Server Component).
 *
 * Stage 11 (Batch 4): restyled to Sage Ease tokens matching
 * dashboard-2026-07-23-v1.html. Shows org badge, welcome heading, and three
 * KPI tiles (Orders / Projects / Inquiries). Counts display "—" until a future
 * stage adds the corresponding Prisma queries; the session/org/role queries are
 * intentionally unchanged from Stage 10.
 *
 * Redirects to /{orgSlug}/login if no valid session exists.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const session = await getSession();

  if (!session) {
    redirect(await orgHref(orgSlug, "/login"));
  }

  const [org] = await Promise.all([
    getOrgById(session.organizationId),
    getSessionRole(session),
    getSessionRolePermissions(session),
  ]);

  return (
    <div className="px-8 pt-7 pb-12">
      {/* Org badge */}
      <div className="mb-3 inline-flex items-center gap-1.5 rounded-pill bg-primary-softer px-3 py-1.5 text-xs font-bold text-primary-dark">
        <svg
          className="h-[13px] w-[13px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
        </svg>
        {org?.name ?? orgSlug}
      </div>

      {/* Welcome heading */}
      <h1 className="text-[27px] font-extrabold leading-tight text-text-heading">
        Welcome, {session.name}
      </h1>
      <p className="mt-1.5 mb-6 text-[13.5px] text-text-muted">
        Here&apos;s what&apos;s happening across your workspace today.
      </p>

      {/* KPI tiles */}
      <div className="flex flex-wrap gap-4">
        {/* Orders */}
        <div className="min-w-[230px] flex-1 rounded-md border border-border bg-bg-card p-[18px] shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary-softer text-primary">
              <svg
                className="h-5 w-5"
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
            <span className="rounded-pill bg-status-paid-bg px-2.5 py-0.5 text-[11px] font-bold text-status-paid-text whitespace-nowrap">
              —
            </span>
          </div>
          <div className="text-[25px] font-extrabold leading-none text-text-heading">—</div>
          <div className="mt-1.5 text-[11.5px] font-bold text-text-muted">Orders</div>
        </div>

        {/* Projects */}
        <div className="min-w-[230px] flex-1 rounded-md border border-border bg-bg-card p-[18px] shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary-softer text-primary">
              <svg
                className="h-5 w-5"
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
            <span className="rounded-pill bg-status-pending-bg px-2.5 py-0.5 text-[11px] font-bold text-status-pending-text whitespace-nowrap">
              —
            </span>
          </div>
          <div className="text-[25px] font-extrabold leading-none text-text-heading">—</div>
          <div className="mt-1.5 text-[11.5px] font-bold text-text-muted">Projects</div>
        </div>

        {/* Inquiries */}
        <div className="min-w-[230px] flex-1 rounded-md border border-border bg-bg-card p-[18px] shadow-card">
          <div className="mb-3.5 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-primary-softer text-primary">
              <svg
                className="h-5 w-5"
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
            <span className="rounded-pill bg-status-pending-bg px-2.5 py-0.5 text-[11px] font-bold text-status-pending-text whitespace-nowrap">
              —
            </span>
          </div>
          <div className="text-[25px] font-extrabold leading-none text-text-heading">—</div>
          <div className="mt-1.5 text-[11.5px] font-bold text-text-muted">Inquiries</div>
        </div>
      </div>
    </div>
  );
}
