"use client";

/**
 * To-scale wall canvas — panel row + door graphic with swing arc.
 *
 * S21-D2: Rebuilt to mockup parity (design-page.html lines 363-422, 1673-1749).
 *   - flex-basis proportional to widthMm / totalWidthMm (mirrors mockup's
 *     `flexBasis = (p.widthIn / total * 100) + '%'` — same math in mm).
 *   - Label format: `P{n} · {formatLen(widthMm)}` (mockup line 1699).
 *   - Glass-type name resolved from panel.selectionId → selections[].label.
 *   - Door graphic: bottom-anchored div + inner swing-arc div (replacing
 *     CSS ::after which isn't available in JSX), mirrored for hinge-right.
 *   - Selected / hover / dimmed visual states.
 * S21-D3: ctrl/cmd-click multi-select; right-click → onPanelContextMenu.
 * S21-D4: Door right-click → onDoorContextMenu.
 *
 * Door-height slider removed (Track C handles it in the right rail).
 * Panel Exclude/Include NOT present (D-2 deviation).
 * Unit toggle NOT present (D-4 deviation).
 */

import { useUnit } from "./unit-context";
import type { DraftSelection } from "./design-draft-context";
import type { DesignPanel, SelectionRow } from "./types";

interface WallCanvasProps {
  heightMm: number;
  panels: DesignPanel[];
  selections: SelectionRow[];
  /** Full draft selection — may be multi-panel (ctrl/cmd-click). */
  selection: DraftSelection;
  /** Called when selection changes (click, ctrl/cmd-click, or context-menu pre-select). */
  onSelectionChange: (sel: DraftSelection) => void;
  /** Right-click on a panel: called after this canvas updates selection. */
  onPanelContextMenu?: (panelId: string, x: number, y: number) => void;
  /** Right-click on a door graphic: separate from panel menu. */
  onDoorContextMenu?: (panelId: string, x: number, y: number) => void;
}

/**
 * Pixel canvas height from heightMm — mirrors mockup's
 * `wallPixelHeight(h) = Math.max(150, Math.min(300, Math.round(h * 2.4)))`
 * where h is in inches, so: px = round(heightMm / 25.4 * 2.4).
 */
function wallPixelHeight(heightMm: number): number {
  return Math.max(150, Math.min(300, Math.round((heightMm / 25.4) * 2.4)));
}

export function WallCanvas({
  heightMm,
  panels,
  selections,
  selection,
  onSelectionChange,
  onPanelContextMenu,
  onDoorContextMenu,
}: WallCanvasProps) {
  const { formatLen } = useUnit();

  const totalWidthMm = panels.reduce((sum, p) => sum + p.widthMm, 0) || 1;
  const canvasHeightPx = wallPixelHeight(heightMm);

  const selectedPanelIds: string[] =
    selection?.type === "panel" ? selection.panelIds : [];

  return (
    // .wall-frame — flex, centers wall-box, max-width 780px (mockup line 370)
    <div className="flex w-full max-w-[780px] items-stretch justify-center">
      {/* .wall-box — relative wrapper, full width (mockup line 372) */}
      <div className="relative w-full">
        {/*
          .wall-canvas — 2px green border, border-radius: 6px, overflow hidden.
          minHeight forces the canvas taller than the CSS minimum (mockup line 375).
        */}
        <div
          className="flex w-full overflow-hidden rounded-[6px] border-2 border-primary bg-bg-white"
          style={{ minHeight: canvasHeightPx }}
        >
          {/* .panel-row — flex:1 */}
          <div className="flex flex-1">
            {panels.map((panel, index) => {
              const isSelected = selectedPanelIds.includes(panel.id);
              const isDimmed = selectedPanelIds.length > 0 && !isSelected;
              const glass = panel.selectionId
                ? selections.find((s) => s.id === panel.selectionId)
                : undefined;
              const doorHeightPct = panel.door
                ? Math.min(100, ((panel.door.outerFrame?.h ?? heightMm) / heightMm) * 100)
                : 0;
              const hinging = panel.door?.hinging ?? "left";

              return (
                <div
                  key={panel.id}
                  role="button"
                  tabIndex={0}
                  aria-selected={isSelected}
                  style={{
                    flexBasis: `${(panel.widthMm / totalWidthMm) * 100}%`,
                  }}
                  className={[
                    // Base panel styles — mirrors .panel (mockup lines 379-382)
                    "relative flex cursor-pointer flex-col items-start overflow-hidden",
                    "border-r border-r-[rgba(27,40,30,.16)] last:border-r-0",
                    "p-[10px_10px_0] transition-[opacity,background,box-shadow,transform]",
                    // State variants
                    isSelected
                      ? "z-[2] bg-[#f4faf5] shadow-[0_0_0_3px_var(--color-primary-dark)_inset]"
                      : isDimmed
                        ? "bg-[#fbfcf9] opacity-30"
                        : [
                            "bg-[#fbfcf9]",
                            "hover:bg-[#f7fbf7]",
                            "hover:shadow-[0_0_0_2px_var(--color-primary)_inset,0_4px_10px_-4px_rgba(27,40,30,.18)]",
                            "hover:-translate-y-px",
                          ].join(" "),
                  ].join(" ")}
                  onClick={(e) => {
                    e.stopPropagation();
                    const multi = e.ctrlKey || e.metaKey;
                    if (multi) {
                      // Toggle this panel in the current multi-selection
                      const current = new Set(selectedPanelIds);
                      if (current.has(panel.id)) {
                        current.delete(panel.id);
                      } else {
                        current.add(panel.id);
                      }
                      onSelectionChange(
                        current.size > 0
                          ? { type: "panel", panelIds: Array.from(current) }
                          : null,
                      );
                    } else {
                      // Single click: select; clicking the already-sole selection deselects
                      const alreadySole =
                        selectedPanelIds.length === 1 &&
                        selectedPanelIds[0] === panel.id;
                      onSelectionChange(
                        alreadySole ? null : { type: "panel", panelIds: [panel.id] },
                      );
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Keep full multi-selection when right-clicking a member of it;
                    // otherwise replace selection with just this panel (mockup line 1742).
                    const inMultiSel =
                      selectedPanelIds.length > 1 &&
                      selectedPanelIds.includes(panel.id);
                    if (!inMultiSel) {
                      onSelectionChange({ type: "panel", panelIds: [panel.id] });
                    }
                    onPanelContextMenu?.(panel.id, e.clientX, e.clientY);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectionChange({ type: "panel", panelIds: [panel.id] });
                    }
                  }}
                >
                  {/* .panel-label: P{n} · {width} — mockup line 1699 */}
                  <div
                    className="text-[11.5px] font-bold"
                    style={{ color: "var(--color-panel-label)" }}
                  >
                    P{index + 1} · {formatLen(panel.widthMm)}
                  </div>

                  {/* .panel-material: glass type name — mockup line 1704 */}
                  <div className="mt-[2px] text-[9px] tracking-[.02em] text-[#93998a]">
                    {glass ? glass.label : ""}
                  </div>

                  {/*
                    Door graphic — mirrors .door (lines 401-414).
                    Bottom-anchored, height is a percentage of the panel height.
                    The swing arc is a child div (React has no ::after) styled to
                    match .door::after / .door.hinge-right::after exactly.
                  */}
                  {panel.door && (
                    <div
                      className="absolute inset-x-0 bottom-0 flex items-end justify-center border border-b-0 border-[#9fae9c] pb-[4px]"
                      style={{
                        height: `${doorHeightPct}%`,
                        background:
                          "repeating-linear-gradient(180deg,#eef4ec 0px,#eef4ec 3px,#e4ede1 3px,#e4ede1 4px)",
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        // stopPropagation prevents the panel contextmenu from also firing
                        e.stopPropagation();
                        onDoorContextMenu?.(panel.id, e.clientX, e.clientY);
                      }}
                    >
                      {/*
                        Swing arc — replaces .door::after / .door.hinge-right::after.
                        Left hinge:  arc fills upper-right quadrant (border-radius 0 100% 0 0),
                                     right and top borders visible.
                        Right hinge: arc fills upper-left quadrant (border-radius 100% 0 0 0),
                                     left and top borders visible.
                      */}
                      <div
                        style={{
                          position: "absolute",
                          ...(hinging === "left" ? { left: "2px" } : { right: "2px" }),
                          bottom: 0,
                          width: "96%",
                          height: "90%",
                          borderTop: "1px solid #b9c5b3",
                          borderBottom: "none",
                          ...(hinging === "left"
                            ? {
                                borderLeft: "none",
                                borderRight: "1px solid #b9c5b3",
                                borderRadius: "0 100% 0 0",
                              }
                            : {
                                borderLeft: "1px solid #b9c5b3",
                                borderRight: "none",
                                borderRadius: "100% 0 0 0",
                              }),
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
