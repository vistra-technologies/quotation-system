"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useUnit } from "./unit-context";
import type { PartitionRow, RoomRow } from "./types";

type Pt = [number, number];

const VIEWBOX = 200;
const WALL_THICKNESS = 16;

// ─── Small 2D vector helpers (local — this is the only place in the app
// doing polygon geometry, not worth a shared lib module for one component) ─

function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}
function add(a: Pt, b: Pt): Pt {
  return [a[0] + b[0], a[1] + b[1]];
}
function scale(a: Pt, s: number): Pt {
  return [a[0] * s, a[1] * s];
}
function vecLen(a: Pt): number {
  return Math.hypot(a[0], a[1]);
}
function normalize(a: Pt): Pt {
  const l = vecLen(a) || 1;
  return [a[0] / l, a[1] / l];
}
function dot(a: Pt, b: Pt): number {
  return a[0] * b[0] + a[1] * b[1];
}
function centroidOf(pts: Pt[]): Pt {
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0);
  const sy = pts.reduce((s, p) => s + p[1], 0);
  return [sx / n, sy / n];
}

/** Unit normal of edge a->b, disambiguated to point toward `centroid`. */
function inwardNormal(a: Pt, b: Pt, centroid: Pt): Pt {
  const dir = normalize(sub(b, a));
  const n1: Pt = [-dir[1], dir[0]];
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const towardCentroid = sub(centroid, mid);
  return dot(n1, towardCentroid) >= 0 ? n1 : [-n1[0], -n1[1]];
}

/** Intersection of line (p1 + t*d1) with line (p2 + s*d2); falls back to p1 if parallel. */
function lineIntersect(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return p1;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return add(p1, scale(d1, t));
}

/**
 * The mitred inner-boundary point for vertex `curr`, given its (possibly
 * absent, at an open run's endpoints) neighbors. Both neighbors present ->
 * true miter join (intersection of the two inward-offset edge lines). Only
 * one neighbor -> a straight perpendicular inset (equivalent to a mitre
 * against a 180-degree "phantom" edge) so an open run's end caps still look
 * like a wall, not a spike.
 */
function innerVertex(
  prev: Pt | null,
  curr: Pt,
  next: Pt | null,
  thickness: number,
  centroid: Pt,
): Pt {
  if (prev && next) {
    const n1 = inwardNormal(prev, curr, centroid);
    const n2 = inwardNormal(curr, next, centroid);
    return lineIntersect(
      add(prev, scale(n1, thickness)),
      sub(curr, prev),
      add(curr, scale(n2, thickness)),
      sub(next, curr),
    );
  }
  if (next) {
    const n2 = inwardNormal(curr, next, centroid);
    return add(curr, scale(n2, thickness));
  }
  if (prev) {
    const n1 = inwardNormal(prev, curr, centroid);
    return add(curr, scale(n1, thickness));
  }
  return curr;
}

/**
 * Human-readable label for a side index — matches design-page.html's
 * `cap(side)` for the standard 4-sided case; falls back to "Side N" for
 * arbitrary N (D-1: no N≠4 polish required, but must not crash).
 */
export function sideName(index: number, n: number): string {
  if (n === 4) {
    return (["Top", "Right", "Bottom", "Left"] as const)[index] ?? `Side ${index + 1}`;
  }
  return `Side ${index + 1}`;
}

/**
 * CSS transform string for the tooltip `<div>` so it renders outside the
 * edge it belongs to (not always above). Mirrors design-page.html lines
 * 503-506 (top/bottom/left/right tooltip offsets) for the top/bottom case.
 * Derived from the edge midpoint relative to the viewBox center so it works
 * for any N.
 *
 * Left/right deliberately do NOT mirror the mockup's outward offset
 * (bugs-1.md B-1): the mockup's page has no clipping ancestor around the
 * floor-plan card, but this app's center-column wrapper is `overflow-hidden`
 * (needed for Configure mode's wall-canvas border-radius), so an outward
 * left/right tooltip gets ~2/3 clipped. Rendering inward — over the room
 * interior — keeps the tooltip within the SVG's own box, which always sits
 * inside the card's visible bounds (the `p-6` padding around it), while
 * top/bottom keep the mockup's outward behavior since it doesn't clip there.
 */
function tooltipTransform(x: number, y: number): string {
  const dx = x - VIEWBOX / 2;
  const dy = y - VIEWBOX / 2;
  if (Math.abs(dy) >= Math.abs(dx)) {
    // Horizontal edge (top or bottom)
    return dy <= 0
      ? "translate(-50%, -100%)" // top  — show above
      : "translate(-50%, 0%)"; //  bottom — show below
  }
  // Vertical edge (left or right) — render inward, over the room interior,
  // so the tooltip stays inside the card's overflow-hidden bounds.
  return dx <= 0
    ? "translate(0%, -50%)" // left  — show to the right (inward)
    : "translate(-100%, -50%)"; //  right — show to the left (inward)
}

/**
 * Outer vertices for an N-sided room, generic over N (never a named
 * top/left/right/bottom lookup) — per architect-review-item7.md's ruling:
 * N===4 uses the drawing square's own 4 corners (reproduces the mockup's
 * literal square for the default-room case); N!==4 uses a regular N-gon
 * inscribed in a circle.
 */
function outerVertices(n: number): Pt[] {
  if (n === 4) {
    return [
      [0, 0],
      [VIEWBOX, 0],
      [VIEWBOX, VIEWBOX],
      [0, VIEWBOX],
    ];
  }
  const center: Pt = [VIEWBOX / 2, VIEWBOX / 2];
  const radius = VIEWBOX / 2 - WALL_THICKNESS;
  const verts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const angle = ((-90 + (i * 360) / n) * Math.PI) / 180;
    verts.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }
  return verts;
}

interface RoomFloorPlanProps {
  room: RoomRow;
  partitions: PartitionRow[];
  selectedIndex: number | null;
  onSelectSide: (index: number | null) => void;
}

/**
 * Generic architectural floor-plan diagram — one component, driven entirely
 * by `sides.length`/array index, never a named top/left/right/bottom slot
 * (stage-18.md §7's explicit requirement). Reproduces
 * design-step-poc.html's visual language (wall bars, diagonal-stripe
 * `is-partition` fill, hover tooltip, legend, click-to-select) as SVG.
 */
export function RoomFloorPlan({
  room,
  partitions,
  selectedIndex,
  onSelectSide,
}: RoomFloorPlanProps) {
  const t = useTranslations("design");
  const { formatLen } = useUnit();
  const patternId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const n = room.sides.length;
  const outer = outerVertices(n);
  const centroid = centroidOf(outer);
  const inner = outer.map((v, i) => {
    const prev = room.isClosed || i > 0 ? outer[(i - 1 + n) % n] : null;
    const next = room.isClosed || i < n - 1 ? outer[(i + 1) % n] : null;
    return innerVertex(prev, v, next, WALL_THICKNESS, centroid);
  });

  const segmentIndices = Array.from({ length: n }, (_, i) => i).filter(
    (i) => room.isClosed || i < n - 1,
  );

  function tipFor(index: number): string {
    const side = room.sides[index];
    // Positional prefix mirrors design-page.html's cap(side) — "Top — ",
    // "Right — ", etc. for N=4; "Side N — " for other N (D-1).
    const prefix = `${sideName(index, n)} — `;
    if (side.kind === "PARTITION") {
      const p = partitions.find((row) => row.id === side.partitionId);
      if (p) {
        // Panel count from design.panels[] — available because
        // listPartitionsByRoom returns the full Partition row including
        // the design JSONB field (no select restriction in the DAL).
        const panelCount = p.design?.panels?.length ?? 0;
        const panelLabel = panelCount === 1 ? "1 panel" : `${panelCount} panels`;
        // Separator is · (U+00B7) per design-page.html line 1247.
        return `${prefix}${p.label} · ${formatLen(p.widthMm)} × ${formatLen(p.heightMm)} · ${panelLabel}`;
      }
      return `${prefix}${t("partitionTip")}`;
    }
    // PLAIN wall — design-page.html line 1249: "plain wall (click to convert)".
    return `${prefix}${t("plainWallTip")}`;
  }

  const hovered = hoveredIndex !== null ? segmentIndices.includes(hoveredIndex) : false;
  let tooltip: { x: number; y: number; text: string } | null = null;
  if (hovered && hoveredIndex !== null) {
    const a = outer[hoveredIndex];
    const b = outer[(hoveredIndex + 1) % n];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    tooltip = { x: mid[0], y: mid[1], text: tipFor(hoveredIndex) };
  }

  return (
    // R-5: the old max-w-[340px] hard-cap prevented the floor plan from
    // using the full card width and made it appear at a fixed size regardless
    // of viewport width or browser zoom. Replacing it with a proportional
    // container: the SVG fills available width/height while preserving the 1:1
    // aspect ratio and never overflowing its container. The batch-3 viewBox
    // margin (-6 -6 212 212) is kept — it was a separate, correct fix for
    // stroke clipping at the polygon edges.
    <div className="flex h-full w-full items-center justify-center p-4">
      <div
        className="relative"
        style={{ aspectRatio: "1 / 1", maxHeight: "100%", maxWidth: "100%", width: "100%" }}
      >
        <svg
          viewBox={`-6 -6 ${VIEWBOX + 12} ${VIEWBOX + 12}`}
          className="h-full w-full"
          style={{ display: "block" }}
          onClick={() => onSelectSide(null)}
        >
          <defs>
            <pattern
              id={patternId}
              width="8"
              height="8"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <rect width="8" height="8" fill="var(--color-primary)" />
              <rect width="4" height="8" fill="var(--color-primary-dark)" />
            </pattern>
          </defs>

          {/* Interior dashed placeholder, bounded by the mitred inner polygon. */}
          <polygon
            points={inner.map((p) => p.join(",")).join(" ")}
            fill="var(--color-bg-white)"
            stroke="var(--color-border)"
            strokeDasharray="3 3"
          />

          {segmentIndices.map((i) => {
            const side = room.sides[i];
            const outerA = outer[i];
            const outerB = outer[(i + 1) % n];
            const innerB = inner[(i + 1) % n];
            const innerA = inner[i];
            const isPartition = side.kind === "PARTITION";
            const isSelected = selectedIndex === i;
            const isDimmed = selectedIndex !== null && selectedIndex !== i;

            return (
              <polygon
                key={i}
                points={[outerA, outerB, innerB, innerA].map((p) => p.join(",")).join(" ")}
                fill={isPartition ? `url(#${patternId})` : "#DFE2D4"}
                stroke={isPartition ? "var(--color-primary-dark)" : "#C7CBBA"}
                strokeWidth={isSelected ? 2.5 : 1}
                opacity={isDimmed ? 0.3 : 1}
                className="cursor-pointer transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSide(selectedIndex === i ? null : i);
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex((prev) => (prev === i ? null : prev))}
              />
            );
          })}
        </svg>

        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-sm bg-text-heading px-2.5 py-1.5 text-[10.5px] font-semibold text-bg-white shadow-md"
            style={{
              left: `${(tooltip.x / VIEWBOX) * 100}%`,
              top: `${(tooltip.y / VIEWBOX) * 100}%`,
              // Direction-aware transform — mirrors design-page.html lines
              // 503-506 (top/bottom/left/right ::after positioning).
              transform: tooltipTransform(tooltip.x, tooltip.y),
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Wall/Partition legend — mirrors mockup lines ~513-520. Rendered as a
 * sibling BELOW the canvas-wrap card (not nested inside it, matching the
 * mockup: the legend sits on the page background, outside the bordered
 * floor-plan card) — see design-workspace.tsx's layout-mode render.
 */
export function RoomFloorPlanLegend() {
  const t = useTranslations("design");
  return (
    <div className="flex items-center justify-center">
      <div className="flex items-center justify-center gap-4 rounded-pill border border-border bg-bg-white px-4 py-1.5 text-[10.5px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-[2px] border border-[#C7CBBA] bg-[#DFE2D4]" />
          {t("legendWall")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-[2px] border"
            style={{
              // Diagonal stripe matching the is-partition wall-bar fill and
              // design-page.html line 518's .legend-swatch.partition rule.
              backgroundImage:
                "repeating-linear-gradient(45deg, var(--color-primary), var(--color-primary) 3px, var(--color-primary-dark) 3px, var(--color-primary-dark) 6px)",
              borderColor: "var(--color-primary-dark)",
            }}
          />
          {t("legendPartition")}
        </span>
      </div>
    </div>
  );
}
