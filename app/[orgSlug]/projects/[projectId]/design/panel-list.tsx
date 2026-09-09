"use client";

import { useTranslations } from "next-intl";
import { useUnit } from "./unit-context";
import type { ConfigureSelection, DesignPanel, SelectionRow } from "./types";

interface PanelListProps {
  panels: DesignPanel[];
  selections: SelectionRow[];
  selection: ConfigureSelection;
  onSelectPanel: (panelId: string) => void;
}

/**
 * Itemized panel list under the canvas — mirrors design-step-poc.html's
 * `renderPanelList`. Same click-to-select behaviour as the canvas panels
 * themselves (both drive the same `selection` state one level up).
 */
export function PanelList({ panels, selections, selection, onSelectPanel }: PanelListProps) {
  const t = useTranslations("design");
  const { formatLen } = useUnit();

  return (
    <div className="flex flex-col gap-1">
      {panels.map((panel, idx) => {
        const isSelected = selection?.type === "panel" && selection.panelId === panel.id;
        const doorSelection = panel.door
          ? selections.find((s) => s.id === panel.door!.selectionId)
          : undefined;
        return (
          <button
            key={panel.id}
            type="button"
            onClick={() => onSelectPanel(panel.id)}
            className={
              "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs " +
              (isSelected
                ? "border-primary-dark bg-primary-softer"
                : "border-border bg-bg-white hover:border-primary-soft")
            }
          >
            <span className="flex items-center gap-2">
              <span className="font-bold text-text-heading">
                {t("panelLabel", { n: idx + 1 })}
              </span>
              <span className="text-text-muted">
                {formatLen(panel.widthMm)} {t("wide")}
                {doorSelection ? ` · ${doorSelection.label}` : ""}
              </span>
            </span>
            <span className="text-text-muted">✎</span>
          </button>
        );
      })}
    </div>
  );
}
