"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import {
  bandsOf,
  choiceFields,
  depth,
  emptyGroups,
  findAttr,
  isChain,
  attrMatches,
  nodePreview,
  relatedIds,
  tiersOf,
  valuesOf,
  type ShowBand,
} from "./catalog-model";

interface CatalogTreeProps {
  segmentName: string;
  segmentCode: string;
  fieldsSchema: FieldEntry[];
  config: FieldOptionsConfig;
  searchQuery: string;
  /** Stage 35 S35-8: per linked field key, the producible values with no active same-type inventory item. */
  issues: Record<string, string[]>;
  /** No-op stub in Batch 1 — wired to open the editor modal starting Batch 2. */
  onOpenAttr: (fieldKey: string) => void;
}

interface LinkGeom {
  a: string;
  b: string;
  d: string;
  /** "show" = the dashed "Shown when" link from a controller to its band (Stage 35). */
  kind: "chain" | "ind" | "show";
  /** For "show": the band's member field keys (the link lights when the focus reaches any of them). */
  members?: string[];
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
  issues,
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

  const tiers = tiersOf(fields);

  // Stage 35 S35-5: one dashed band per (controller, value set); a gated card sits in its band.
  const bands = bandsOf(fields, config);
  const bandOfKey = new Map<string, ShowBand>();
  for (const b of bands) for (const k of b.fieldKeys) bandOfKey.set(k, b);
  const controllerKeys = new Set(bands.map((b) => b.controller));
  const controllerLabel = (key: string) => findAttr(fields, key)?.label ?? key;

  /** Within one column/lane: a band's members become one contiguous unit, placed at its first member. */
  function groupUnits(list: FieldEntry[], tag: string) {
    const units: ({ kind: "node"; f: FieldEntry } | { kind: "band"; id: string; band: ShowBand; members: FieldEntry[] })[] = [];
    const emitted = new Set<string>();
    for (const f of list) {
      const band = bandOfKey.get(f.key);
      if (!band) {
        units.push({ kind: "node", f });
        continue;
      }
      if (emitted.has(band.id)) continue;
      emitted.add(band.id);
      units.push({ kind: "band", id: `${band.id}-${tag}`, band, members: list.filter((x) => bandOfKey.get(x.key) === band) });
    }
    return units;
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

      // Stage 35: dashed controller -> band link (curve when the band is to the right, else an elbow
      // around the right edge of the column, as in the mockup).
      for (const el of container.querySelectorAll<HTMLElement>("[data-band-id]")) {
        const ctl = box(nodeEl(el.dataset.bandController ?? ""));
        if (!ctl) continue;
        const r = el.getBoundingClientRect();
        const bl = r.left - tr.left;
        const br = r.right - tr.left;
        const by = r.top - tr.top + 17;
        let d: string;
        if (bl >= ctl.r + 24) {
          const k = Math.max(24, (bl - ctl.r) / 2);
          d = `M${ctl.r} ${ctl.cy} C${ctl.r + k} ${ctl.cy} ${bl - k} ${by} ${bl} ${by}`;
        } else {
          const x = Math.max(ctl.r, br) + 14;
          d = `M${ctl.r} ${ctl.cy} L${x} ${ctl.cy} L${x} ${by} L${br} ${by}`;
        }
        nextLinks.push({
          a: el.dataset.bandController ?? "",
          b: el.dataset.bandId ?? "",
          kind: "show",
          d,
          members: JSON.parse(el.dataset.bandMembers ?? "[]") as string[],
        });
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
    if ("members" in l && l.members) return bandIsLit(l.a, l.members);
    return Boolean(related && related.has(l.a) && related.has(l.b));
  }
  function bandIsLit(controller: string, memberKeys: string[]) {
    return Boolean(related && related.has(controller) && memberKeys.some((k) => related.has(k)));
  }
  function renderNode(f: FieldEntry, kind: "chain" | "indep") {
    return (
      <CatalogNode
        key={f.key}
        fields={fields}
        config={config}
        field={f}
        kind={kind}
        isController={controllerKeys.has(f.key)}
        missing={issues[f.key]?.length ?? 0}
        isLit={nodeIsLit(f.key)}
        isMatch={matchSet?.has(f.key) ?? false}
        isSearching={isSearching}
        hasFocus={hasFocus}
        onMouseOver={() => handleMouseOver(f.key)}
        onClick={() => onOpenAttr(f.key)}
      />
    );
  }
  function renderUnits(list: FieldEntry[], tag: string, kind: "chain" | "indep") {
    return groupUnits(list, tag).map((u) => {
      if (u.kind === "node") return renderNode(u.f, kind);
      const memberKeys = u.members.map((m) => m.key);
      const lit = bandIsLit(u.band.controller, memberKeys);
      return (
        <BandBox
          key={u.id}
          id={u.id}
          band={u.band}
          controllerLabel={controllerLabel(u.band.controller)}
          memberKeys={memberKeys}
          lit={lit}
          dimmed={hasFocus && !lit}
          wide={kind === "indep"}
        >
          {u.members.map((m) => renderNode(m, kind))}
        </BandBox>
      );
    });
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
              stroke={linkIsLit(l) ? "var(--color-primary)" : l.kind === "ind" ? "#CDD6C9" : l.kind === "show" ? "#9DB5A1" : "#BFD0C1"}
              strokeWidth={linkIsLit(l) ? 2.25 : 1.75}
              strokeDasharray={l.kind === "show" ? "5 4" : undefined}
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
            {renderUnits(tier, `t${t}`, "chain")}
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
              {renderUnits(indep, "indep", "indep")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── One "Shown when" band (Stage 35 S35-5) ────────────────────────────────────

export const CUBE_ICON = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 8l-9-5-9 5 9 5 9-5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </svg>
);

const EYE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const WARN_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

function BandBox({
  id,
  band,
  controllerLabel,
  memberKeys,
  lit,
  dimmed,
  wide,
  children,
}: {
  id: string;
  band: ShowBand;
  controllerLabel: string;
  memberKeys: string[];
  lit: boolean;
  dimmed: boolean;
  wide: boolean;
  children: React.ReactNode;
}) {
  const warn = band.badValues.length > 0 || band.allNever;
  const tone = warn
    ? "border-[#EBD39E] bg-status-pending-bg"
    : lit
      ? "border-primary bg-primary-softer/85"
      : "border-[#AFC6B2] bg-white/55";
  const tip = `${controllerLabel} has no value ${band.badValues.join(", ")} in this organisation.`;
  return (
    <div
      data-band-id={id}
      data-band-controller={band.controller}
      data-band-members={JSON.stringify(memberKeys)}
      data-testid="show-band"
      className={`relative z-10 flex w-full flex-col gap-2 rounded-[18px] border-[1.5px] border-dashed px-3 pb-3 pt-9 transition-opacity ${wide ? "col-span-full" : "max-w-[334px]"} ${tone} ${dimmed ? "opacity-50" : ""}`}
    >
      <div
        className={`absolute left-3.5 top-2 flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold ${warn ? "text-status-pending-text" : lit ? "text-primary-dark" : "text-text-muted"}`}
      >
        {warn ? WARN_ICON : EYE_ICON}
        <span>
          Shown when {controllerLabel} ={" "}
          {band.values.map((v, i) => (
            <span key={v}>
              {i > 0 && ", "}
              <span
                className={`rounded-pill border bg-bg-white px-2 py-px ${warn ? "border-[#EBD39E]" : "border-[#CBDFCD] text-primary-dark"} ${band.badValues.includes(v) ? "line-through" : ""}`}
              >
                {v}
              </span>
            </span>
          ))}
        </span>
        {band.badValues.length > 0 && (
          <span
            role="img"
            aria-label={tip}
            title={tip}
            className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-current text-[10px] font-extrabold"
          >
            i
          </span>
        )}
      </div>
      {children}
      {band.allNever && (
        <div className="self-start rounded-pill border border-[#EBD39E] bg-status-pending-bg px-2.5 py-1 text-[11.5px] font-extrabold text-status-pending-text">
          These fields can never appear
        </div>
      )}
    </div>
  );
}

// ─── One clickable attribute node ─────────────────────────────────────────────

function CatalogNode({
  fields,
  config,
  field,
  kind,
  isController,
  missing,
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
  isController: boolean;
  /** Stage 35: how many of this field's producible values are not in inventory. */
  missing: number;
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
        >
          {isController && EYE_ICON}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-extrabold text-text-heading" title={field.label}>
            {field.label}
          </span>
          <span className="truncate text-[11.5px] font-semibold text-text-muted">{preview}</span>
        </span>
        {field.inventoryLinked && (
          <span
            title="Linked to inventory"
            data-testid="linked-icon"
            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-[#E3F4FB] text-[#0B6E99]"
          >
            {CUBE_ICON(14)}
          </span>
        )}
        <span
          title={`${vals.length} distinct option${vals.length === 1 ? "" : "s"}`}
          className="flex h-7 min-w-[28px] flex-shrink-0 items-center justify-center rounded-pill border border-border bg-bg-page px-1.5 text-xs font-extrabold text-primary-dark"
        >
          {vals.length}
        </span>
      </button>
      {missing > 0 && (
        <button
          type="button"
          data-testid="not-in-inventory-tag"
          onClick={onClick}
          className={`absolute -top-2 inline-flex items-center gap-1 rounded-pill border border-[#F2B8B0] bg-[#FFD9D4] px-2 py-0.5 text-[10px] font-extrabold text-[#B3261E] ${
            empties.length > 0 ? "left-[112px]" : "left-10"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
          </svg>
          Not in inventory
        </button>
      )}
      {empties.length > 0 && (
        <span className="pointer-events-none absolute -top-2 left-10 rounded-pill border border-[#EBD39E] bg-status-pending-bg px-2 py-0.5 text-[10px] font-extrabold text-status-pending-text">
          {field.dependsOn ? `${empties.length} empty` : "Empty"}
        </span>
      )}
    </div>
  );
}
