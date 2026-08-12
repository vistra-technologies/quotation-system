import { notFound, redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import {
  ListPageControls,
  ListPagePagination,
} from "@/components/list-page-controls";

// Always render live — reads session cookie.
export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Shape of an order row — no Order model exists yet, so this is a forward-
 * compatible placeholder that will be filled in when the pipeline is built.
 * The page always renders the empty state for now.
 */
interface OrderListItem {
  id: string;
  name: string;
  status: string;
  value: string | null;
  createdAt: string;
  submittedAt: string | null;
  destinationCountry: string | null;
  externalCompany: { id: string; name: string } | null;
}

interface ExternalCompanyOption {
  id: string;
  name: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Orders list page (Server Component).
 *
 * Stage 12 Batch 7e: upgraded from inert placeholder to the shared list-page
 * pattern — same toolbar (date-range filter, search, My/All toggle, external-
 * company filter for internal users), same pagination footer, same row density,
 * and same empty-state message as Inquiries/Projects.
 *
 * No Order model exists yet — the API route returns { orders: [], total: 0 } so
 * the page always renders the "No orders yet" empty state. No fake seed data, no
 * special one-off placeholder message. Column structure is written for when the
 * pipeline arrives (Project Name, Client Name/Company, Location, Status, Value,
 * Created On, Submission Date).
 *
 * Orders-specific vs Inquiries:
 *   - No "New Order" button (orders come from the quotation pipeline, not direct creation)
 *   - No row checkboxes
 *   - No edit/delete row actions
 *   - Adds "Value" column (between Status and Created On)
 *
 * RBAC: auth-only (no permission gate) — same as projects/inquiries.
 */
export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    scope?: string;
    search?: string;
    dateRange?: string;
    page?: string;
    externalCompanyId?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;

  // Parse and validate URL params — defaults match API route defaults.
  const scope = sp.scope === "mine" ? "mine" : "all";
  const search = typeof sp.search === "string" ? sp.search : "";
  const dateRange = typeof sp.dateRange === "string" ? sp.dateRange : "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = 20;
  const externalCompanyId =
    typeof sp.externalCompanyId === "string" ? sp.externalCompanyId : "";

  // Build API query string.
  const apiParams = new URLSearchParams({
    scope,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search) apiParams.set("search", search);
  if (dateRange) apiParams.set("dateRange", dateRange);
  if (externalCompanyId) apiParams.set("externalCompanyId", externalCompanyId);

  // Fetch session identity (/me) and order list in parallel.
  const [meRes, listRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(`/api/v1/orgs/${orgSlug}/orders?${apiParams.toString()}`),
  ]);

  // Auth / tenant guard — redirect to login on 401/403.
  if (meRes.status === 401 || meRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (listRes.status === 401 || listRes.status === 403) {
    redirect(await orgHref(orgSlug, "/login"));
  }
  if (!meRes.ok || !listRes.ok) {
    notFound();
  }

  const me = (await meRes.json()) as {
    externalCompanyId: string | null;
    name: string;
  };

  const { orders, total } = (await listRes.json()) as {
    orders: OrderListItem[];
    total: number;
    page: number;
    pageSize: number;
  };

  // Internal user = externalCompanyId is null (Admin or Company Member).
  // External user = externalCompanyId is non-null (Distributor / Architectural Firm).
  const isInternal = me.externalCompanyId === null;

  // External-company filter list — only shown to internal users.
  // External users are already pinned to their own company (enforced in the DAL).
  let externalCompanies: ExternalCompanyOption[] | null = null;
  if (isInternal) {
    const companiesRes = await internalFetch(
      `/api/v1/orgs/${orgSlug}/external-companies`,
    );
    if (companiesRes.ok) {
      const data = (await companiesRes.json()) as {
        companies: ExternalCompanyOption[];
      };
      externalCompanies = data.companies;
    }
  }

  // Column header label differs by user type.
  const clientColumnHeader = isInternal ? "Company" : "Client Name";

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[27px] font-extrabold text-text-heading">
            Orders
            <span className="rounded-pill bg-primary-softer px-[10px] py-[2px] text-[12.5px] font-bold text-primary-dark">
              {total}
            </span>
          </h1>
          <p className="mt-1 text-[13.5px] text-text-muted">
            Manage your organization&apos;s orders.
          </p>
        </div>
        {/* No "New Order" button — orders come from the quotation pipeline. */}
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <ListPageControls
        entityLabel="Orders"
        searchPlaceholder="Search orders..."
        scope={scope}
        search={search}
        dateRange={dateRange}
        externalCompanies={externalCompanies}
        externalCompanyId={externalCompanyId}
      />

      {/* ── Table card ───────────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        <div className="px-4">
          {orders.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-text-muted">
              {search || dateRange || scope === "mine"
                ? "No orders match your filters."
                : "No orders yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Project Name
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      {clientColumnHeader}
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Location
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Status
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Value
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Created On
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Submission Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-border/60 last:border-0 hover:bg-primary-softer"
                    >
                      {/* Project Name */}
                      <td className="px-3 py-[11px] text-[13px] font-semibold text-text-heading">
                        {order.name}
                      </td>
                      {/* Client Name / Company */}
                      <td className="px-3 py-[11px] text-[13px] text-text-body">
                        {order.externalCompany?.name ?? (
                          <span className="text-text-placeholder">—</span>
                        )}
                      </td>
                      {/* Location */}
                      <td className="px-3 py-[11px] text-[13px] text-text-body">
                        {order.destinationCountry || (
                          <span className="text-text-placeholder">—</span>
                        )}
                      </td>
                      {/* Status */}
                      <td className="px-3 py-[11px] text-[13px] text-text-body">
                        {order.status}
                      </td>
                      {/* Value — no currency model yet */}
                      <td className="px-3 py-[11px] text-[13px] text-text-body">
                        {order.value ?? (
                          <span className="text-text-placeholder">—</span>
                        )}
                      </td>
                      {/* Created On */}
                      <td className="px-3 py-[11px] text-[13px] text-text-muted">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      {/* Submission Date — no submittedAt field in current schema */}
                      <td className="px-3 py-[11px] text-[13px] text-text-placeholder">
                        {order.submittedAt
                          ? new Date(order.submittedAt).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Pagination footer ─────────────────────────────────────── */}
        <ListPagePagination
          totalCount={total}
          page={page}
          pageSize={pageSize}
        />
      </div>
    </div>
  );
}
