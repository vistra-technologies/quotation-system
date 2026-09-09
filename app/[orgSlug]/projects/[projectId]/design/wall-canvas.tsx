"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUnit } from "./unit-context";
import { MIN_DOOR_HEIGHT_MM } from "./configure-constants";
import type { ConfigureSelection, DesignPanel, SelectionRow } from "./types";

interface WallCanvasProps {
  heightMm: number;
  panels: DesignPanel[];
  selections: SelectionRow[];
  selection: ConfigureSelection;
  onSelectPanel: (panelId: string) => void;
  /** Called on slider release (not every drag tick) with the panel's id and
   * the new door outerFrame.h in mm. */
  onDoorHeightCommit: (panelId: string, heightMm: number) => void;
}

/**
 * To-scale wall canvas — panel row + door notch + door-height control on the
 * selected panel, mirrors design-step-poc.html's `makeWallBox`/`makePanel`.
 * Panel width is to-scale via flex-basis (widthMm / total * 100%), matching
 * the mockup's inch-based flexBasis math but in mm.
 *
 * Door height is stored in `door.outerFrame.h` (04-data-model.md's
 * documented shape has no separate door-height field — outerFrame.{w,h} IS
 * the door leaf's own outer dimensions, which is exactly what the mockup's
 * slider controls; reusing it avoids inventing a new field).
 */
export function WallCanvas({
  heightMm,
  panels,
  selections,
  selection,
  onSelectPanel,
  onDoorHeightCommit,
}: WallCanvasProps) {
  const t = useTranslations("design");
  const { formatLen } = useUnit();
  const totalWidthMm = panels.reduce((sum, p) => sum + p.widthMm, 0) || 1;
  // Live drag value shown before it's committed on release — keyed by
  // panelId so switching panels never carries a stale pending value over.
  const [pendingHeight, setPendingHeight] = useState<{ panelId: string; heightMm: number } | null>(null);

  const canvasHeightPx = Math.max(150, Math.min(300, Math.round(heightMm * 0.0827)));

  return (
    <div
      className="flex w-full overflow-hidden rounded-sm"
      style={{ height: canvasHeightPx }}
    >
      {panels.map((panel) => {
        const isSelected = selection?.type === "panel" && selection.panelId === panel.id;
        const isDimmed = selection !== null && !isSelected;
        const glass = panel.selectionId
          ? selections.find((s) => s.id === panel.selectionId)
          : undefined;
        const doorHeightMm =
          pendingHeight?.panelId === panel.id
            ? pendingHeight.heightMm
            : (panel.door?.outerFrame?.h ?? heightMm);
        const doorSelection = panel.door
          ? selections.find((s) => s.id === panel.door!.selectionId)
          : undefined;

        return (
          <div
            key={panel.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPanel(panel.id);
            }}
            style={{ flexBasis: `${(panel.widthMm / totalWidthMm) * 100}%` }}
            className={
              "relative flex cursor-pointer flex-col items-center overflow-hidden border border-l-0 border-border pt-2 transition-colors first:border-l " +
              (isSelected ? "z-[2] border-primary bg-primary-softer" : "bg-bg-white hover:bg-primary-softer/40") +
              (isDimmed ? " opacity-30" : "")
            }
          >
            <span className="text-[8.5px] uppercase tracking-wide text-text-muted">
              {glass ? glass.label : t("noGlassAssigned")}
            </span>
            <span className="mt-0.5 text-[10.5px] font-bold text-text-heading">
              {formatLen(panel.widthMm)} {t("wide")}
            </span>

            {panel.door && (
              <div
                className="absolute inset-x-0 bottom-0 flex items-end justify-center border-t border-primary-soft bg-primary-softer/70 pb-1"
                style={{ height: `${Math.min(100, (doorHeightMm / heightMm) * 100)}%` }}
              >
                <span className="rounded-sm bg-bg-white/80 px-1 text-[8px] text-text-body">
                  {doorSelection ? doorSelection.label : t("doorLabel")}
                </span>
              </div>
            )}

            {isSelected && panel.door && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute inset-x-1.5 top-1.5 z-[3] rounded-md border border-border bg-bg-white/95 px-2 py-1.5 text-[9.5px] shadow-md"
              >
                <span className="mb-0.5 block font-bold text-text-heading">
                  {t("doorHeightLabel", { height: formatLen(doorHeightMm) })}
                </span>
                <input
                  type="range"
                  min={MIN_DOOR_HEIGHT_MM}
                  max={heightMm}
                  value={doorHeightMm}
                  onChange={(e) =>
                    setPendingHeight({ panelId: panel.id, heightMm: Number(e.target.value) })
                  }
                  onMouseUp={() => {
                    if (pendingHeight?.panelId === panel.id) {
                      onDoorHeightCommit(panel.id, pendingHeight.heightMm);
                      setPendingHeight(null);
                    }
                  }}
                  onTouchEnd={() => {
                    if (pendingHeight?.panelId === panel.id) {
                      onDoorHeightCommit(panel.id, pendingHeight.heightMm);
                      setPendingHeight(null);
                    }
                  }}
                  className="w-full"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
