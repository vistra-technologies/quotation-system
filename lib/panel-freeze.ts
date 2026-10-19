/**
 * Panel freeze guard (Stage 34 S34-3, Batch 4). PURE module: no prisma, no React, safe client-side.
 *
 * A locked panel is frozen: width, door add/remove/swap, hinge, door height, split, unite (also as a
 * neighbour), remove. The Design page reducer calls `freezeCheck` ONCE at the top of `draftReducer`, so
 * the freeze never depends on a button or menu greying itself. This table is the whole freeze list.
 *
 *   block  - the action names a locked panel (or a unite range containing one): refused whole, draft untouched.
 *   narrow - a bulk action runs on the unlocked panels only; the locked ones are reported as skipped / kept.
 *   pass   - not frozen. Notably SET_PARTITION_HEIGHT (D-5: the wall-height clamp on a locked door is the one
 *            path that may still change a locked panel), FILL_DEFAULT_GLASS (filling a null cell is not a
 *            change), and the width actions whose planner (lib/panel-widths.ts) already leaves locked panels alone.
 */

export interface FreezePanel {
  id: string;
  locked?: boolean;
  selectionId?: string | null;
}

export interface FreezeAction {
  type: string;
  panelId?: string;
  panelIds?: string[];
  selectionId?: string | null;
}

export type FreezeVerdict =
  | { kind: "pass" }
  | { kind: "block"; lockedIds: string[] }
  | {
      kind: "narrow";
      /** The ids the action should run on (the unlocked ones). */
      panelIds: string[];
      /** Locked ids in scope that were left alone. */
      skipped: string[];
      total: number;
      /** SKIPPED = "N locked panels skipped"; GLASS_KEPT = "N locked panels kept their glass". */
      note: "SKIPPED" | "GLASS_KEPT";
      /** For GLASS_KEPT: how many locked panels actually kept a different glass (0 = no note). */
      keptCount: number;
    };

/** Actions that name one panel and are refused when it is locked. */
const SINGLE_PANEL_BLOCKED = new Set(["TOGGLE_DOOR", "SET_DOOR_HEIGHT", "SET_DOOR_HINGE", "SPLIT_PANEL"]);

/** Bulk actions that skip locked panels and act on the rest (all locked -> block). */
const NARROWED = new Set(["REMOVE_PANELS", "SET_PANEL_WIDTH"]);

export function freezeCheck(panels: FreezePanel[], action: FreezeAction): FreezeVerdict {
  const isLocked = (id: string) => !!panels.find((p) => p.id === id)?.locked;

  if (SINGLE_PANEL_BLOCKED.has(action.type)) {
    return action.panelId && isLocked(action.panelId)
      ? { kind: "block", lockedIds: [action.panelId] }
      : { kind: "pass" };
  }

  if (action.type === "UNITE_PANELS") {
    const lockedIds = (action.panelIds ?? []).filter(isLocked);
    return lockedIds.length > 0 ? { kind: "block", lockedIds } : { kind: "pass" };
  }

  if (NARROWED.has(action.type)) {
    const ids = action.panelIds ?? [];
    const skipped = ids.filter(isLocked);
    if (skipped.length === 0) return { kind: "pass" };
    const editable = ids.filter((id) => !isLocked(id));
    if (editable.length === 0) return { kind: "block", lockedIds: skipped };
    return { kind: "narrow", panelIds: editable, skipped, total: ids.length, note: "SKIPPED", keptCount: skipped.length };
  }

  if (action.type === "SET_GLASS") {
    const ids = action.panelIds ?? [];
    const skipped = ids.filter(isLocked);
    if (skipped.length === 0) return { kind: "pass" };
    const keptCount = skipped.filter(
      (id) => (panels.find((p) => p.id === id)?.selectionId ?? null) !== (action.selectionId ?? null),
    ).length;
    return {
      kind: "narrow",
      panelIds: ids.filter((id) => !isLocked(id)),
      skipped,
      total: ids.length,
      note: "GLASS_KEPT",
      keptCount,
    };
  }

  return { kind: "pass" };
}
