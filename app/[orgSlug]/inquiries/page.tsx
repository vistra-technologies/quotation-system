import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { internalFetch } from "@/lib/internal-fetch";
import { orgHref } from "@/lib/orgHref";
import {
  ListPageControls,
  ListPagePagination,
} from "@/components/list-page-controls";

// Always render live — reads session cookie and DB.
export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InquiryListItem {
  id: string;
  inquiryNumber: number;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  destinationCountry: string;
  externalCompany: { id: string; name: string } | null;
  createdBy: { id: string; name: string; username: string };
}

interface ExternalCompanyOption {
  id: string;
  name: string;
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status) {
    case "NEW":
      return (
        <span className="inline-flex items-center rounded-pill bg-status-paid-bg px-2 py-[2px] text-xs font-semibold text-status-paid-text">
          New
        </span>
      );
    case "DISMISSED":
      return (
        <span className="inline-flex items-center rounded-pill bg-status-refunded-bg px-2 py-[2px] text-xs font-semibold text-status-refunded-text">
          Dismissed
        </span>
      );
    case "CONVERTED":
      return (
        <span className="inline-flex items-center rounded-pill bg-status-shipped-bg px-2 py-[2px] text-xs font-semibold text-status-shipped-text">
          Converted
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-pill bg-bg-white px-2 py-[2px] text-xs font-semibold text-text-muted">
          {status}
        </span>
      );
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Inquiries list page (Server Component).
 *
 * Stage 12 Batch 7c: upgraded to the shared list-page pattern —
 * reduced margins, date-range filter, search, My/All toggle with RBAC visibility
 * rules, external-company filter for internal users, pagination, and updated column schema.
 *
 * Column schema: Project Name, Client Name / Company, Location, Status,
 * Created On, Submission Date ("—" — no submittedAt field in current schema).
 *
 * "Client Name" column header shown to external users; "Company" shown to internal
 * users (Admin / Company Member). Discriminator: me.externalCompanyId === null.
 *
 * RBAC visibility enforced in the API route + DAL (scope + externalCompanyId filtering).
 */
export default async function InquiriesPage({
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
  const base = await orgHref(orgSlug, "");

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

  // Fetch session identity (/me) and inquiry list in parallel.
  const [meRes, listRes] = await Promise.all([
    internalFetch(`/api/v1/orgs/${orgSlug}/me`),
    internalFetch(
      `/api/v1/orgs/${orgSlug}/inquiries?${apiParams.toString()}`,
    ),
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

  const { inquiries, total } = (await listRes.json()) as {
    inquiries: InquiryListItem[];
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
            Inquiries
            <span className="rounded-pill bg-primary-softer px-[10px] py-[2px] text-[12.5px] font-bold text-primary-dark">
              {total}
            </span>
          </h1>
          <p className="mt-1 text-[13.5px] text-text-muted">
            Manage your organization&apos;s inquiries.
          </p>
        </div>
        <Link
          href={`${base}/inquiries/new`}
          className="rounded-sm bg-primary px-4 py-[9px] text-[13px] font-semibold text-text-on-primary hover:bg-primary-dark"
        >
          + New Inquiry
        </Link>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <ListPageControls
        entityLabel="Inquiries"
        searchPlaceholder="Search inquiries..."
        scope={scope}
        search={search}
        dateRange={dateRange}
        externalCompanies={externalCompanies}
        externalCompanyId={externalCompanyId}
      />

      {/* ── Table card ───────────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        <div className="px-4">
          {inquiries.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-text-muted">
              {search || dateRange || scope === "mine"
                ? "No inquiries match your filters."
                : "No inquiries yet. Create your first inquiry."}
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
                      Created On
                    </th>
                    <th className="px-3 py-[10px] text-left text-[10px] font-extrabold uppercase tracking-[0.06em] text-text-muted">
                      Submission Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {inquiries.map((inquiry) => (
                  <tr
                    key={inquiry.id}
                    className="border-b border-border/60 last:border-0 hover:bg-primary-softer"
                  >
                    {/* Project Name — links to inquiry detail */}
                    <td className="px-3 py-[11px] text-[13px] font-semibold text-text-heading">
                      <Link
                        href={`${base}/inquiries/${inquiry.id}`}
                        className="hover:underline"
                      >
                        {inquiry.name}
                      </Link>
                    </td>
                    {/* Client Name / Company */}
                    <td className="px-3 py-[11px] text-[13px] text-text-body">
                      {inquiry.externalCompany?.name ?? (
                        <span className="text-text-placeholder">—</span>
                      )}
                    </td>
                    {/* Location (destinationCountry) */}
                    <td className="px-3 py-[11px] text-[13px] text-text-body">
                      {inquiry.destinationCountry || (
                        <span className="text-text-placeholder">—</span>
                      )}
                    </td>
                    {/* Status badge */}
                    <td className="px-3 py-[11px]">
                      {statusBadge(inquiry.status)}
                    </td>
                    {/* Created On */}
                    <td className="px-3 py-[11px] text-[13px] text-text-muted">
                      {new Date(inquiry.createdAt).toLocaleDateString()}
                    </td>
                    {/* Submission Date — no submittedAt field in current schema */}
                    <td className="px-3 py-[11px] text-[13px] text-text-placeholder">
                      —
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
