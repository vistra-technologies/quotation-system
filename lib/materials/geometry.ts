/**
 * Partition geometry derivation for the material-list formula engine (Stage 24 Batch 4).
 *
 * PURE: no Prisma, no lib/data/* function calls.
 * Produces the `partition.*` namespace object consumed by expr-eval in PARTITION-grain formulas.
 * Implements the corner-junction table from partition.md (2026-09-23).
 */
import type { RoomSide } from "../data/rooms";

// ─── Minimal design types (structural subset of PartitionDesignV2) ───────────
// Defined inline so geometry.ts has no lib/partition-design.ts dependency.
// The evaluator extracts these fields from the stored v2 JSON before calling here.

export interface ParsedCell {
  heightMm: number;
  selectionId: string | null;
}

export interface ParsedSection {
  widthMm: number;
  cells: ParsedCell[];
}

/** Minimal shape of a parsed v2 partition design needed by the evaluator. */
export interface ParsedDesign {
  sections: ParsedSection[];
}

// ─── Output type ─────────────────────────────────────────────────────────────

/** The full `partition.*` namespace exposed to expr-eval in PARTITION-grain formulas. */
export interface PartitionGeometry {
  widthMm: number;
  heightMm: number;
  doorWidthMmFullHeight: number;
  doorCount: number;
  nonCornerDoorCount: number;
  leftIsPartition: 0 | 1;
  rightIsPartition: 0 | 1;
  leftEndIsDoor: 0 | 1;
  rightEndIsDoor: 0 | 1;
  leftNeighborEndIsDoor: 0 | 1;
  rightNeighborEndIsDoor: 0 | 1;
  leftWallLike: 0 | 1;
  rightWallLike: 0 | 1;
  leftDegree: 0 | 1;
  rightDegree: 0 | 1;
}

// ─── Corner-junction helper ───────────────────────────────────────────────────

interface EndFlags {
  wallLike: 0 | 1;
  degree: 0 | 1;
}

/**
 * Derive wallLike/degree for one end of a partition.
 * Verbatim from the corner-junction table in partition.md (2026-09-23):
 *
 * | This end         | Neighbor                               | wallLike | degree |
 * | Door             | Wall                                   |    0     |   0    |
 * | Door             | Partition                              |    0     |   0    |
 * | Glass            | Wall                                   |    1     |   0    |
 * | Glass            | Partition, neighbor's end is glass     |    0     |   1    |
 * | Glass            | Partition, neighbor's end is a door    |    1     |   0    |
 */
function endFlags(endIsDoor: 0 | 1, isPartition: 0 | 1, neighborEndIsDoor: 0 | 1): EndFlags {
  if (endIsDoor) return { wallLike: 0, degree: 0 };
  if (!isPartition) return { wallLike: 1, degree: 0 };       // glass meets wall
  if (neighborEndIsDoor) return { wallLike: 1, degree: 0 };  // neighbor end is door → treated as wall
  return { wallLike: 0, degree: 1 };                        // genuine glass-to-glass junction
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DerivePartitionGeometryArgs {
  partitionId: string;
  widthMm: number;
  heightMm: number;
  parsedDesign: ParsedDesign;
  sides: RoomSide[];
  isClosed: boolean;
  /**
   * Returns the ComponentType.code (e.g. "GLASS", "DOOR") for a cell's selectionId.
   * Returns null when the selectionId is null, blank, or does not resolve to a known type.
   * Injected by the caller — keeps geometry.ts free of map-building logic.
   */
  cellSlotResolver: (selectionId: string) => string | null;
  /**
   * Returns another partition's ParsedDesign by partitionId (for leftNeighborEndIsDoor /
   * rightNeighborEndIsDoor). Returns null if the design is unknown or has no sections.
   * Injected by the caller.
   */
  neighborDesignResolver: (partitionId: string) => ParsedDesign | null;
}

export function derivePartitionGeometry(args: DerivePartitionGeometryArgs): PartitionGeometry {
  const {
    partitionId, widthMm, heightMm, parsedDesign,
    sides, isClosed, cellSlotResolver, neighborDesignResolver,
  } = args;
  const sections = parsedDesign.sections ?? [];
  const n = sides.length;

  // ── Step 1: Find this partition's position in sides[] ───────────────────────
  const idx = sides.findIndex(s => s.kind === "PARTITION" && s.partitionId === partitionId);

  // ── Step 2: Identify left/right neighbors ────────────────────────────────────
  // If idx === -1 (partition absent from sides[]), both neighbours stay null → both ends are
  // treated as wall/wall — the maximum profile/L-connector treatment. This is a data-integrity
  // problem (a Partition row not referenced by its Room's sides[]), NOT a valid geometry default.
  // It is unreachable in normal operation: Batch 5's phase-A structural pass will record a
  // SELECTION_MISSING (or equivalent) problem and gate submission before the evaluator runs.
  // If it becomes reachable, it should be caught and surfaced here rather than silently degraded.
  let leftNeighbor: RoomSide | null = null;
  let rightNeighbor: RoomSide | null = null;

  if (idx >= 0) {
    if (isClosed) {
      leftNeighbor = sides[(idx - 1 + n) % n];
      rightNeighbor = sides[(idx + 1) % n];
    } else {
      leftNeighbor = idx > 0 ? sides[idx - 1] : null;        // open end → no left neighbor
      rightNeighbor = idx < n - 1 ? sides[idx + 1] : null;   // open end → no right neighbor
    }
  }

  // ── Step 3: leftIsPartition / rightIsPartition ───────────────────────────────
  const leftIsPartition: 0 | 1 = leftNeighbor?.kind === "PARTITION" ? 1 : 0;
  const rightIsPartition: 0 | 1 = rightNeighbor?.kind === "PARTITION" ? 1 : 0;

  // ── Helper: resolve slot for a cell by selectionId ───────────────────────────
  function slotOf(selId: string | null): string | null {
    if (!selId) return null;
    return cellSlotResolver(selId);
  }

  // ── Step 4: Walk sections[] to derive door-count metrics ─────────────────────
  // ASSUMPTION: sections[] are ordered left-to-right in the partition's local coordinate
  // (the first section's first cell is the leftmost corner cell). This is the natural order
  // for the design canvas; if disproved, leftEndIsDoor/rightEndIsDoor swap — a one-line fix.
  // See the documented limitation in partition.md ("Stated limitation — sections[] ordering"):
  // this invariant is not currently enforceable — partition orientation is not representable
  // in the data model. The mismatch only matters when a partition has a door at exactly one
  // end and a partition neighbour at that end.
  let leftEndIsDoor: 0 | 1 = 0;
  let rightEndIsDoor: 0 | 1 = 0;
  let doorCount = 0;
  let doorWidthMmFullHeight = 0;

  if (sections.length > 0) {
    const firstSection = sections[0];
    if (firstSection.cells.length > 0) {
      if (slotOf(firstSection.cells[0].selectionId) === "DOOR") leftEndIsDoor = 1;
    }

    const lastSection = sections[sections.length - 1];
    if (lastSection.cells.length > 0) {
      if (slotOf(lastSection.cells[lastSection.cells.length - 1].selectionId) === "DOOR") rightEndIsDoor = 1;
    }

    for (const section of sections) {
      for (const cell of section.cells) {
        if (slotOf(cell.selectionId) === "DOOR") {
          doorCount++;
          // Full-height door: the only cell in its section and height equals the partition height.
          // ASSUMPTION: "full height" = cell.heightMm === partition.heightMm. A transom door
          // (door cell below a glass transom) has cell.heightMm < partitionHeightMm — not full-height.
          if (section.cells.length === 1 && cell.heightMm === heightMm) {
            doorWidthMmFullHeight += section.widthMm;
          }
        }
      }
    }
  }

  // nonCornerDoorCount: subtract the left and right corner doors (each end at most 1).
  // Math.max(0, ...) guards the degenerate case of a single DOOR cell that is simultaneously the
  // leftmost and rightmost cell (leftEndIsDoor=1, rightEndIsDoor=1, doorCount=1 → would give -1).
  // That partition has no GLASS cell so no PARTITION-grain formula fires (evaluate.ts skips it),
  // but the geometry object itself should not carry a negative value.
  const nonCornerDoorCount = Math.max(0, doorCount - leftEndIsDoor - rightEndIsDoor);

  // ── Step 5: leftNeighborEndIsDoor / rightNeighborEndIsDoor ───────────────────
  // ASSUMPTION: sides[] walk order corresponds to left-to-right partition orientation. So a
  // left-neighbor A (which precedes B in sides[]) has its *right* end
  // (sections[last].cells[last]) adjacent to B, and a right-neighbor C has its *left* end
  // (sections[0].cells[0]) adjacent to B. If this assumption is wrong, the two values are
  // reversed — a one-line fix in the resolver calls below.
  // This is a documented, named limitation — see partition.md ("Stated limitation — sections[]
  // ordering"): the invariant is not currently enforceable because partition orientation is not
  // representable in the data model. Damage is bounded to the configuration where a partition
  // has a door at exactly one end and a partition neighbour whose facing end differs from what
  // is read here. The planned fix is a `reversed?: boolean` field on PartitionSide in Room.sides.
  function resolveNeighborEndIsDoor(neighbor: RoomSide | null, isLeftNeighbor: boolean): 0 | 1 {
    if (!neighbor || neighbor.kind !== "PARTITION") return 0;
    const design = neighborDesignResolver(neighbor.partitionId);
    if (!design || !design.sections || design.sections.length === 0) return 0;
    const nSections = design.sections;
    if (isLeftNeighbor) {
      // Left-neighbor A's right end (the end facing B) = A's sections[last].cells[last]
      const lastSec = nSections[nSections.length - 1];
      if (!lastSec || lastSec.cells.length === 0) return 0;
      return slotOf(lastSec.cells[lastSec.cells.length - 1].selectionId) === "DOOR" ? 1 : 0;
    } else {
      // Right-neighbor C's left end (the end facing B) = C's sections[0].cells[0]
      const firstSec = nSections[0];
      if (!firstSec || firstSec.cells.length === 0) return 0;
      return slotOf(firstSec.cells[0].selectionId) === "DOOR" ? 1 : 0;
    }
  }

  const leftNeighborEndIsDoor: 0 | 1 = leftIsPartition
    ? resolveNeighborEndIsDoor(leftNeighbor, true)
    : 0;
  const rightNeighborEndIsDoor: 0 | 1 = rightIsPartition
    ? resolveNeighborEndIsDoor(rightNeighbor, false)
    : 0;

  // ── Step 6: Apply corner-junction table ──────────────────────────────────────
  const lf = endFlags(leftEndIsDoor, leftIsPartition, leftNeighborEndIsDoor);
  const rf = endFlags(rightEndIsDoor, rightIsPartition, rightNeighborEndIsDoor);

  return {
    widthMm,
    heightMm,
    doorWidthMmFullHeight,
    doorCount,
    nonCornerDoorCount,
    leftIsPartition,
    rightIsPartition,
    leftEndIsDoor,
    rightEndIsDoor,
    leftNeighborEndIsDoor,
    rightNeighborEndIsDoor,
    leftWallLike: lf.wallLike,
    rightWallLike: rf.wallLike,
    leftDegree: lf.degree,
    rightDegree: rf.degree,
  };
}
