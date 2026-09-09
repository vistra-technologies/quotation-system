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
    if (side.kind === "PARTITION") {
      const p = partitions.find((row) => row.id === side.partitionId);
      if (p) {
        return `${p.label} — ${formatLen(p.widthMm)} × ${formatLen(p.heightMm)}`;
      }
      return t("partitionTip");
    }
    return side.label ? `${side.label} — ${t("plainWallTip")}` : t("plainWallTip");
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
    <div className="flex flex-col items-center gap-3">
      <div className="relative mx-auto w-full max-w-[340px]">
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          className="w-full"
          style={{ aspectRatio: "1 / 1" }}
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
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm bg-text-heading px-2.5 py-1.5 text-[10.5px] font-semibold text-bg-white shadow-md"
            style={{
              left: `${(tooltip.x / VIEWBOX) * 100}%`,
              top: `${(tooltip.y / VIEWBOX) * 100}%`,
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 rounded-pill border border-border bg-bg-white px-4 py-1.5 text-[10.5px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-[2px] border border-[#C7CBBA] bg-[#DFE2D4]" />
          {t("legendWall")}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-[2px] border"
            style={{
              backgroundColor: "var(--color-primary)",
              borderColor: "var(--color-primary-dark)",
            }}
          />
          {t("legendPartition")}
        </span>
      </div>
    </div>
  );
}
