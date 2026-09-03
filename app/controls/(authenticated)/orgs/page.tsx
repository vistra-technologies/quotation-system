import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { SuspendOrgButton } from "./_suspend-button";
import { DeleteOrgButton } from "./_delete-button";

// Always render live — reads the SuperAdminSession table (via guard layout) and live DB.
export const dynamic = "force-dynamic";

// ─── API response types ───────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  isSuspended: boolean;
  createdAt: string; // ISO string from JSON
  userCount: number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * SuperAdmin org list page (Server Component).
 *
 * Lists all organizations across the platform with name, slug, suspension status,
 * user count, and creation date.
 *
 * Auth: enforced by app/controls/(authenticated)/layout.tsx — any request that
 * reaches this page has already passed requireSuperAdmin(). Do not call it again.
 *
 * UI/API separation (Stage 12 pattern): fetches from GET /api/v1/superadmin/orgs
 * via internalFetch, forwarding the qs-sa-token cookie so the route handler's
 * requireSuperAdminFromRequest() sees the session.
 *
 * Pagination: at wireframe stage this renders all orgs (no UI pagination controls).
 * The API supports an arbitrary future limit via the DAL; the page renders whatever
 * the API returns.
 *
 * Stage 16 Batch C — F2.
 */
export default async function OrgsPage() {
  const res = await internalFetch("/api/v1/superadmin/orgs");

  if (!res.ok) {
    return (
      <p className="p-8 text-center text-sm text-status-failed-text">
        Failed to load organizations — please refresh.
      </p>
    );
  }

  const orgs = ((await res.json()) as { orgs: OrgRow[] }).orgs;
  const activeOrgs = orgs.filter((o) => !o.isSuspended);
  const suspendedOrgs = orgs.filter((o) => o.isSuspended);

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-heading">Organizations</h1>
          <p className="mt-1 text-sm text-text-muted">
            All organizations registered on the platform.
          </p>
        </div>
        <Link
          href="/controls/orgs/new"
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
        >
          Create org
        </Link>
      </div>

      {/* ── Active orgs ── */}
      <div className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
          Active
        </h2>
        <OrgsTable orgs={activeOrgs} emptyMessage="No active organizations." />
      </div>

      {/* ── Suspended orgs — kept separate so they don't clutter the active list ── */}
      {suspendedOrgs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
            Suspended
          </h2>
          <OrgsTable
            orgs={suspendedOrgs}
            emptyMessage="No suspended organizations."
            showDeleteButton
          />
        </div>
      )}
    </div>
  );
}

function OrgsTable({
  orgs,
  emptyMessage,
  showDeleteButton = false,
}: {
  orgs: OrgRow[];
  emptyMessage: string;
  /** When true, renders a Delete button alongside the Suspend/Reactivate button.
   *  Only pass this for the suspended-orgs section — deleted orgs are gone. */
  showDeleteButton?: boolean;
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                Name
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                Slug
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                Status
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                Users
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                Created
              </th>
              <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-8 text-center text-sm text-text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              orgs.map((org) => (
                <tr
                  key={org.id}
                  className="border-b border-border last:border-0 hover:bg-primary-softer/40"
                >
                  <td className="px-5 py-4 font-bold text-text-heading">
                    {org.name}
                  </td>
                  <td className="px-5 py-4 font-mono text-sm text-text-body">
                    {org.slug}
                  </td>
                  <td className="px-5 py-4">
                    {org.isSuspended ? (
                      <span className="inline-flex items-center rounded-pill bg-status-failed-bg px-2.5 py-0.5 text-xs font-bold text-status-failed-text">
                        Suspended
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-pill bg-status-paid-bg px-2.5 py-0.5 text-xs font-bold text-status-paid-text">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-text-body">{org.userCount}</td>
                  <td className="px-5 py-4 text-text-muted">
                    {new Date(org.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <SuspendOrgButton
                        orgId={org.id}
                        orgName={org.name}
                        isSuspended={org.isSuspended}
                      />
                      {showDeleteButton && (
                        <DeleteOrgButton
                          orgId={org.id}
                          orgName={org.name}
                          orgSlug={org.slug}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
