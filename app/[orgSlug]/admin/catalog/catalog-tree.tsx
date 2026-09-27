"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import {
  choiceFields,
  depth,
  emptyGroups,
  findAttr,
  isChain,
  attrMatches,
  nodePreview,
  relatedIds,
  valuesOf,
} from "./catalog-model";

interface CatalogTreeProps {
  segmentName: string;
  segmentCode: string;
  fieldsSchema: FieldEntry[];
  config: FieldOptionsConfig;
  searchQuery: string;
  /** No-op stub in Batch 1 — wired to open the editor modal starting Batch 2. */
  onOpenAttr: (fieldKey: string) => void;
}

interface LinkGeom {
  a: string;
  b: string;
  d: string;
  kind: "chain" | "ind";
}
interface DotGeom {
  a: string;
  b: string;
  cx: number;
  cy: number;
  filled: boolean;
}

/**
 * The tree-canvas — root card, tiered dependent-attribute columns connected by SVG links, and the
 * independent lane. Ported from the locked mockup's `renderTree`/`drawLinks`/`related`/`light`
 * (`design-docs/mockups/catalog-page-poc.html`), translated from direct DOM manipulation to a
 * single container ref + `data-node-id` lookups (a ref-per-node Map trips the React Compiler's
 * "refs during render" rule, since building the per-node ref-callback closures during render reads
 * the ref map even though the actual read only ever happens at commit time — querying by attribute
 * inside the layout effect avoids that entirely while keeping the same geometry approach).
 *
 * S27-2: the root card is informational only — a plain `<div>`, never a `<button>`, no click
 * handler, no hover affordance implying interactivity.
 * S27-3: no option-count total anywhere (attribute count only).
 */
export function CatalogTree({
  segmentName,
  segmentCode,
  fieldsSchema,
  config,
  searchQuery,
  onOpenAttr,
}: CatalogTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<LinkGeom[]>([]);
  const [dots, setDots] = useState<DotGeom[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);

  const fields = choiceFields(fieldsSchema);
  const chain = fields.filter((f) => isChain(fields, f));
  const indep = fields.filter((f) => !isChain(fields, f));

  const maxDepth = chain.reduce((m, f) => Math.max(m, depth(fields, f)), 0);
  const nCols = Math.max(maxDepth, 3);

  const tiers: FieldEntry[][] = [];
  for (let d = 1; d <= maxDepth; d++) {
    const prevTier = tiers[d - 2] ?? [];
    tiers[d - 1] = chain
      .filter((f) => depth(fields, f) === d)
      .map((f, i) => ({
        f,
        i,
        p: f.dependsOn ? prevTier.findIndex((x) => x.key === f.dependsOn) : 0,
      }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .map((o) => o.f);
  }

  const q = searchQuery.trim().toLowerCase();
  const isSearching = q.length > 0;
  const matchSet = isSearching
    ? new Set(fields.filter((f) => attrMatches(fields, config, f, q)).map((f) => f.key))
    : null;

  // ─── Link geometry — recomputed on layout/resize, mirrors the mockup's drawLinks ────────────
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function nodeEl(id: string): HTMLElement | null {
      return container?.querySelector<HTMLElement>(`[data-node-id="${id}"]`) ?? null;
    }

    function recompute() {
      if (!container) return;
      const tr = container.getBoundingClientRect();
      function box(el: HTMLElement | null) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left - tr.left, r: r.right - tr.left, cy: (r.top + r.bottom) / 2 - tr.top };
      }
      const nextLinks: LinkGeom[] = [];
      const nextDots: DotGeom[] = [];
      const outs = new Set<string>();

      function curve(a: string, b: string, pa: NonNullable<ReturnType<typeof box>>, pb: NonNullable<ReturnType<typeof box>>) {
        const x1 = pa.r, y1 = pa.cy, x2 = pb.l, y2 = pb.cy;
        const k = Math.max(24, (x2 - x1) / 2);
        nextLinks.push({
          a,
          b,
          kind: "chain",
          d: `M${x1} ${y1} C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`,
        });
        nextDots.push({ a, b, cx: x2, cy: y2, filled: true });
        outs.add(a);
      }

      const rootBox = box(nodeEl("root"));
      if (rootBox) {
        for (const f of chain) {
          const el = nodeEl(f.key);
          if (!el) continue;
          const parentBox = f.dependsOn ? box(nodeEl(f.dependsOn)) : rootBox;
          if (!parentBox) continue;
          curve(f.dependsOn ?? "root", f.key, parentBox, box(el) as NonNullable<ReturnType<typeof box>>);
        }

        const hubEl = nodeEl("hub");
        if (hubEl && indep.length) {
          const hubBox = box(hubEl) as NonNullable<ReturnType<typeof box>>;
          curve("root", "hub", rootBox, hubBox);
          const gridBox = box(nodeEl("indep-grid"));
          if (gridBox) {
            const railY = gridBox.cy;
            let maxSx = 0;
            for (const f of indep) {
              const b = box(nodeEl(f.key));
              if (!b) continue;
              const sx = b.l - 18;
              maxSx = Math.max(maxSx, sx);
              nextLinks.push({
                a: "rail",
                b: f.key,
                kind: "ind",
                d: `M${sx} ${railY} L${sx} ${b.cy} L${b.l} ${b.cy}`,
              });
              nextDots.push({ a: "rail", b: f.key, cx: b.l, cy: b.cy, filled: true });
            }
            const midX = hubBox.r + 22;
            nextLinks.push({
              a: "hub",
              b: "rail",
              kind: "ind",
              d: `M${hubBox.r} ${hubBox.cy} L${midX} ${hubBox.cy} L${midX} ${railY} L${maxSx} ${railY}`,
            });
            outs.add("hub");
          }
        }
      }

      for (const id of outs) {
        const b = box(nodeEl(id));
        if (!b) continue;
        nextDots.push({ a: id, b: id, cx: b.r, cy: b.cy, filled: false });
      }

      setLinks(nextLinks);
      setDots(nextDots);
      setSvgSize({ w: container.scrollWidth, h: container.scrollHeight });
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
    // Re-measure whenever the schema/config/segment changes shift the layout. `chain`/`indep` are
    // deliberately excluded — they're new array instances every render (derived from fieldsSchema
    // each time), so including them here re-triggers this effect every commit, which calls
    // setLinks/setDots, which re-renders, which recomputes new chain/indep arrays — an infinite
    // "too many re-renders" loop (React error #185, caught live against the real cloisons org's
    // 13-attribute GLASS chain during manual preview verification). fieldsSchema is the actual
    // source of truth chain/indep are derived from, so it alone is sufficient here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsSchema, config, segmentName]);

  const related = focusId ? relatedIds(fields, focusId) : null;
  const hasFocus = Boolean(related);

  function nodeIsLit(id: string) {
    return related ? related.has(id) : false;
  }
  function linkIsLit(l: LinkGeom | DotGeom) {
    return Boolean(related && related.has(l.a) && related.has(l.b));
  }

  function handleMouseOver(id: string) {
    if (id !== focusId) setFocusId(id);
  }
  function handleMouseLeave() {
    setFocusId(null);
  }

  return (
    <div className="overflow-auto rounded-b-md bg-[radial-gradient(circle,rgba(78,127,88,.16)_1px,transparent_1.3px)] bg-bg-card [background-size:18px_18px]">
      <div
        ref={containerRef}
        className="relative grid min-w-[1100px] gap-x-14 px-7 pb-8 pt-5"
        style={{ gridTemplateColumns: `minmax(200px, 232px) repeat(${nCols}, minmax(220px, 1fr))` }}
        onMouseLeave={handleMouseLeave}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 z-0 overflow-visible"
          width={svgSize.w}
          height={svgSize.h}
          viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
          aria-hidden="true"
        >
          {links.map((l, i) => (
            <path
              key={`${l.a}-${l.b}-${i}`}
              d={l.d}
              fill="none"
              stroke={linkIsLit(l) ? "var(--color-primary)" : l.kind === "ind" ? "#CDD6C9" : "#BFD0C1"}
              strokeWidth={linkIsLit(l) ? 2.25 : 1.75}
              opacity={hasFocus && !linkIsLit(l) ? 0.3 : 1}
            />
          ))}
          {dots.map((d, i) => (
            <circle
              key={`dot-${d.a}-${d.b}-${i}`}
              cx={d.cx}
              cy={d.cy}
              r={d.filled ? 3 : 4.5}
              fill={d.filled ? (linkIsLit(d) ? "var(--color-primary)" : "#AFC6B2") : "var(--color-bg-white)"}
              stroke={d.filled ? "none" : linkIsLit(d) ? "var(--color-primary)" : "#AFC6B2"}
              strokeWidth={d.filled ? 0 : 1.5}
              opacity={hasFocus && !linkIsLit(d) ? 0.3 : 1}
            />
          ))}
        </svg>

        {/* Tier headers */}
        <div
          className="overflow-hidden truncate whitespace-nowrap pb-3 text-[10.5px] font-extrabold uppercase tracking-wider text-text-muted"
          style={{ gridColumn: 1, gridRow: 1 }}
        >
          Segment
        </div>
        {Array.from({ length: nCols }, (_, i) => i + 1).map((c) => {
          if (c > maxDepth) return <div key={c} style={{ gridColumn: c + 1, gridRow: 1 }} />;
          let label: string;
          if (c === 1) {
            label = "Base attribute";
          } else {
            const parentLabels: string[] = [];
            for (const f of tiers[c - 1] ?? []) {
              const p = f.dependsOn ? findAttr(fields, f.dependsOn) : null;
              if (p && !parentLabels.includes(p.label)) parentLabels.push(p.label);
            }
            label = `Depends on ${parentLabels.join(" / ")}`;
          }
          return (
            <div
              key={c}
              className="flex items-center gap-1.5 overflow-hidden truncate whitespace-nowrap pb-3 text-[10.5px] font-extrabold uppercase tracking-wider text-text-muted"
              style={{ gridColumn: c + 1, gridRow: 1 }}
            >
              <span className="flex h-[19px] w-[19px] flex-shrink-0 items-center justify-center rounded-full border border-border bg-bg-white text-[10px] tracking-normal text-primary-dark">
                {c}
              </span>
              {label}
            </div>
          );
        })}

        {/* Root card — informational only, S27-2: not a button, no click handler. */}
        <div
          data-node-id="root"
          className="relative z-10 flex items-center"
          style={{ gridColumn: 1, gridRow: `2 / ${indep.length ? 4 : 3}` }}
          onMouseOver={() => handleMouseOver("root")}
        >
          <div
            className="w-full rounded-[22px] bg-primary px-[18px] pb-4 pt-[18px] text-text-on-primary shadow-[0_14px_30px_-18px_rgba(27,40,30,.55)]"
            aria-label={`${segmentName} segment`}
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[.18]" />
            <div className="text-[19px] font-extrabold leading-tight">{segmentName}</div>
            <span className="mt-1.5 inline-block rounded-pill bg-white/20 px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider">
              {segmentCode}
            </span>
            <div className="mt-3 text-xs font-semibold opacity-85">
              {fields.length} attribute{fields.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* Tiered chain columns */}
        {tiers.map((tier, t) => (
          <div
            key={t}
            className="relative z-10 flex flex-col justify-center gap-3.5 py-1.5 pb-6"
            style={{ gridColumn: t + 2, gridRow: 2 }}
          >
            {tier.map((f) => (
              <CatalogNode
                key={f.key}
                fields={fields}
                config={config}
                field={f}
                kind="chain"
                isLit={nodeIsLit(f.key)}
                isMatch={matchSet?.has(f.key) ?? false}
                isSearching={isSearching}
                hasFocus={hasFocus}
                onMouseOver={() => handleMouseOver(f.key)}
                onClick={() => onOpenAttr(f.key)}
              />
            ))}
          </div>
        ))}

        {/* Independent lane */}
        {indep.length > 0 && (
          <>
            <div
              className="mr-[-4px] border-t border-dashed border-[#CDD3C6]"
              style={{ gridColumn: "2 / -1", gridRow: 3, alignSelf: "start" }}
            />
            <div className="relative z-10 pt-3.5" style={{ gridColumn: 2, gridRow: 3 }}>
              <div className="mb-2.5 text-[10.5px] font-extrabold uppercase tracking-wider text-text-muted">
                No dependency
              </div>
              <div
                data-node-id="hub"
                className="relative w-full max-w-[290px]"
                onMouseOver={() => handleMouseOver("hub")}
              >
                <div className="flex w-full cursor-default items-center gap-2.5 rounded-pill border-[1.5px] border-dashed border-border bg-bg-card p-1.5 pl-1.5 shadow-[0_1px_2px_rgba(27,40,30,.05)]">
                  <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-bg-page text-text-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-extrabold text-text-heading">Independent</span>
                    <span className="truncate text-[11.5px] font-semibold text-text-muted">
                      Always offered for {segmentName}
                    </span>
                  </span>
                  <span className="flex h-7 min-w-[28px] flex-shrink-0 items-center justify-center rounded-pill border border-border bg-bg-page px-1.5 text-xs font-extrabold text-primary-dark">
                    {indep.length}
                  </span>
                </div>
              </div>
            </div>
            <div
              data-node-id="indep-grid"
              className="relative z-10 grid content-start gap-x-9 gap-y-3 pl-4 pt-[38px]"
              style={{ gridColumn: "3 / -1", gridRow: 3, gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))" }}
            >
              {indep.map((f) => (
                <CatalogNode
                  key={f.key}
                  fields={fields}
                  config={config}
                  field={f}
                  kind="indep"
                  isLit={nodeIsLit(f.key)}
                  isMatch={matchSet?.has(f.key) ?? false}
                  isSearching={isSearching}
                  hasFocus={hasFocus}
                  onMouseOver={() => handleMouseOver(f.key)}
                  onClick={() => onOpenAttr(f.key)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── One clickable attribute node ─────────────────────────────────────────────

function CatalogNode({
  fields,
  config,
  field,
  kind,
  isLit,
  isMatch,
  isSearching,
  hasFocus,
  onMouseOver,
  onClick,
}: {
  fields: FieldEntry[];
  config: FieldOptionsConfig;
  field: FieldEntry;
  kind: "chain" | "indep";
  isLit: boolean;
  isMatch: boolean;
  isSearching: boolean;
  hasFocus: boolean;
  onMouseOver: () => void;
  onClick: () => void;
}) {
  const vals = valuesOf(fields, config, field);
  const empties = emptyGroups(fields, config, field);
  const preview = nodePreview(fields, config, field);
  const dimmed = (hasFocus && !isLit) || (isSearching && !isMatch);

  return (
    <div
      data-node-id={field.key}
      className={`relative w-full transition-opacity ${kind === "chain" ? "max-w-[290px]" : ""} ${dimmed ? "opacity-40" : ""}`}
      onMouseOver={onMouseOver}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Edit ${field.label} (${vals.length} option${vals.length === 1 ? "" : "s"})`}
        className={`flex w-full items-center gap-2.5 rounded-pill border-[1.5px] bg-bg-white py-1.5 pl-1.5 pr-2 text-left shadow-[0_1px_2px_rgba(27,40,30,.05)] transition hover:-translate-y-px hover:shadow-[0_8px_18px_-10px_rgba(27,40,30,.4)] focus-visible:outline-none ${
          isLit || isMatch ? "border-primary" : "border-border"
        } ${isMatch ? "shadow-[0_0_0_3px_var(--color-status-pending-bg)] border-[#D9B25F]" : ""}`}
      >
        <span
          className={`flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full ${
            kind === "indep" ? "bg-bg-page text-text-muted" : "bg-primary-softer text-primary-dark"
          }`}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-extrabold text-text-heading" title={field.label}>
            {field.label}
          </span>
          <span className="truncate text-[11.5px] font-semibold text-text-muted">{preview}</span>
        </span>
        <span
          title={`${vals.length} distinct option${vals.length === 1 ? "" : "s"}`}
          className="flex h-7 min-w-[28px] flex-shrink-0 items-center justify-center rounded-pill border border-border bg-bg-page px-1.5 text-xs font-extrabold text-primary-dark"
        >
          {vals.length}
        </span>
      </button>
      {empties.length > 0 && (
        <span className="pointer-events-none absolute -top-2 left-10 rounded-pill border border-[#EBD39E] bg-status-pending-bg px-2 py-0.5 text-[10px] font-extrabold text-status-pending-text">
          {field.dependsOn ? `${empties.length} empty` : "Empty"}
        </span>
      )}
    </div>
  );
}
