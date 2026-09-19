// Stage 22 (D-6): the ONE client-side conversion point between the stored `Partition.design`
// (v1 `panels` or v2 `sections`) and the panel view the Design page's components and reducer use.
// Every fetch/state-entry boundary (design-workspace.tsx, room-list.tsx, design-draft-context.tsx)
// runs rows through toPanelViewRow so nothing downstream ever sees `sections`.

import { parseStoredDesign } from "@/lib/partition-design";
import type { PartitionRow, SelectionRow } from "./types";

/** Door-ness resolver over the project's Selections (v2 cells carry no `kind` — 04-data-model.md). */
export function makeDoorResolver(selections: SelectionRow[]): (selectionId: string) => boolean {
  const doorIds = new Set(
    selections.filter((s) => s.componentType.code === "DOOR").map((s) => s.id),
  );
  return (id) => doorIds.has(id);
}

/** Convert a raw API partition row's `design` to the panel view. Throws PartitionDesignError on a
 * malformed/inconsistent stored document (never guesses). Rows with no `design` pass through. */
export function toPanelViewRow(
  row: PartitionRow,
  isDoorSelection: (selectionId: string) => boolean,
): PartitionRow {
  if (row.design === undefined || row.design === null) return row;
  return {
    ...row,
    design: parseStoredDesign(row.design, {
      widthMm: row.widthMm,
      heightMm: row.heightMm,
      isDoorSelection,
    }),
  };
}

/** List variant: a row whose design can't be parsed is logged and shown without a design (blank
 * preview) rather than failing the whole list. */
export function toPanelViewRows(
  rows: PartitionRow[],
  isDoorSelection: (selectionId: string) => boolean,
): PartitionRow[] {
  return rows.map((row) => {
    try {
      return toPanelViewRow(row, isDoorSelection);
    } catch (err) {
      console.error("[design] could not parse partition design", row.id, err);
      return { ...row, design: null };
    }
  });
}
