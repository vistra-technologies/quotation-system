"use client";

import { useTranslations } from "next-intl";
import type { ConfigureSelection, DesignStops, EdgeSide, SelectionRow } from "./types";

interface EdgeProfileProps {
  side: EdgeSide;
  stops: DesignStops | undefined;
  selections: SelectionRow[];
  selection: ConfigureSelection;
  onClick: () => void;
}

export const EDGE_LABEL_KEY: Record<EdgeSide, string> = {
  top: "edgeTop",
  left: "edgeLeft",
  right: "edgeRight",
  bottom: "edgeBottom",
};

/**
 * One of the 4 edge-profile pickers (top/left/right/bottom) — a fixed
 * 4-slot concept here (design.stops), genuinely correct per the task's own
 * framing, unlike a room's arbitrary-N sides. Mirrors
 * design-step-poc.html's `.edge-profile` (`makeEdgeProfile`): a tag, a
 * swatch/name for the currently assigned PROFILE_STOP Selection, selected/
 * dimmed states.
 */
export function EdgeProfile({ side, stops, selections, selection, onClick }: EdgeProfileProps) {
  const t = useTranslations("design");
  const assignedId = stops?.[side] ?? null;
  const assigned = assignedId ? selections.find((s) => s.id === assignedId) : undefined;
  const isSelected = selection?.type === "edge" && selection.side === side;
  const isDimmed = selection !== null && !isSelected;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={
        "flex w-full flex-col items-center gap-1 rounded-md border px-2.5 py-1.5 transition-opacity " +
        (isSelected
          ? "border-primary-dark bg-primary-softer"
          : "border-border bg-bg-white hover:border-primary-soft") +
        (isDimmed ? " opacity-30" : "")
      }
    >
      <span className="text-[9px] font-bold uppercase tracking-wide text-text-muted">
        {t(EDGE_LABEL_KEY[side])}
      </span>
      <span className="max-w-[84px] truncate text-[10px] font-semibold text-text-heading">
        {assigned ? assigned.label : t("noProfileAssigned")}
      </span>
    </button>
  );
}
