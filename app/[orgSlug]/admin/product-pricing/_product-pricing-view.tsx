"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Toast, useToast } from "@/components/toast";
import { apiErrorMessage } from "@/lib/api-error-message";
import { useOrgHref } from "@/lib/useOrgHref";
import { buildPricingGrid, isPriced, type GridRow, type PricingGrid, type StoredPricingRow } from "@/lib/product-pricing/grid";
import type { SpecField } from "@/lib/product-pricing/spec-fields";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { CURRENCY_CHIP, formatAmount, PricingDrawer, unitLabel, type DrawerTarget } from "./_pricing-drawer";

/** One active component type, trimmed by the page (spec fields only). */
export interface PricingType {
  id: string;
  code: string;
  name: string;
  isArea: boolean;
  fields: SpecField[];
  options: FieldOptionsConfig;
}

interface Props {
  orgSlug: string;
  types: PricingType[];
  initialRows: StoredPricingRow[];
  loadError: boolean;
}

const PAGE_SIZE = 25;

const CHIP_CLS =
  "flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-bold hover:border-border-strong hover:bg-bg-hover";
const TH_CLS = "whitespace-nowrap border-b border-border px-3.5 py-2.5 text-left text-[11.5px] font-extrabold tracking-[.03em] text-text-muted";

function PriceChips({ row, dim }: { row: StoredPricingRow; dim?: boolean }) {
  return (
    <div className={`leading-[1.8] ${dim ? "opacity-70" : ""}`}>
      {row.prices.map((p) => (
        <span
          key={`${p.currency}-${p.unit}`}
          className={`mb-0.5 mr-1 inline-flex h-[22px] items-center whitespace-nowrap rounded-full px-2 text-[11.5px] font-bold ${CURRENCY_CHIP[p.currency]}`}
        >
          {p.currency}/{unitLabel(p.unit)} {formatAmount(p.amount)}
        </span>
      ))}
    </div>
  );
}

export function ProductPricingView({ orgSlug, types, initialRows, loadError }: Props) {
  const t = useTranslations("productPricing");
  const href = useOrgHref(orgSlug);
  const toast = useToast();
  const router = useRouter();

  const [rows, setRows] = useState(initialRows);
  const [activeId, setActiveId] = useState(types[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [orphanedOnly, setOrphanedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  const grids = useMemo(() => {
    const out: Record<string, PricingGrid> = {};
    for (const type of types) {
      out[type.id] = buildPricingGrid(type.fields, type.options, rows.filter((r) => r.componentTypeId === type.id));
    }
    return out;
  }, [types, rows]);

  const type = types.find((x) => x.id === activeId) ?? types[0];
  const grid = type ? grids[type.id] : undefined;

  function selectType(id: string) {
    setActiveId(id);
    setDrawer(null);
    setPage(0);
    setSearch("");
    setUnpricedOnly(false);
    setOrphanedOnly(false);
  }

  function applySaved(typeId: string, key: string, row: StoredPricingRow | null) {
    setRows((prev) => {
      const rest = prev.filter((r) => !(r.componentTypeId === typeId && r.combinationKey === key));
      return row ? [...rest, row] : rest;
    });
    // M-1: Quick Estimate's price lookup is built once in the org layout (server) and the layout persists across
    // client navigation, so re-run it now; without this the popup keeps the pre-save prices until a hard reload.
    router.refresh();
  }

  async function removeOrphan(g: GridRow) {
    if (!g.row || !type) return;
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/product-pricing/${g.row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        toast.show(apiErrorMessage(body, t("removeFailed")), "error");
        return;
      }
      applySaved(type.id, g.key, null);
      toast.show(t("combinationRemoved"));
    } catch {
      toast.show(t("removeFailed"), "error");
    }
  }

  function openDrawer(g: GridRow) {
    if (!type) return;
    setDrawer({ typeId: type.id, isArea: type.isArea, key: g.key, label: g.label, row: g.row });
  }

  // ─── Error / empty states ───────────────────────────────────────────────────

  if (loadError) {
    return (
      <div role="alert" className="rounded-sm border border-danger-border bg-danger-bg px-3.5 py-3 text-[13px] font-semibold text-red-700">
        {t("loadError")}
      </div>
    );
  }

  if (!type || !grid || type.fields.length === 0) {
    return (
      <>
        {types.length > 1 && <TypeTabs types={types} grids={grids} activeId={type?.id ?? ""} onSelect={selectType} />}
        <div className="rounded-sm border border-dashed border-border-strong bg-bg-white px-8 py-[52px] text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-border-strong)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3.5 block h-10 w-10" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <p className="mx-auto mb-3.5 max-w-[360px] text-[13px] leading-normal text-text-muted">{t("emptyBody")}</p>
          <Link
            href={href("/admin/catalog")}
            className="inline-flex h-[34px] items-center rounded-sm border border-primary bg-primary px-3.5 text-[13px] font-bold text-white hover:border-primary-dark hover:bg-primary-dark"
          >
            {t("goToCatalog")}
          </Link>
        </div>
      </>
    );
  }

  // ─── Filtering and paging ───────────────────────────────────────────────────

  const q = search.trim().toLowerCase();
  const source = orphanedOnly ? grid.orphans : grid.rows;
  const filtered = source.filter((g) => {
    if (unpricedOnly && isPriced(g.row)) return false;
    return q === "" || g.label.toLowerCase().includes(q);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const showActions = orphanedOnly;

  return (
    <>
      {grid.orphans.length > 0 && (
        <div className="mb-3 flex items-start gap-2.5 rounded-sm border border-status-pending-border bg-status-pending-bg px-3.5 py-[11px] text-[13px] leading-[1.45] text-status-pending-text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="mt-px h-4 w-4 shrink-0" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <strong className="font-extrabold">{t("orphanBanner", { count: grid.orphans.length })}</strong>
        </div>
      )}
      {grid.capped && (
        <div className="mb-3 rounded-sm border border-primary-soft bg-primary-softer px-3.5 py-[11px] text-[13px] text-primary-dark">
          {t("tooMany")}
        </div>
      )}

      <TypeTabs types={types} grids={grids} activeId={type.id} onSelect={selectType} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative max-w-[260px] flex-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-placeholder)" strokeWidth="1.75" strokeLinecap="round" className="absolute left-[9px] top-1/2 h-3.5 w-3.5 -translate-y-1/2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-8 w-full rounded-full border border-border bg-bg-white pl-[30px] pr-3 text-[13px] text-text-body focus:border-primary focus:outline-none"
          />
        </div>
        <button
          type="button"
          aria-pressed={unpricedOnly}
          onClick={() => {
            setUnpricedOnly(!unpricedOnly);
            setOrphanedOnly(false);
            setPage(0);
          }}
          className={`${CHIP_CLS} ${unpricedOnly ? "border-primary-soft bg-primary-softer text-primary-dark" : "border-border bg-bg-white text-text-muted"}`}
        >
          {t("unpricedOnly")}
        </button>
        <button
          type="button"
          aria-pressed={orphanedOnly}
          onClick={() => {
            setOrphanedOnly(!orphanedOnly);
            setUnpricedOnly(false);
            setPage(0);
          }}
          className={`${CHIP_CLS} ${orphanedOnly ? "border-primary-soft bg-primary-softer text-primary-dark" : "border-border bg-bg-white text-text-muted"}`}
        >
          {t("showOrphaned")}
        </button>
        <span className="ml-auto whitespace-nowrap text-xs text-text-muted">
          {t("combinationCount", { count: orphanedOnly ? grid.orphans.length : grid.total })}
        </span>
      </div>

      <div className="overflow-hidden rounded-sm border border-border bg-bg-white">
        <table className="w-full border-collapse">
          <thead className="bg-bg-subtle">
            <tr>
              {type.fields.map((f) => (
                <th key={f.key} className={TH_CLS}>
                  {f.label}
                </th>
              ))}
              <th className={TH_CLS}>{t("colPrices")}</th>
              <th className={TH_CLS}>{t("colDescription")}</th>
              {showActions && <th className={`${TH_CLS} w-[72px]`} />}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={type.fields.length + 2 + (showActions ? 1 : 0)} className="px-3.5 py-8 text-center text-[13px] text-text-muted">
                  {t("noMatches")}
                </td>
              </tr>
            )}
            {visible.map((g) => {
              const orphaned = orphanedOnly;
              const priced = isPriced(g.row);
              const active = drawer?.typeId === type.id && drawer.key === g.key;
              const tdBase = "border-b border-border px-3.5 py-[11px] align-middle text-[13px]";
              const tone = orphaned
                ? "bg-status-pending-bg text-status-pending-text group-hover:bg-[#f3dfa0]"
                : active
                  ? "bg-primary-softer text-text-body"
                  : `${priced ? "text-text-body" : "text-text-muted"} group-hover:bg-bg-hover`;
              return (
                <tr
                  key={g.key}
                  tabIndex={0}
                  data-testid="pricing-row"
                  data-orphaned={orphaned ? "true" : undefined}
                  onClick={() => openDrawer(g)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) openDrawer(g);
                  }}
                  className="group cursor-pointer last:[&>td]:border-b-0 focus-visible:[&>td]:outline focus-visible:[&>td]:outline-2 focus-visible:[&>td]:-outline-offset-2 focus-visible:[&>td]:outline-primary"
                >
                  {type.fields.map((f, i) => {
                    const first = i === 0;
                    return (
                      <td
                        key={f.key}
                        className={`${tdBase} ${tone} ${first ? "font-bold" : ""} ${active && first ? "shadow-[inset_3px_0_0_var(--color-primary)]" : ""}`}
                      >
                        {orphaned && first ? (
                          <>
                            <span className="inline-flex items-center rounded-full border border-status-pending-border bg-status-pending-bg px-2 py-px text-[10.5px] font-extrabold">
                              {t("orphanedBadge")}
                            </span>
                            <div className="mt-[3px] text-xs font-bold">{g.label}</div>
                            <div className="mt-0.5 text-[11px]">{t("orphanNote")}</div>
                          </>
                        ) : (
                          (g.values[f.key] ?? "")
                        )}
                      </td>
                    );
                  })}
                  <td className={`${tdBase} ${tone}`}>
                    {g.row && priced ? (
                      <PriceChips row={g.row} dim={orphaned} />
                    ) : (
                      <span className="text-[12.5px] italic text-text-placeholder">{t("noPrices")}</span>
                    )}
                  </td>
                  <td className={`${tdBase} ${tone} max-w-[220px]`}>
                    {g.row?.description ? (
                      <div className="truncate text-[12.5px]" title={g.row.description}>
                        {g.row.description}
                      </div>
                    ) : (
                      <span className="text-[12.5px] italic text-text-placeholder">{t("none")}</span>
                    )}
                  </td>
                  {showActions && (
                    <td className={`${tdBase} ${tone}`}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeOrphan(g);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="h-7 rounded-sm border border-status-pending-border bg-bg-white px-2.5 text-xs font-bold text-status-pending-text hover:bg-bg-hover"
                      >
                        {t("remove")}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-border bg-bg-subtle px-3.5 py-2.5">
          <span className="text-xs text-text-muted">{t("showing", { shown: visible.length, total: filtered.length })}</span>
          {pageCount > 1 && (
            <div className="flex gap-1">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                aria-label={t("pagePrev")}
                className="flex h-7 min-w-7 items-center justify-center rounded-sm border border-border bg-bg-white px-2 text-xs font-bold text-text-body hover:bg-bg-hover disabled:opacity-40"
              >
                ‹
              </button>
              {Array.from({ length: pageCount }, (_, i) => i)
                .filter((i) => i === 0 || i === pageCount - 1 || Math.abs(i - current) <= 2)
                .map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPage(i)}
                    aria-current={i === current ? "page" : undefined}
                    className={`flex h-7 min-w-7 items-center justify-center rounded-sm border px-2 text-xs font-bold ${
                      i === current ? "border-primary bg-primary text-white" : "border-border bg-bg-white text-text-body hover:bg-bg-hover"
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              <button
                type="button"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
                aria-label={t("pageNext")}
                className="flex h-7 min-w-7 items-center justify-center rounded-sm border border-border bg-bg-white px-2 text-xs font-bold text-text-body hover:bg-bg-hover disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {drawer && (
        <PricingDrawer
          key={`${drawer.typeId}:${drawer.key}`}
          orgSlug={orgSlug}
          target={drawer}
          onClose={() => setDrawer(null)}
          onSaved={(row) => {
            const saved = drawer;
            applySaved(saved.typeId, saved.key, row);
            // Close only if the drawer still shows the row that was saved (the user may have opened another).
            setDrawer((cur) => (cur && cur.typeId === saved.typeId && cur.key === saved.key ? null : cur));
            toast.show(t("saved"));
          }}
        />
      )}
      <Toast {...toast} />
    </>
  );
}

function TypeTabs({
  types,
  grids,
  activeId,
  onSelect,
}: {
  types: PricingType[];
  grids: Record<string, PricingGrid>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("productPricing");
  return (
    <div role="tablist" className="mb-3.5 flex border-b border-border">
      {types.map((x) => {
        const g = grids[x.id];
        const active = x.id === activeId;
        return (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`type-tab-${x.code}`}
            onClick={() => onSelect(x.id)}
            className={`-mb-px border-b-[3px] px-[18px] py-[9px] text-[13px] font-bold ${
              active ? "border-primary text-primary-dark" : "border-transparent text-text-muted hover:text-text-body"
            }`}
          >
            {x.name}
            {x.fields.length > 0 && g && (
              <span className={`ml-1.5 text-[11.5px] font-normal ${active ? "text-text-muted" : "text-text-placeholder"}`}>
                {t("tabCount", { priced: g.pricedCount, total: g.total })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
