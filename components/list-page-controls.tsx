"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CompanyDropdown } from "@/components/company-dropdown";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExternalCompanyOption {
  id: string;
  name: string;
}

interface ListPageControlsProps {
  /**
   * Entity label used in toggle labels, e.g. "Inquiries" → "My Inquiries / All Inquiries".
   * Projects/Orders pass their own label here.
   */
  entityLabel: string;
  /** Placeholder text for the search input, e.g. "Search inquiries..." */
  searchPlaceholder: string;
  /** Active scope toggle value. */
  scope: "mine" | "all";
  /** Active search string (may be empty). */
  search: string;
  /** Active date-range preset key (empty string = "All dates"). */
  dateRange: string;
  /**
   * Active external-company filter value — empty string means "All companies".
   * Only meaningful when scope="all" and externalCompanies is non-null.
   */
  externalCompanyId: string;
  /**
   * External companies for the filter dropdown, scoped to the current org.
   * null = external user — the filter is not rendered (they already see only
   * their own company's records via RBAC and have no need to filter further).
   * For internal users (Admin / Company Member), pass the org's company list
   * from GET /api/v1/orgs/[orgSlug]/external-companies.
   */
  externalCompanies: ExternalCompanyOption[] | null;
}

// ─── Date range options ───────────────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last30", label: "Last 30 days" },
];

// ─── ListPageControls (toolbar) ───────────────────────────────────────────────

/**
 * Shared list-page toolbar (Client Component).
 *
 * Handles: date-range filter, search input (debounced), optional external-company
 * filter (internal users + All scope only), and My/All scope toggle.
 *
 * All state lives in URL search params — each interaction calls router.push() so
 * the Server Component page re-fetches with new filters. Filter changes reset
 * page to 1 to avoid stale pagination.
 *
 * Reuse by Projects/Orders batches: pass entityLabel, searchPlaceholder, and
 * the server-resolved current param values. Column definitions stay in the
 * parent page — this component owns the toolbar only.
 *
 * Stage 12 Batch 7c — establishes the shared pattern for Batches 7d/7e.
 */
export function ListPageControls({
  entityLabel,
  searchPlaceholder,
  scope,
  search,
  dateRange,
  externalCompanyId,
  externalCompanies,
}: ListPageControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Local state for the search input — gives immediate responsiveness while
  // debouncing the URL update.  Initializes from the server-side `search` prop.
  // No useEffect sync needed: this component only changes `search` via user
  // typing, and all other navigations (pagination, scope) preserve the search
  // URL param, keeping local and URL state aligned.
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Date dropdown open state
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);

  // Close date dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
        setDateOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Core URL-param navigation helper.
  // Resets page to 1 unless the override explicitly sets a page.
  const navigate = useCallback(
    (overrides: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      // Reset page on filter changes (unless the override includes page).
      if (!("page" in overrides)) next.set("page", "1");
      for (const [k, v] of Object.entries(overrides)) {
        if (v === "") {
          next.delete(k);
        } else {
          next.set(k, v);
        }
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const handleScopeChange = (s: "mine" | "all") => navigate({ scope: s });

  const handleDateRange = (v: string) => {
    setDateOpen(false);
    navigate({ dateRange: v });
  };

  const handleSearchChange = (v: string) => {
    setLocalSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      navigate({ search: v });
    }, 350);
  };

  const handleCompanyChange = (id: string) =>
    navigate({ externalCompanyId: id });

  const currentDateLabel =
    DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label ?? "All dates";

  // Company filter only appears for internal users (externalCompanies != null) when viewing All scope.
  const showCompanyFilter = externalCompanies !== null && scope === "all";

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      {/* ── Left: Date range filter ─────────────────────────────────── */}
      <div ref={dateRef} className="relative">
        <button
          type="button"
          onClick={() => setDateOpen((o) => !o)}
          className="flex items-center gap-2 rounded-sm border border-border bg-bg-white px-3 py-2 text-[13px] font-semibold text-text-body hover:bg-primary-softer"
          aria-haspopup="listbox"
          aria-expanded={dateOpen}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{currentDateLabel}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={dateOpen ? "rotate-180 transition-transform" : "transition-transform"}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {dateOpen && (
          <div
            className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[160px] rounded-md border border-border bg-bg-white p-[7px] shadow-[0_16px_34px_-12px_rgba(27,40,30,0.28)]"
            role="listbox"
            aria-label="Date range"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={dateRange === opt.value}
                onClick={() => handleDateRange(opt.value)}
                className={[
                  "block w-full rounded-[7px] px-[9px] py-[7px] text-left text-[12.5px] font-semibold",
                  dateRange === opt.value
                    ? "bg-primary text-text-on-primary"
                    : "text-text-body hover:bg-primary-softer hover:text-text-heading",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: search + company filter + my/all toggle ────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="text"
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-[230px] rounded-sm border border-border bg-bg-white px-3 py-2 text-[13px] text-text-body placeholder:text-text-placeholder focus:outline-none focus:ring-1 focus:ring-primary"
          aria-label="Search"
        />

        {/* External-company filter — internal users + "All" scope only.
            Narrows the list to inquiries associated with a specific client
            company, within this org. Never navigates cross-org. */}
        {showCompanyFilter && externalCompanies && (
          <CompanyDropdown
            options={externalCompanies}
            value={externalCompanyId}
            onChange={handleCompanyChange}
            noneLabel="All companies"
            ariaLabel="Filter by company"
          />
        )}

        {/* My / All segmented toggle */}
        <div
          className="flex overflow-hidden rounded-sm border border-border bg-bg-white text-[13px] font-semibold"
          role="group"
          aria-label={`${entityLabel} scope`}
        >
          <button
            type="button"
            onClick={() => handleScopeChange("mine")}
            className={[
              "px-3 py-[6px] transition-colors",
              scope === "mine"
                ? "bg-primary text-text-on-primary"
                : "text-text-body hover:bg-primary-softer hover:text-text-heading",
            ].join(" ")}
            aria-pressed={scope === "mine"}
          >
            My {entityLabel}
          </button>
          <button
            type="button"
            onClick={() => handleScopeChange("all")}
            className={[
              "px-3 py-[6px] transition-colors",
              scope === "all"
                ? "bg-primary text-text-on-primary"
                : "text-text-body hover:bg-primary-softer hover:text-text-heading",
            ].join(" ")}
            aria-pressed={scope === "all"}
          >
            All {entityLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ListPagePagination (below table) ────────────────────────────────────────

interface ListPagePaginationProps {
  totalCount: number;
  page: number;
  pageSize: number;
  entityLabel: string;
}

/**
 * Pagination footer — rendered below the table in the parent page.
 *
 * Self-contained: uses its own useRouter/useSearchParams hooks so it can navigate
 * independently from ListPageControls. Keeps all other URL params intact when
 * changing pages.
 *
 * Stage 12 Batch 7c — shared pattern for Batches 7d/7e.
 */
export function ListPagePagination({
  totalCount,
  page,
  pageSize,
  entityLabel,
}: ListPagePaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startRecord = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, totalCount);

  const goToPage = useCallback(
    (p: number) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("page", String(p));
      router.push(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Build a compact page-number list: always include first, last, and current ±1.
  const pageNumbers: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    const around = new Set(
      [1, page - 1, page, page + 1, totalPages].filter(
        (n) => n >= 1 && n <= totalPages,
      ),
    );
    let prev = 0;
    for (const n of [...around].sort((a, b) => a - b)) {
      if (prev && n - prev > 1) pageNumbers.push("…");
      pageNumbers.push(n);
      prev = n;
    }
  }

  return (
    <div className="flex items-center justify-between px-3 pt-3">
      <span className="text-[12.5px] text-text-muted">
        {totalCount > 0
          ? `${startRecord}–${endRecord} of ${totalCount} ${entityLabel.toLowerCase()} · Page ${page} of ${totalPages}`
          : ""}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-[13px] text-text-muted hover:bg-primary-softer disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous page"
          >
            ‹
          </button>
          {pageNumbers.map((n, i) =>
            n === "…" ? (
              <span
                key={`ellipsis-${i}`}
                className="flex h-7 w-7 items-center justify-center text-[12px] text-text-muted"
              >
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => goToPage(n as number)}
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-sm border text-[13px] font-semibold",
                  n === page
                    ? "border-primary bg-primary text-text-on-primary"
                    : "border-border text-text-body hover:bg-primary-softer",
                ].join(" ")}
                aria-label={`Page ${n}`}
                aria-current={n === page ? "page" : undefined}
              >
                {n}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={page >= totalPages}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-[13px] text-text-muted hover:bg-primary-softer disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
