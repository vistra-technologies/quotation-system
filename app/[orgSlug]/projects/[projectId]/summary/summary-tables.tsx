"use client";

import { useState } from "react";
import type { Summary, MaterialListLine } from "@/lib/summary/types";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import {
  rebuildDoorKpis,
  buildMaterialSections,
  formatGlassLabel,
  formatThickness,
  formatAreaM2,
  formatUnit,
  orDash,
} from "@/lib/summary/view";

interface SummaryTablesProps {
  summary: Summary;
  materialList: MaterialListLine[];
  configSnapshot: ConfigSnapshot | null;
}

// ─── Generic sortable "ledger" section ─────────────────────────────────────────
// One <tbody> per section: a header row of column labels (some clickable to
// sort), the data rows, and an optional Total row. Mirrors the finalized
// mockup's TABLES/sortSection/renderTable JS, rebuilt as React state.

type SortDir = "asc" | "desc";
interface SortState {
  key: string | null;
  dir: SortDir;
}

interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  /** Present only on sortable columns. */
  getValue?: (row: T) => string | number;
  render: (row: T) => React.ReactNode;
}

function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState): T[] {
  if (!sort.key) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.getValue) return rows;
  const getValue = col.getValue;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    if (typeof va === "string" || typeof vb === "string") {
      return factor * String(va).localeCompare(String(vb));
    }
    return factor * ((va as number) - (vb as number));
  });
}

function nextSort<T>(current: SortState, col: Column<T>): SortState {
  if (current.key === col.key) {
    return { key: col.key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: col.key, dir: "asc" };
}

const alignCls: Record<NonNullable<Column<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function LedgerSection<T>({
  columns,
  rows,
  sort,
  onSortChange,
  totalCell,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  sort: SortState;
  onSortChange: (next: SortState) => void;
  /** When present, renders a Total row spanning all but the last column, with this in the last cell. */
  totalCell?: React.ReactNode;
  rowKey: (row: T, index: number) => string;
}) {
  const sorted = sortRows(rows, columns, sort);
  return (
    <tbody>
      <tr>
        {columns.map((col) => {
          const isIndex = col.key === "#";
          const active = sort.key === col.key;
          return (
            <th
              key={col.key}
              className={`whitespace-nowrap border border-border bg-primary-softer px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-heading ${
                alignCls[col.align ?? (isIndex ? "center" : "left")]
              }`}
            >
              {col.getValue ? (
                <button
                  type="button"
                  onClick={() => onSortChange(nextSort(sort, col))}
                  className={`inline-flex items-center gap-1 normal-case tracking-normal ${
                    active ? "text-primary-dark" : ""
                  }`}
                >
                  {col.label}
                  <svg
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className={`h-[9px] w-[9px] transition-transform ${
                      active ? "opacity-80" : "opacity-25"
                    } ${active && sort.dir === "asc" ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </button>
              ) : (
                col.label
              )}
            </th>
          );
        })}
      </tr>
      {sorted.map((row, i) => (
        <tr key={rowKey(row, i)} className="hover:bg-bg-page">
          {columns.map((col, ci) => (
            <td
              key={col.key}
              className={`border border-border bg-bg-white px-2.5 py-1.5 text-text-body ${
                alignCls[col.align ?? (ci === 0 ? "center" : "left")]
              }`}
            >
              {ci === 0 ? i + 1 : col.render(row)}
            </td>
          ))}
        </tr>
      ))}
      {totalCell !== undefined && (
        <tr>
          <td
            colSpan={columns.length - 1}
            className="border border-border bg-bg-card px-2.5 py-1.5 font-extrabold text-text-heading"
          >
            Total
          </td>
          <td className="border border-border bg-bg-card px-2.5 py-1.5 text-right font-extrabold text-text-heading">
            {totalCell}
          </td>
        </tr>
      )}
    </tbody>
  );
}

// ─── Formatting ────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
}

function withUnit(value: number, unit: string): string {
  return `${fmtNum(value)} ${formatUnit(unit, value)}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SummaryTables({ summary, materialList, configSnapshot }: SummaryTablesProps) {
  const glassRows = summary.kpis.sqmByGlassType;
  const doorRows = rebuildDoorKpis(summary);
  const materialSections = buildMaterialSections(
    materialList,
    configSnapshot ?? { takenAt: "", componentTypes: [] },
  );

  const [glassSort, setGlassSort] = useState<SortState>({ key: "areaM2", dir: "desc" });
  const [doorSort, setDoorSort] = useState<SortState>({ key: "quantity", dir: "desc" });
  const [matSorts, setMatSorts] = useState<SortState[]>(
    materialSections.map(() => ({ key: null, dir: "asc" })),
  );

  function setMatSort(index: number, next: SortState) {
    setMatSorts((prev) => prev.map((s, i) => (i === index ? next : s)));
  }

  type GlassRowT = Summary["kpis"]["sqmByGlassType"][number];
  const glassColumns: Column<GlassRowT>[] = [
    { key: "#", label: "#", render: () => null },
    {
      key: "glassType",
      label: "Glass Type",
      getValue: (r) => r.glassType ?? "",
      render: (r) => formatGlassLabel(r.glassType),
    },
    {
      key: "thickness",
      label: "Thickness",
      align: "center",
      getValue: (r) => r.thickness ?? "",
      render: (r) => formatThickness(r.thickness),
    },
    {
      key: "areaM2",
      label: "Area",
      align: "right",
      getValue: (r) => r.areaM2,
      render: (r) => `${formatAreaM2(r.areaM2)} m²`,
    },
  ];

  type DoorRowT = ReturnType<typeof rebuildDoorKpis>[number];
  const doorColumns: Column<DoorRowT>[] = [
    { key: "#", label: "#", render: () => null },
    {
      key: "doorType",
      label: "Door Type",
      getValue: (r) => r.doorType ?? "",
      render: (r) => orDash(r.doorType),
    },
    {
      key: "category",
      label: "Category",
      align: "center",
      getValue: (r) => r.category ?? "",
      render: (r) => orDash(r.category),
    },
    {
      key: "quantity",
      label: "Qty",
      align: "right",
      getValue: (r) => r.quantity,
      render: (r) => `${r.quantity} ${r.quantity === 1 ? "pc" : "pcs"}`,
    },
  ];

  const glassTotal = `${formatAreaM2(summary.kpis.totalPartitionSqm)} m²`;
  const doorTotal = `${doorRows.reduce((s, r) => s + r.quantity, 0)} pcs`;

  function materialColumns(title: string): Column<MaterialListLine>[] {
    return [
      { key: "#", label: "#", render: () => null },
      { key: "code", label: "Code", getValue: (r) => r.code, render: (r) => r.code },
      { key: "name", label: title, getValue: (r) => r.name, render: (r) => r.name },
      {
        key: "requirement",
        label: "Requirement",
        align: "right",
        getValue: (r) => r.requirement,
        render: (r) => withUnit(r.requirement, r.unit),
      },
      {
        key: "perUnitQuantity",
        label: "Per Unit Qty",
        align: "right",
        getValue: (r) => r.perUnitQuantity,
        render: (r) => withUnit(r.perUnitQuantity, r.unit),
      },
      {
        key: "quantity",
        label: "Item Qty",
        align: "center",
        getValue: (r) => r.quantity,
        render: (r) => fmtNum(r.quantity),
      },
    ];
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 min-[1180px]:grid-cols-[minmax(340px,5fr)_minmax(0,8fr)]">
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-text-heading">
          <span className="h-4 w-1 rounded-sm bg-primary" aria-hidden="true" />
          Project KPIs
        </div>
        <div className="overflow-x-auto rounded-sm border border-border bg-bg-white">
          <table className="w-full border-collapse text-[12.5px] [font-variant-numeric:tabular-nums]">
            <LedgerSection
              columns={glassColumns}
              rows={glassRows}
              sort={glassSort}
              onSortChange={setGlassSort}
              totalCell={glassTotal}
              rowKey={(r, i) => `${r.glassType ?? "null"}-${r.thickness ?? "null"}-${i}`}
            />
            <LedgerSection
              columns={doorColumns}
              rows={doorRows}
              sort={doorSort}
              onSortChange={setDoorSort}
              totalCell={doorRows.length ? doorTotal : undefined}
              rowKey={(r, i) => `${r.doorType ?? "null"}-${r.category ?? "null"}-${i}`}
            />
          </table>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2 text-[15px] font-extrabold text-text-heading">
          <span className="h-4 w-1 rounded-sm bg-primary" aria-hidden="true" />
          Material List
        </div>
        <div className="overflow-x-auto rounded-sm border border-border bg-bg-white">
          <table className="w-full border-collapse text-[12.5px] [font-variant-numeric:tabular-nums]">
            {materialSections.map((section, si) => (
              <LedgerSection
                key={section.code}
                columns={materialColumns(section.title)}
                rows={section.lines}
                sort={matSorts[si] ?? { key: null, dir: "asc" }}
                onSortChange={(next) => setMatSort(si, next)}
                rowKey={(r, i) => `${r.code}-${i}`}
              />
            ))}
          </table>
        </div>
      </div>
    </div>
  );
}
