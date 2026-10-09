import Link from "next/link";
import { notFound } from "next/navigation";
import { compatResultToWarnings } from "@/lib/data/superadmin/orgs";
import { MismatchChip } from "../_mismatch-chip";
import { SeatPill } from "../../_seat-pill";
import { loadWorkspaceOrg } from "./_org";
import { OrgTabs } from "./_tabs";

// Always render live — status, counts and the computed mismatch must be fresh every load.
export const dynamic = "force-dynamic";

/**
 * Org workspace layout (Server Component, Stage 29 S29-2 / S29-5).
 *
 * Fetches the org once and renders the header (name, mismatch chip, status + seat pills,
 * subdomain) and the tab strip above whichever tab page is active. Works for a suspended org:
 * every tab stays usable so a SuperAdmin can fix things before reactivating.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx.
 */
export default async function OrgWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const org = await loadWorkspaceOrg(orgId);
  if (!org) notFound();

  const hasMismatch =
    compatResultToWarnings(
      org.mismatch,
      org.activeFormulaSet?.name ?? "",
      org.activeFormulaSet?.version ?? 0,
    ).length > 0;

  return (
    <div>
      <Link
        href="/controls/orgs"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-text-heading"
      >
        ← Back to organizations
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-text-heading">{org.name}</h1>
        {hasMismatch && <MismatchChip show />}
        <span
          className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold ${
            org.isSuspended
              ? "bg-status-failed-bg text-status-failed-text"
              : "bg-status-paid-bg text-status-paid-text"
          }`}
        >
          {org.isSuspended ? "Suspended" : "Active"}
        </span>
        <SeatPill used={org.userCount} limit={org.userLimit} />
      </div>
      <p className="mt-1.5">
        <span className="rounded-sm bg-[rgba(27,40,30,0.06)] px-1.5 py-0.5 font-mono text-xs text-text-muted">
          {org.slug}.easeetool.com
        </span>
      </p>

      {org.isSuspended && (
        <div
          role="status"
          className="mt-4 rounded-md border border-status-pending-border bg-status-pending-bg px-4 py-3 text-sm font-semibold text-status-pending-text"
        >
          This organization is suspended. Its users cannot sign in or use the app. Every tab below
          stays editable so you can fix things before reactivating.
        </div>
      )}

      <OrgTabs orgId={org.id} userCount={org.userCount} userLimit={org.userLimit} />

      {children}
    </div>
  );
}
