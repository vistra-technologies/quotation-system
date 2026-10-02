import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";
import { parseAuditFilters } from "@/lib/superadmin-audit-view";
import type { AuditPage } from "@/lib/data/superadmin/audit-log";
import { AuditFilters, type FilterValues } from "./audit-filters";
import { AuditTable } from "./audit-table";

// Always render live.
export const dynamic = "force-dynamic";

/**
 * SuperAdmin audit log (Server Component) — hotfix 2026-10-02. Read-only; every filter lives in the URL
 * query string and is forwarded verbatim to GET /api/v1/superadmin/audit-log (Stage 12 pattern: the page
 * never touches Prisma). Auth: enforced by app/controls/(authenticated)/layout.tsx.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);

  // A hand-edited bad query string shows a message instead of crashing.
  const parsed = parseAuditFilters(get);
  const qs = new URLSearchParams();
  for (const k of ["scope", "orgId", "by", "verb", "item", "from", "to", "page"]) {
    const v = get(k);
    if (v) qs.set(k, v);
  }

  let data: AuditPage | null = null;
  let error: string | null = null;
  if (!parsed.ok) {
    error = `${parsed.error} — reset the filters to continue.`;
  } else {
    const res = await internalFetch(`/api/v1/superadmin/audit-log?${qs.toString()}`);
    if (res.ok) data = (await res.json()) as AuditPage;
    else error = "Failed to load the audit log — please refresh.";
  }

  // Filters for the bar come from the (valid) URL; facets need a data response, so fall back to empty.
  const f = parsed.ok ? parsed.filters : null;
  const current: FilterValues = {
    scope: f?.scope ?? "all",
    orgId: f?.orgId ?? "",
    by: f?.by ?? "",
    verb: f?.verb ?? "",
    item: f?.item ?? "",
    from: f?.from ?? "",
    to: f?.to ?? "",
  };
  const facets = data?.facets ?? { orgs: [], admins: [], items: [] };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = data?.page ?? 1;
  const pageHref = (p: number) => {
    const next = new URLSearchParams(qs);
    next.set("page", String(p));
    return `/controls/audit-log?${next.toString()}`;
  };
  const from = data && data.total ? (page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(page * data.pageSize, data.total) : 0;

  const btn =
    "rounded-sm border border-border bg-bg-white px-3.5 py-2 text-sm font-bold text-text-body hover:border-[#b9c2ae]";
  const btnOff = "pointer-events-none opacity-45";

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-heading">Audit log</h1>
      <p className="mt-1 text-sm text-text-muted">
        Every change made from this console, newest first. Read-only.
      </p>

      <AuditFilters current={current} facets={facets} />

      {error && (
        <p role="alert" className="mt-6 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3 text-sm text-status-failed-text">
          {error}
        </p>
      )}

      {data && (
        <>
          <div className="mt-5 flex items-center justify-between px-0.5 text-[13px] text-text-muted">
            <span data-testid="audit-count">
              {data.total} {data.total === 1 ? "entry" : "entries"}
            </span>
            <span>Times shown in your local timezone</span>
          </div>

          <div className="mt-2 rounded-md border border-border bg-bg-card shadow-card">
            {data.entries.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-text-muted">
                No audit entries match these filters.
              </p>
            ) : (
              <AuditTable entries={data.entries} />
            )}
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-text-muted">
              <span>{data.total ? `Showing ${from}–${to} of ${data.total}` : ""}</span>
              <div className="flex gap-2">
                <Link href={pageHref(page - 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : 0}
                  className={`${btn} ${page <= 1 ? btnOff : ""}`}>Previous</Link>
                <Link href={pageHref(page + 1)} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : 0}
                  className={`${btn} ${page >= totalPages ? btnOff : ""}`}>Next</Link>
              </div>
            </div>
          </div>

          <p className="mt-2.5 text-xs text-text-muted">
            Click a row for details. Passwords and password hashes are never stored in or shown on this page.
            Entries by a SuperAdmin who has since been deleted keep their name, shown as “name (deleted)”.
          </p>
        </>
      )}
    </div>
  );
}
