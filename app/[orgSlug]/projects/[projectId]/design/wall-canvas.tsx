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
 * Hotfix 2026-10-01: door swing LINES (apex on the hinge edge) + faint LH/RH labels replace the
 * quarter-arc; a double-leaf door (selection `isDoubleLeaf` = "Yes") draws one triangle per leaf
 * (LH left / RH right, no hinge menu); draggable dividers between panels trade width between
 * neighbours (total preserved, 100 mm minimum).
 *
 * Door-height slider removed (Track C handles it in the right rail).
 * Panel Exclude/Include NOT present (D-2 deviation).
 * Unit toggle NOT present (D-4 deviation).
 */

import { useRef, useState } from "react";
import { isDoubleLeafConfig } from "@/lib/door-leaf";
import { MIN_PANEL_WIDTH_MM } from "./configure-constants";
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
  /** Divider drag / arrow-key nudge: new widthMm for the two neighbouring panels (sum preserved). */
  onResizePanels?: (widths: Record<string, number>) => void;
}

export function WallCanvas({
  heightMm,
  panels,
  selections,
  selection,
  onSelectionChange,
  onPanelContextMenu,
  onDoorContextMenu,
  onResizePanels,
}: WallCanvasProps) {
  const { formatLen } = useUnit();

  const totalWidthMm = panels.reduce((sum, p) => sum + p.widthMm, 0) || 1;

  // Live widths while a divider is being dragged; the draft is only touched on release.
  const rowRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Record<string, number> | null>(null);
  const widthOf = (p: DesignPanel) => live?.[p.id] ?? p.widthMm;
  // A neighbour pair can't shrink below 100 mm, unless it is already narrower, in which case it holds.
  const clampLeft = (left: number, pair: number, a: number, b: number) =>
    Math.max(Math.min(MIN_PANEL_WIDTH_MM, a), Math.min(pair - Math.min(MIN_PANEL_WIDTH_MM, b), left));

  function startDividerDrag(e: React.PointerEvent<HTMLDivElement>, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const left = panels[i]!;
    const right = panels[i + 1]!;
    const pair = left.widthMm + right.widthMm;
    const startX = e.clientX;
    const mmPerPx = totalWidthMm / (rowRef.current?.getBoundingClientRect().width || 1);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let latest: Record<string, number> | null = null;
    const onMove = (ev: PointerEvent) => {
      const l = clampLeft(Math.round(left.widthMm + (ev.clientX - startX) * mmPerPx), pair, left.widthMm, right.widthMm);
      latest = { [left.id]: l, [right.id]: pair - l };
      setLive(latest);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setLive(null);
      if (latest && latest[left.id] !== left.widthMm) onResizePanels?.(latest);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  function nudgeDivider(e: React.KeyboardEvent<HTMLDivElement>, i: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const left = panels[i]!;
    const right = panels[i + 1]!;
    const pair = left.widthMm + right.widthMm;
    const l = clampLeft(left.widthMm + (e.key === "ArrowRight" ? 1 : -1), pair, left.widthMm, right.widthMm);
    if (l !== left.widthMm) onResizePanels?.({ [left.id]: l, [right.id]: pair - l });
  }

  const selectedPanelIds: string[] =
    selection?.type === "panel" ? selection.panelIds : [];

  return (
    // .wall-frame — flex, centers wall-box, max-width 780px, fills the
    // canvas-wrap's height (mockup line 370: height: 100%) instead of a
    // JS-computed pixel cap, so the canvas actually uses the available
    // vertical space rather than topping out around 300px.
    <div className="flex h-full w-full max-w-[780px] items-stretch justify-center">
      {/* .wall-box — relative wrapper, full width/height (mockup line 372) */}
      <div className="relative h-full min-h-0 w-full">
        {/*
          .wall-canvas — 2px green border, border-radius: 6px, overflow hidden.
          min-h-[150px] keeps a sane floor; h-full lets it grow with the parent.
        */}
        <div className="flex h-full min-h-[150px] w-full overflow-hidden rounded-[6px] border-2 border-primary bg-bg-white">
          {/* .panel-row — flex:1 */}
          <div ref={rowRef} className="relative flex flex-1">
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
              const doorSelection = panel.door
                ? selections.find((s) => s.id === panel.door?.selectionId)
                : undefined;
              const isDouble = isDoubleLeafConfig(doorSelection?.config);

              return (
                <div
                  key={panel.id}
                  role="button"
                  tabIndex={0}
                  aria-selected={isSelected}
                  style={{
                    flexBasis: `${(widthOf(panel) / totalWidthMm) * 100}%`,
                  }}
                  className={[
                    // Base panel styles — mirrors .panel (mockup lines 379-382)
                    "relative flex cursor-pointer flex-col items-start overflow-hidden",
                    "border-r border-r-[rgba(27,40,30,.16)]",
                    // Dividers follow the panels in the row, so :last-child can't be used.
                    index === panels.length - 1 ? "border-r-0" : "",
                    "p-[10px_10px_0] transition-[opacity,background,box-shadow,transform]",
                    // State variants
                    isSelected
                      ? "z-[2] bg-[#f4faf5]"
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
                  {/* R-12: wrap the two label divs in a relative z-[1] container
                      so they render above the door's absolute fill (which is at
                      the default z-index / 0). pointer-events-none so the door's
                      right-click context menu (hinge toggle) is not blocked.
                      The selected-panel ring is z-[2] and still wins over both. */}
                  {/* Selected ring as an overlay so the door fill (a child) can't paint over it. */}
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-[3] shadow-[0_0_0_3px_var(--color-primary-dark)_inset]"
                    />
                  )}
                  <div className="relative z-[1] pointer-events-none">
                    {/* .panel-label: P{n} · {width} — mockup line 1699 */}
                    <div
                      className="text-[11.5px] font-bold"
                      style={{ color: "var(--color-panel-label)" }}
                    >
                      P{index + 1} · {formatLen(widthOf(panel))}
                    </div>

                    {/* .panel-material: glass type name — mockup line 1704 */}
                    <div className="mt-[2px] text-[9px] tracking-[.02em] text-[#93998a]">
                      {glass ? glass.label : ""}
                    </div>
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
                        // A double-leaf door has no hinge side to switch: let the panel menu handle it.
                        if (isDouble) return;
                        e.preventDefault();
                        // stopPropagation prevents the panel contextmenu from also firing
                        e.stopPropagation();
                        onDoorContextMenu?.(panel.id, e.clientX, e.clientY);
                      }}
                    >
                      {/*
                        Swing lines (elevation convention): two lines from the opening edge's top and
                        bottom corners meet at mid-height on the HINGE edge. Double leaf: one triangle
                        per leaf, each apex at its outer jamb, plus a centre line. Same colour and 40%
                        opacity as the LH/RH labels.
                      */}
                      <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        aria-hidden="true"
                      >
                        {isDouble ? (
                          <>
                            <SwingLine x1={50} y1={0} x2={0} y2={50} />
                            <SwingLine x1={50} y1={100} x2={0} y2={50} />
                            <SwingLine x1={50} y1={0} x2={100} y2={50} />
                            <SwingLine x1={50} y1={100} x2={100} y2={50} />
                            <SwingLine x1={50} y1={0} x2={50} y2={100} />
                          </>
                        ) : (
                          <>
                            <SwingLine x1={hinging === "right" ? 0 : 100} y1={0} x2={hinging === "right" ? 100 : 0} y2={50} />
                            <SwingLine x1={hinging === "right" ? 0 : 100} y1={100} x2={hinging === "right" ? 100 : 0} y2={50} />
                          </>
                        )}
                      </svg>
                      {isDouble ? (
                        <>
                          <HandLabel left="25%" text="LH" />
                          <HandLabel left="75%" text="RH" />
                        </>
                      ) : (
                        <HandLabel left="50%" text={hinging === "right" ? "RH" : "LH"} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Divider handles: one per internal edge; width trades between the two neighbours. */}
            {panels.slice(0, -1).map((panel, i) => {
              const edgePct =
                (panels.slice(0, i + 1).reduce((sum, p) => sum + widthOf(p), 0) / totalWidthMm) * 100;
              return (
                <div
                  key={`divider-${panel.id}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize P${i + 1} and P${i + 2}`}
                  tabIndex={0}
                  style={{ left: `${edgePct}%` }}
                  className="group absolute inset-y-0 z-[4] -ml-[7px] w-[14px] cursor-col-resize touch-none"
                  onPointerDown={(e) => startDividerDrag(e, i)}
                  onKeyDown={(e) => nudgeDivider(e, i)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                >
                  <span className="absolute inset-y-0 left-1/2 -ml-px w-0.5 bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  <span className="absolute left-1/2 top-1/2 -ml-[3px] -mt-[17px] h-[34px] w-[6px] rounded-[3px] border-[1.5px] border-primary bg-bg-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SwingLine(props: { x1: number; y1: number; x2: number; y2: number }) {
  return <line {...props} stroke="#4b5142" strokeOpacity={0.4} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />;
}

function HandLabel({ left, text }: { left: string; text: string }) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 text-[11px] font-extrabold tracking-[.06em] text-[#4b5142] opacity-40"
      style={{ left }}
    >
      {text}
    </span>
  );
}
