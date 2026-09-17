"use client";

/**
 * Configure mode — the wall/panel editor.
 *
 * S21-D1: rebuilt to mockup parity (design-page.html lines 295-341, 1483-1646).
 *   - One consolidated header row: back button, editable partition name, and a
 *     right-aligned Width/Height stat card. (Floor·room and panel-count pills
 *     removed per human feedback — redundant with the left rail.)
 *   - Width change dispatches SET_PARTITION_WIDTH (proportional rescale, last-panel
 *     absorbs remainder — sum === new total exactly).
 *   - Height change dispatches SET_PARTITION_HEIGHT.
 *   - Back button calls onBack (design-workspace.tsx guards unsaved changes).
 *   - Save button rendered in the toolbar row here (isDirty/onSave passed down
 *     from design-workspace.tsx) instead of a separate footer, to reclaim
 *     vertical space for the canvas.
 * S21-D2: WallCanvas wired with door graphic + multi-select.
 * S21-D3: PanelContextMenu state + wiring.
 * S21-D4: DoorContextMenu state + wiring.
 *
 * Removed per Deviations register:
 *   D-4: unit-toggle control — not rendered anywhere in this file.
 *   D-5: EdgeProfile / edge-stop editor — removed entirely.
 *   D-2: panel Exclude/Include — not in this file, not in any context menu.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUnit } from "./unit-context";
import { WallCanvas } from "./wall-canvas";
import { PanelContextMenu } from "./panel-context-menu";
import { DoorContextMenu } from "./door-context-menu";
import { MIN_SPLIT_WIDTH_MM } from "./configure-constants";
import { useDraftContext } from "./design-draft-context";
import type { DraftSelection } from "./design-draft-context";
import type { SelectionRow } from "./types";

interface ConfigureModeProps {
  selections: SelectionRow[];
  onBack: () => void;
  isDirty: boolean;
  onSave: () => void;
}

export function ConfigureMode({
  selections,
  onBack,
  isDirty,
  onSave,
}: ConfigureModeProps) {
  const t = useTranslations("design");
  const { toDisplay, fromDisplay, unit } = useUnit();
  const { state, dispatch } = useDraftContext();

  const partition = state.draft;
  const selection = state.selection;

  const [nameValue, setNameValue] = useState(partition?.label ?? "");
  // null = "not being edited, show the computed value"; "" = "user cleared the
  // field and is about to type a new value, show it empty." Stage 21 QA bug
  // #14: using "" for both meanings made the input snap back to the old value
  // the instant it was backspaced to empty, before a new digit could be typed.
  const [widthText, setWidthText] = useState<string | null>(null);
  const [heightText, setHeightText] = useState<string | null>(null);
  // Bug 11 (bugs-3.md): width/height are NOT directly editable by default.
  // A small edit-icon activates editing; a checkmark/confirm-icon locks in
  // the new value and fires commitWidth/commitHeight. "width" | "height" | null.
  const [editingDimension, setEditingDimension] = useState<"width" | "height" | null>(null);

  // Context-menu anchor state — only one can be open at a time.
  const [panelMenu, setPanelMenu] = useState<{
    panelId: string;
    x: number;
    y: number;
  } | null>(null);
  const [doorMenu, setDoorMenu] = useState<{
    panelId: string;
    x: number;
    y: number;
  } | null>(null);

  // Reset local text mirrors when a different partition becomes active.
  const [prevPartitionId, setPrevPartitionId] = useState(partition?.id ?? null);
  if (prevPartitionId !== (partition?.id ?? null)) {
    setPrevPartitionId(partition?.id ?? null);
    setNameValue(partition?.label ?? "");
    setWidthText(null);
    setHeightText(null);
    setEditingDimension(null);
  }

  // Unit change: clear raw text mirrors to prevent stale-digit reinterpretation.
  const [prevUnit, setPrevUnit] = useState(unit);
  if (prevUnit !== unit) {
    setPrevUnit(unit);
    setWidthText(null);
    setHeightText(null);
    setEditingDimension(null);
  }

  if (!partition) return <p className="text-xs text-text-muted">{t("loadingPartition")}</p>;

  const panels = partition.design?.panels ?? [];

  // ── Selection helpers ──────────────────────────────────────────────────────

  function handleSelectionChange(sel: DraftSelection) {
    dispatch({ type: "SET_SELECTION", selection: sel });
  }

  // ── Name / dimension commit handlers ──────────────────────────────────────

  function commitName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === partition!.label) {
      setNameValue(partition!.label);
      return;
    }
    dispatch({ type: "SET_PARTITION_LABEL", label: trimmed });
  }

  function commitWidth() {
    const parsed = Number(widthText);
    if (!widthText || isNaN(parsed) || parsed <= 0) {
      setWidthText(null);
      setEditingDimension(null);
      return;
    }
    // fromDisplay converts from the current display unit back to mm; round to integer mm.
    const newTotalMm = Math.max(1, Math.round(fromDisplay(parsed)));
    setWidthText(null);
    setEditingDimension(null);
    dispatch({ type: "SET_PARTITION_WIDTH", widthMm: newTotalMm });
  }

  function commitHeight() {
    const parsed = Number(heightText);
    if (!heightText || isNaN(parsed) || parsed <= 0) {
      setHeightText(null);
      setEditingDimension(null);
      return;
    }
    const newHeightMm = Math.max(1, Math.round(fromDisplay(parsed)));
    setHeightText(null);
    setEditingDimension(null);
    dispatch({ type: "SET_PARTITION_HEIGHT", heightMm: newHeightMm });
  }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  function addPanel() {
    dispatch({ type: "ADD_PANEL" });
  }

  function removeSelectedPanels() {
    if (selection?.type !== "panel") return;
    dispatch({ type: "REMOVE_PANELS", panelIds: selection.panelIds });
  }

  function splitSelectedPanel() {
    if (selection?.type !== "panel" || selection.panelIds.length !== 1) return;
    dispatch({ type: "SPLIT_PANEL", panelId: selection.panelIds[0] });
  }

  // ── Toolbar disabled-state derivations ────────────────────────────────────

  const primaryPanelId = selection?.type === "panel" ? selection.panelIds[0] : undefined;
  const selectedPanel = primaryPanelId ? panels.find((p) => p.id === primaryPanelId) : undefined;
  const removeDisabled =
    !selection ||
    selection.type !== "panel" ||
    panels.length <= selection.panelIds.length;
  const splitDisabled =
    !selection ||
    selection.type !== "panel" ||
    selection.panelIds.length !== 1 ||
    !selectedPanel ||
    selectedPanel.widthMm < MIN_SPLIT_WIDTH_MM;

  // ── Display values ─────────────────────────────────────────────────────────

  // Width display uses sum of panel widths (authoritative client-side value).
  // partition.widthMm may lag the live sum until Save (server re-derives it).
  const panelWidthSum = panels.reduce((s, p) => s + p.widthMm, 0);
  const widthDisplay = widthText !== null ? widthText : String(toDisplay(panelWidthSum));
  const heightDisplay =
    heightText !== null ? heightText : String(toDisplay(partition.heightMm));

  // ── Context menu open handlers ─────────────────────────────────────────────

  function openPanelMenu(panelId: string, x: number, y: number) {
    setPanelMenu({ panelId, x, y });
    setDoorMenu(null);
  }

  function openDoorMenu(panelId: string, x: number, y: number) {
    setDoorMenu({ panelId, x, y });
    setPanelMenu(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      {/*
        Header row — mirrors mockup .wall-toolbar-row (lines 294-341, 1498-1553).
        stopPropagation: toolbar row clicks must not bubble to the outer card's
        click handler (design-workspace.tsx) which would clear the panel selection.
      */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Back button — mirrors .icon-back */}
        <button
          type="button"
          onClick={onBack}
          title={t("backToLayout")}
          aria-label={t("backToLayout")}
          className="flex h-[30px] w-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-bg-white text-[15px] text-text-muted hover:border-primary hover:text-primary-dark"
        >
          ←
        </button>

        {/* Name — mirrors .wall-head (floor·room and panel-count pills removed) */}
        <input
          type="text"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") setNameValue(partition.label);
          }}
          title={nameValue}
          aria-label="Partition name"
          className="min-w-0 shrink-0 rounded-[6px] border border-transparent bg-transparent px-[5px] py-[3px] text-[16px] font-extrabold text-text-heading hover:border-border hover:bg-[#fafaf6] focus:border-primary focus:bg-[#fafaf6] focus:outline-none"
        />

        {/*
          Stat card — Width / Height — pinned to the right edge of the header row.
          Mirrors mockup .wall-stats (lines 314-327, 1546-1575).
          Unit toggle NOT rendered (D-4 deviation).

          Bug 11 (bugs-3.md): Width and Height are NOT directly editable by
          default. Each field shows a read-only value with a small circular
          edit icon. Clicking the edit icon activates that field; the icon
          becomes a checkmark. Clicking the checkmark commits the change —
          this is when SET_PARTITION_WIDTH / SET_PARTITION_HEIGHT fires, NOT
          on every keystroke. The name field (Bug 8) uses a different pattern
          (direct inline editing) per the user's explicit distinction.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-3.5 rounded-[10px] border border-[var(--color-border-strong)] bg-bg-white px-4 py-[6px] shadow-[0_1px_3px_-1px_rgba(27,40,30,.10)]">
          {/* Width stat */}
          <div className="flex flex-col gap-[3px]">
            <span className="text-[9.5px] font-bold uppercase tracking-[.04em] text-text-muted">
              {t("fieldWidth")}
            </span>
            <div className="flex items-baseline gap-[3px]">
              {editingDimension === "width" ? (
                <input
                  type="number"
                  step="any"
                  value={widthDisplay}
                  autoFocus
                  onChange={(e) => setWidthText(e.target.value)}
                  onBlur={commitWidth}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") { setWidthText(null); setEditingDimension(null); }
                  }}
                  aria-label="Partition width"
                  className="w-[50px] border-none bg-transparent p-0 text-[13.5px] font-bold text-text-heading focus:outline-none"
                />
              ) : (
                <span className="text-[13.5px] font-bold text-text-heading">{widthDisplay}</span>
              )}
              <span className="text-[10.5px] font-semibold text-text-muted">{unit}</span>
              {/* Edit/confirm icon button */}
              <button
                type="button"
                onClick={() => {
                  if (editingDimension === "width") { commitWidth(); }
                  else { setEditingDimension("width"); }
                }}
                title={editingDimension === "width" ? "Confirm width" : "Edit width"}
                className="ml-1 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border border-border bg-bg-white text-[10px] text-text-muted hover:border-primary hover:text-primary-dark"
              >
                {editingDimension === "width" ? "✓" : "✎"}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="w-px self-stretch bg-[var(--color-border-strong)]" />

          {/* Height stat */}
          <div className="flex flex-col gap-[3px]">
            <span className="text-[9.5px] font-bold uppercase tracking-[.04em] text-text-muted">
              {t("fieldHeight")}
            </span>
            <div className="flex items-baseline gap-[3px]">
              {editingDimension === "height" ? (
                <input
                  type="number"
                  step="any"
                  value={heightDisplay}
                  autoFocus
                  onChange={(e) => setHeightText(e.target.value)}
                  onBlur={commitHeight}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") { setHeightText(null); setEditingDimension(null); }
                  }}
                  aria-label="Partition height"
                  className="w-[50px] border-none bg-transparent p-0 text-[13.5px] font-bold text-text-heading focus:outline-none"
                />
              ) : (
                <span className="text-[13.5px] font-bold text-text-heading">{heightDisplay}</span>
              )}
              <span className="text-[10.5px] font-semibold text-text-muted">{unit}</span>
              {/* Edit/confirm icon button */}
              <button
                type="button"
                onClick={() => {
                  if (editingDimension === "height") { commitHeight(); }
                  else { setEditingDimension("height"); }
                }}
                title={editingDimension === "height" ? "Confirm height" : "Edit height"}
                className="ml-1 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border border-border bg-bg-white text-[10px] text-text-muted hover:border-primary hover:text-primary-dark"
              >
                {editingDimension === "height" ? "✓" : "✎"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/*
        Canvas wrap — mirrors .canvas-wrap (lines 363-367, 1577-1584).
        Clicking the wrap (not a panel) clears selection — panels stopPropagation.
      */}
      <div
        className="flex flex-1 min-h-0 items-center justify-center rounded-[8px] border border-[var(--color-border-strong)] bg-bg-white px-[26px] py-[20px] shadow-[0_2px_10px_-4px_rgba(27,40,30,.10)]"
        onClick={() => handleSelectionChange(null)}
      >
        <WallCanvas
          heightMm={partition.heightMm}
          panels={panels}
          selections={selections}
          selection={selection}
          onSelectionChange={handleSelectionChange}
          onPanelContextMenu={openPanelMenu}
          onDoorContextMenu={openDoorMenu}
        />
      </div>

      {/*
        Canvas toolbar — mirrors .canvas-toolbar (lines 422-428, 1586-1619),
        plus the Save button (moved up from a separate footer row per human
        feedback — ml-auto pins it to the right edge, reclaiming the vertical
        space the old footer + hint text used to take).
        stopPropagation: Split selects the new panel; don't let the outer click
        handler immediately clear that selection.
      */}
      <div
        className="flex shrink-0 items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={addPanel}
          className="rounded-[6px] border border-border bg-bg-white px-3 py-[7px] text-[12px] font-semibold text-text-heading hover:border-primary hover:text-primary-dark"
        >
          {t("addPanel")}
        </button>
        <button
          type="button"
          onClick={removeSelectedPanels}
          disabled={removeDisabled}
          className="rounded-[6px] border border-border bg-bg-white px-3 py-[7px] text-[12px] font-semibold text-text-heading hover:border-primary hover:text-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("removePanel")}
        </button>
        <button
          type="button"
          onClick={splitSelectedPanel}
          disabled={splitDisabled}
          className="rounded-[6px] border border-border bg-bg-white px-3 py-[7px] text-[12px] font-semibold text-text-heading hover:border-primary hover:text-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("splitPanel")}
        </button>
        <button
          type="button"
          disabled={!isDirty}
          onClick={onSave}
          className={[
            "ml-auto rounded-pill border px-5 py-2.5 text-[12.5px] font-bold transition-colors",
            isDirty
              ? "border-primary-dark bg-primary text-white hover:bg-primary-dark"
              : "cursor-default border-text-muted bg-text-muted text-white opacity-55",
          ].join(" ")}
        >
          {isDirty ? t("saveChanges") : t("saved")}
        </button>
      </div>

      {/*
        Context menus (D3/D4) — rendered as fixed-position overlays; position
        in the DOM tree doesn't matter since they use position:fixed.
      */}
      {panelMenu && (
        <PanelContextMenu
          panelId={panelMenu.panelId}
          x={panelMenu.x}
          y={panelMenu.y}
          onClose={() => setPanelMenu(null)}
        />
      )}
      {doorMenu && (
        <DoorContextMenu
          panelId={doorMenu.panelId}
          x={doorMenu.x}
          y={doorMenu.y}
          onClose={() => setDoorMenu(null)}
        />
      )}
    </div>
  );
}
