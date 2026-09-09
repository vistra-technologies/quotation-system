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

export interface PartitionRow {
  id: string;
  label: string;
  heightMm: number;
  widthMm: number;
}

export interface SelectionRow {
  id: string;
  label: string;
  componentType: { name: string; code?: string };
}

/**
 * Center-column view mode, mirroring the mockup's `viewMode` state machine.
 * 'configure' is wired into the type now so Piece 2 can extend
 * design-workspace.tsx without a signature change — no Configure-mode UI is
 * built this piece, and viewMode can only reach 'empty' | 'layout' in
 * practice until Piece 2 lands.
 */
export type ViewMode = "empty" | "layout" | "configure";
