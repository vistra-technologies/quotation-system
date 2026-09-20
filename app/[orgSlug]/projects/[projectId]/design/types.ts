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

// The panel view (the Design page reducer's internal shape) and the v2 PATCH body live in
// lib/partition-design.ts — a pure module, safe to import client-side. Stage 22 (D-6): the server
// stores `sections[].cells[]` (v2); the client converts to/from this panel view once, at the fetch
// boundaries (see partition-view.ts), so the consumers keep reading `design.panels`.
import type { PanelViewDesign, PartitionDesignPatch } from "@/lib/partition-design";
export type { DesignDoor, DesignPanel, DesignStops } from "@/lib/partition-design";

/** `Partition.design` as the client sees it: the panel view. */
export type PartitionDesign = PanelViewDesign;

export interface PartitionRow {
  id: string;
  label: string;
  heightMm: number;
  widthMm: number;
  /** Panel view (already normalized from the stored v1/v2 document by
   * partition-view.ts's toPanelViewRow at every fetch boundary). */
  design?: PartitionDesign | null;
}

export interface SelectionRow {
  id: string;
  label: string;
  componentType: { name: string; code?: string };
  /**
   * Bug 10 (bugs-3.md): added so the info popover in saved-components-rail.tsx
   * can display the saved configuration for a component. The API already returns
   * this field (listSelections includes the full Selection row); only the
   * TypeScript interface needed updating. Mirrors the shape in
   * configuration/add-selection-form.tsx's local SelectionRow interface.
   */
  config?: Record<string, string | boolean | number | null>;
}

/**
 * Center-column view mode, mirroring the mockup's `viewMode` state machine.
 */
export type ViewMode = "empty" | "layout" | "configure";

/** A partition's 4 physical edges — a fixed 4-slot concept (unlike a room's
 * arbitrary-N sides), matching `design.stops`'s own shape. */
export type EdgeSide = "top" | "left" | "right" | "bottom";

/**
 * Configure mode's selection state.
 *
 * S21-0.4: updated to use `panelIds: string[]` (always an array) to support
 * multi-select (Ctrl/Cmd-click). Single-select uses a length-1 array.
 * Previously `panelId: string` (singular) — renamed to `panelIds` to match
 * the mockup's `selection.panelIds` shape and the draft reducer contract.
 *
 * Re-exported from design-draft-context.tsx as `DraftSelection`; both names
 * refer to the same type shape.
 */
export type ConfigureSelection =
  | { type: "panel"; panelIds: string[] }
  | { type: "edge"; side: EdgeSide }
  | null;

/** Partial PATCH body for PATCH /partitions/[id]. */
export interface PartitionPatch {
  label?: string;
  heightMm?: number;
  design?: PartitionDesignPatch;
}

export type MutateResult =
  | { ok: true; partition: PartitionRow }
  | { ok: false; error: string };
