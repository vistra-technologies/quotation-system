"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingOverlay } from "@/components/loading-overlay";
import { Toast, useToast } from "@/components/toast";
import { TrashIcon } from "@/components/trash-icon";
import {
  DEFAULT_SORT,
  alsoMatchedBy,
  filterItems,
  groupByPart,
  partLabelOf,
  sortItems,
  tabCounts,
} from "@/lib/inventory-list";
import type { ListItem, ListType, SortKey, SortState } from "@/lib/inventory-list";
import { readMatchRows } from "@/lib/inventory-matches";
import { packLabel } from "@/lib/units";
import { deleteInventoryItem } from "./actions";
import { InventoryItemDrawer } from "./_item-drawer";
import type { DrawerTarget } from "./_item-drawer";
import { AlsoMatchedBy } from "./_parts";
import { ACTIVE_BADGE, C, INACTIVE_BADGE, UNASSIGNED_BADGE } from "./_styles";

interface InventoryListProps {
  items: ListItem[];
  types: ListType[];
  orgSlug: string;
  /** Tab selected on first render ("all", "none" or a type id). */
  initialTab?: string;
}

const PLUS = (
  <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" aria-hidden="true">
    <path d="M6 1v10M1 6h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const SEARCH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-text-placeholder)" strokeWidth="1.75" strokeLinecap="round" className="absolute left-[9px] top-1/2 h-3.5 w-3.5 -translate-y-1/2" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.35-4.35" />
  </svg>
);
const BOX = (
  <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-border-strong)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-3.5 block h-10 w-10" aria-hidden="true">
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </svg>
);
const CHEV_R = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);
const SORT_UP = (
  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
    <path d="M6 2 10 8H2z" fill="currentColor" />
  </svg>
);
const SORT_DOWN = (
  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true">
    <path d="M6 10 2 4h8z" fill="currentColor" />
  </svg>
);
const SORT_NONE = (
  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 opacity-40" aria-hidden="true">
    <path d="M6 1 9 5H3zM6 11 3 7h6z" fill="currentColor" />
  </svg>
);

/**
 * The Inventory list (Client Component), mockup A rev 7: header with "New item", component type tabs with
 * counts, search plus Active/Inactive chips, a sortable table (Part groups inside a type tab) and the modal
 * item drawer. Filtering, grouping and sorting are the pure functions of `lib/inventory-list`.
 */
export function InventoryList({ items, types, orgSlug, initialTab = "all" }: InventoryListProps) {
  const t = useTranslations("inventory");
  const [tab, setTab] = useState<string>(initialTab);
  const [q, setQ] = useState("");
  const [chips, setChips] = useState({ active: false, inactive: false });
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const newButtonRef = useRef<HTMLButtonElement>(null);
  // The row that opened the drawer, kept while the drawer switches to other items (focus returns here on close).
  const openerIdRef = useRef<string | null>(null);

  const counts = useMemo(() => tabCounts(items, types), [items, types]);
  const typeById = useMemo(() => new Map(types.map((x) => [x.id, x] as const)), [types]);
  const rows = useMemo(
    () => sortItems(filterItems(items, { tab, q, ...chips }), sort, types),
    [items, tab, q, chips, sort, types],
  );
  const isTypeTab = tab !== "all" && tab !== "none";
  const showComp = tab === "all";

  function onSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  }
  function clearFilters() {
    setQ("");
    setChips({ active: false, inactive: false });
  }
  function onSaved(kind: "created" | "updated") {
    if (kind === "created") {
      setDrawer(null);
      toast.show(t("itemAdded"));
    }
    router.refresh();
  }
  function openDrawer(target: DrawerTarget) {
    openerIdRef.current = target.kind === "item" ? target.id : null;
    setDrawer(target);
  }
  function restoreTarget(): HTMLElement | null {
    const id = openerIdRef.current;
    if (id) {
      const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (row) return row;
    }
    return newButtonRef.current;
  }
  function confirmDelete() {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    formData.set("itemId", deleteTarget.id);
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteInventoryItem(formData);
        setDeleteTarget(null);
      } catch (err) {
        setDeleteError(err instanceof Error && err.message ? err.message : t("deleteFailed"));
      }
    });
  }

  if (items.length === 0) {
    return (
      <>
        <PageHeader onNew={() => openDrawer({ kind: "new" })} buttonRef={newButtonRef} />
        <div className="rounded-sm border border-dashed border-border-strong bg-bg-white px-8 py-[52px] text-center">
          {BOX}
          <p className="mb-3.5 text-[15px] font-extrabold text-text-heading">{t("emptyTitle")}</p>
          <button type="button" onClick={() => openDrawer({ kind: "new" })} className={C.btnP}>
            {PLUS}
            {t("newItem")}
          </button>
        </div>
        {drawer ? (
          <InventoryItemDrawer
            target={drawer}
            items={items}
            types={types}
            orgSlug={orgSlug}
            onSaved={onSaved}
            onClose={() => setDrawer(null)}
            onOpenItem={(id) => setDrawer({ kind: "item", id })}
            getRestoreTarget={restoreTarget}
          />
        ) : null}
        <Toast {...toast} />
      </>
    );
  }

  const tabs: Array<[string, string]> = [["all", t("tabAll")], ...types.map((x): [string, string] => [x.id, x.name]), ["none", t("tabUnassigned")]];
  const ncol = 4 + (showComp ? 2 : 0) + 1;

  // Plain render helpers (not components): a component defined here would remount every row on each render.
  function sortTh(k: SortKey, label: string, extra?: string) {
    const on = sort.key === k;
    return (
      <th key={k} className={`${C.th} ${extra ?? ""}`} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => onSort(k)}
          className={`inline-flex items-center gap-1.5 rounded-sm hover:text-text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${on ? "text-text-heading" : ""}`}
        >
          {label}
          {on ? (sort.dir === 1 ? SORT_UP : SORT_DOWN) : SORT_NONE}
        </button>
      </th>
    );
  }

  function renderRow(it: ListItem) {
    const type = it.componentTypeId ? typeById.get(it.componentTypeId) : undefined;
    const dim = !it.active;
    const tone = dim ? "text-text-muted" : "";
    const selected = drawer?.kind === "item" && drawer.id === it.id;
    const matchRows = readMatchRows(it.attributes);
    const matchText = Object.values(matchRows).join(" · ");
    const partRaw = partLabelOf(it, type);
    const part = partRaw ?? t("partOther");
    const open = () => openDrawer({ kind: "item", id: it.id });
    return (
      <tr
        key={it.id}
        tabIndex={0}
        data-row-id={it.id}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) open();
        }}
        className={`group cursor-pointer hover:[&>td]:bg-bg-hover focus-visible:[&>td]:outline focus-visible:[&>td]:outline-2 focus-visible:[&>td]:-outline-offset-2 focus-visible:[&>td]:outline-primary last:[&>td]:border-b-0 ${selected ? "[&>td]:bg-primary-softer" : ""}`}
      >
        <td className={`${C.td} ${tone} ${selected ? "shadow-[inset_3px_0_0_var(--color-primary)]" : ""} whitespace-nowrap font-mono text-xs ${dim ? "" : "text-text-heading"}`}>
          {it.code}
        </td>
        <td className={`${C.td} ${tone}`}>
          <div className={`line-clamp-2 max-w-[360px] font-semibold ${dim ? "" : "text-text-heading"}`}>{it.name}</div>
          {matchText ? <div className="mt-0.5 font-mono text-[11px] text-text-muted">{matchText}</div> : null}
          <AlsoMatchedBy
            others={alsoMatchedBy(it, matchRows, items)}
            onOpenItem={(id) => openDrawer({ kind: "item", id })}
            inList
          />
        </td>
        {showComp ? (
          <td className={`${C.td} ${tone} whitespace-nowrap`}>
            {type ? type.name : <span className={UNASSIGNED_BADGE}>{t("unassigned")}</span>}
            {type ? <div className="mt-0.5 text-[11.5px] text-text-muted min-[1440px]:hidden">{part}</div> : null}
          </td>
        ) : null}
        {showComp ? (
          <td className={`${C.td} ${tone} hidden whitespace-nowrap min-[1440px]:table-cell ${type && !partRaw ? "text-text-muted" : ""}`}>
            {type ? part : ""}
          </td>
        ) : null}
        <td className={`${C.td} ${tone} whitespace-nowrap tabular-nums`}>{packLabel(it.measurementUnit, it.perUnitQuantity)}</td>
        <td className={C.td}>
          <span className={it.active ? ACTIVE_BADGE : INACTIVE_BADGE}>{it.active ? t("statusActive") : t("statusInactive")}</span>
        </td>
        <td className={`${C.td} px-3 text-right`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteError(null);
              setDeleteTarget(it);
            }}
            aria-label={t("deleteItem", { code: it.code })}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-sm border border-border text-red-600 opacity-60 hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <TrashIcon />
          </button>
        </td>
      </tr>
    );
  }

  const groups = isTypeTab ? groupByPart(rows, typeById.get(tab)) : [];

  return (
    <>
      <LoadingOverlay visible={isPending} />
      <PageHeader onNew={() => openDrawer({ kind: "new" })} buttonRef={newButtonRef} />

      <div role="tablist" aria-label={t("tabsLabel")} className="mb-3.5 flex overflow-x-auto border-b border-border">
        {tabs.map(([id, label]) => {
          const on = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(id)}
              className={`-mb-px whitespace-nowrap border-b-[3px] px-[18px] py-[9px] text-[13px] font-bold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${on ? "border-primary text-primary-dark" : "border-transparent text-text-muted hover:text-text-body"}`}
            >
              {label}
              <span className="ml-1.5 text-[11.5px] font-normal text-text-muted">{counts[id] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-[260px]">
          {SEARCH}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
            className="h-8 w-full rounded-full border border-border bg-bg-white pl-[30px] pr-3 text-[13px] text-text-body placeholder:text-text-muted focus:border-primary focus:outline-none focus:shadow-[0_0_0_2px_rgba(78,127,88,.15)]"
          />
        </div>
        {(["active", "inactive"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={chips[k]}
            onClick={() => setChips((c) => ({ ...c, [k]: !c[k] }))}
            className={`${C.chip} ${chips[k] ? C.chipOn : C.chipOff}`}
          >
            {k === "active" ? t("chipActive") : t("chipInactive")}
          </button>
        ))}
        <span className="ml-auto whitespace-nowrap text-xs text-text-muted">{t("itemCount", { count: rows.length })}</span>
      </div>

      <div className="overflow-hidden rounded-sm border border-border bg-bg-white">
        <table className="w-full border-collapse">
          <thead className="bg-bg-subtle">
            <tr>
              {sortTh("code", t("colCode"))}
              {sortTh("name", t("colName"), "min-w-[180px]")}
              {showComp ? sortTh("comp", t("colComponent")) : null}
              {showComp ? sortTh("part", t("colPart"), "hidden min-[1440px]:table-cell") : null}
              {sortTh("pack", t("colPack"))}
              {sortTh("status", t("colStatus"))}
              <th className={`${C.th} w-[52px]`}>
                <span className="sr-only">{t("colActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={ncol} className="px-3.5 py-10 text-center">
                  <p className="text-[13px] font-bold text-text-heading">{t("noResults")}</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-2 inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-bold text-primary-dark hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {t("clearFilters")}
                  </button>
                </td>
              </tr>
            ) : isTypeTab ? (
              groups.map((g) => {
                const gk = `${tab}:${g.key ?? ""}`;
                const closed = !!closedGroups[gk];
                const label = g.label ?? t("partOther");
                return (
                  <GroupRows
                    key={gk}
                    colSpan={ncol}
                    label={label}
                    count={g.items.length}
                    closed={closed}
                    onToggle={() => setClosedGroups((c) => ({ ...c, [gk]: !c[gk] }))}
                    toggleLabel={closed ? t("expandGroup", { part: label }) : t("collapseGroup", { part: label })}
                  >
                    {g.items.map(renderRow)}
                  </GroupRows>
                );
              })
            ) : (
              rows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      {drawer ? (
        <InventoryItemDrawer
          target={drawer}
          items={items}
          types={types}
          orgSlug={orgSlug}
          onSaved={onSaved}
          onClose={() => setDrawer(null)}
          onOpenItem={(id) => setDrawer({ kind: "item", id })}
          getRestoreTarget={restoreTarget}
        />
      ) : null}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t("deleteTitle", { code: deleteTarget?.code ?? "" })}
        message={t("deleteMessage", { code: deleteTarget?.code ?? "", name: deleteTarget?.name ?? "" })}
        confirmLabel={t("deleteConfirm")}
        cancelLabel={t("cancel")}
        errorMessage={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <Toast {...toast} />
    </>
  );
}

function PageHeader({ onNew, buttonRef }: { onNew: () => void; buttonRef: React.RefObject<HTMLButtonElement | null> }) {
  const t = useTranslations("inventory");
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">{t("pageTitle")}</h1>
      <button ref={buttonRef} type="button" onClick={onNew} className={C.btnP}>
        {PLUS}
        {t("newItem")}
      </button>
    </div>
  );
}

function GroupRows({
  colSpan,
  label,
  count,
  closed,
  onToggle,
  toggleLabel,
  children,
}: {
  colSpan: number;
  label: string;
  count: number;
  closed: boolean;
  onToggle: () => void;
  toggleLabel: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={colSpan} className="border-b border-border bg-bg-card p-0 text-left">
          <button
            type="button"
            aria-expanded={!closed}
            aria-label={toggleLabel}
            onClick={onToggle}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          >
            <span className={`text-text-muted transition-transform ${closed ? "" : "rotate-90"}`}>{CHEV_R}</span>
            <span className="text-[13px] font-extrabold text-text-heading">{label}</span>
            <span className="rounded-full bg-border px-2 py-px text-[11px] font-bold text-text-muted">{count}</span>
          </button>
        </th>
      </tr>
      {closed ? null : children}
    </>
  );
}
