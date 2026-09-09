// ─── Shared client-side types (API response shapes, duplicated from
// lib/data/rooms.ts / lib/data/partitions.ts to avoid bundling server-only
// DAL code into Client Components — same convention design-left-rail.tsx
// used before this rework) ──────────────────────────────────────────────

export type RoomSide =
  | {
      id: string;
      kind: "PLAIN";
      partitionId: null;
      turnDegrees: number;
      lengthMm: number | null;
      label: string | null;
    }
  | {
      id: string;
      kind: "PARTITION";
      partitionId: string;
      turnDegrees: number;
      lengthMm: null;
      label: null;
    };

export interface RoomRow {
  id: string;
  floorId: string;
  label: string;
  isClosed: boolean;
  sides: RoomSide[];
}

export interface FloorRow {
  id: string;
  label: string;
}

/** A floor with its rooms already resolved server-side (page.tsx). */
export interface FloorWithRooms extends FloorRow {
  rooms: RoomRow[];
}

/** A door placed on a panel — mirrors lib/data/partitions.ts's DesignDoor.
 * `hinging` has no picker in this UI pass (Stage 18 item 7 plan flag 5,
 * architect-approved) — always written as "left". */
export interface DesignDoor {
  selectionId: string;
  hinging: "left" | "right";
  outerFrame?: { w: number; h: number };
}

/** One pane in `Partition.design.panels[]`. No `index` field — array
 * position is authoritative (architect-review-item7.md binding correction;
 * 04-data-model.md's own ruling). */
export interface DesignPanel {
  id: string;
  type: "glass" | "door";
  widthMm: number;
  heightMm: number;
  selectionId: string | null;
  door?: DesignDoor | null;
}

export interface DesignStops {
  top?: string | null;
  bottom?: string | null;
  left?: string | null;
  right?: string | null;
}

/** `Partition.design` JSONB shape (04-data-model.md). `measurements`/
 * `distribution` are documented keys this UI pass doesn't render or edit —
 * carried through unread, never dropped, by the server-side merge in
 * lib/data/partitions.ts updatePartition(). */
export interface PartitionDesign {
  measurements?: unknown;
  distribution?: unknown;
  stops?: DesignStops;
  panels?: DesignPanel[];
}

export interface PartitionRow {
  id: string;
  label: string;
  heightMm: number;
  widthMm: number;
  /** Only populated once Configure mode fetches the full partition via
   * GET /partitions/[id] — the collection route (GET /partitions?roomId=)
   * doesn't need it for the Layout-mode summary/preview. */
  design?: PartitionDesign | null;
}

export interface SelectionRow {
  id: string;
  label: string;
  componentType: { name: string; code?: string };
}

/**
 * Center-column view mode, mirroring the mockup's `viewMode` state machine.
 */
export type ViewMode = "empty" | "layout" | "configure";

/** A partition's 4 physical edges — a fixed 4-slot concept (unlike a room's
 * arbitrary-N sides), matching `design.stops`'s own shape. */
export type EdgeSide = "top" | "left" | "right" | "bottom";

/** Configure mode's local selection state — mirrors the mockup's
 * `selection`. */
export type ConfigureSelection =
  | { type: "panel"; panelId: string }
  | { type: "edge"; side: EdgeSide }
  | null;

/** Partial PATCH body for PATCH /partitions/[id]. */
export interface PartitionPatch {
  label?: string;
  heightMm?: number;
  design?: PartitionDesign;
}

export type MutateResult =
  | { ok: true; partition: PartitionRow }
  | { ok: false; error: string };
