"use client";

/**
 * Configure mode — the wall/panel editor.
 *
 * S21-0.4: migrated from immediate-write mutations (mutatePartition) to the
 * draft-state context (useDraftContext / dispatch). The `mutate` prop is gone;
 * all field changes dispatch reducer actions and are only written to the server
 * on explicit Save. No network write happens between entering Configure mode
 * and pressing Save.
 *
 * Track D (S21-D1..D4) will rebuild the full UI to mockup parity — this file
 * retains the existing visual structure for now, wired to the new reducer.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUnit } from "./unit-context";
import { WallCanvas } from "./wall-canvas";
import { PanelList } from "./panel-list";
import { EdgeProfile, EDGE_LABEL_KEY } from "./edge-profile";
import { MIN_SPLIT_WIDTH_MM } from "./configure-constants";
import { useDraftContext } from "./design-draft-context";
import type { DraftSelection } from "./design-draft-context";
import type { EdgeSide, SelectionRow } from "./types";

interface ConfigureModeProps {
  selections: SelectionRow[];
  floorLabel: string;
  roomLabel: string;
  onBack: () => void;
  // partition, selection, onSelectionChange, mutate — removed (S21-0.4).
  // Use useDraftContext() inside this component instead.
}

export function ConfigureMode({
  selections,
  floorLabel,
  roomLabel,
  onBack,
}: ConfigureModeProps) {
  const t = useTranslations("design");
  const { unit, toDisplay, fromDisplay } = useUnit();
  const { state, dispatch } = useDraftContext();

  const partition = state.draft;
  const selection = state.selection;

  const [nameValue, setNameValue] = useState(partition?.label ?? "");
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");

  // Reset local text mirrors when a different partition becomes active.
  const [prevPartitionId, setPrevPartitionId] = useState(partition?.id ?? null);
  if (prevPartitionId !== (partition?.id ?? null)) {
    setPrevPartitionId(partition?.id ?? null);
    setNameValue(partition?.label ?? "");
    setWidthText("");
    setHeightText("");
  }

  // Unit-toggle change: clear raw text mirrors to prevent stale-digit reinterpretation.
  const [prevUnit, setPrevUnit] = useState(unit);
  if (prevUnit !== unit) {
    setPrevUnit(unit);
    setWidthText("");
    setHeightText("");
  }

  if (!partition) return <p className="text-xs text-text-muted">{t("loadingPartition")}</p>;

  const panels = partition.design?.panels ?? [];

  function onSelectionChange(sel: DraftSelection) {
    dispatch({ type: "SET_SELECTION", selection: sel });
  }

  function selectPanel(panelId: string) {
    if (selection?.type === "panel" && selection.panelIds.length === 1 && selection.panelIds[0] === panelId) {
      onSelectionChange(null);
    } else {
      onSelectionChange({ type: "panel", panelIds: [panelId] });
    }
  }

  function selectEdge(side: EdgeSide) {
    onSelectionChange(
      selection?.type === "edge" && selection.side === side ? null : { type: "edge", side },
    );
  }

  function commitName() {
    const trimmed = nameValue.trim();
    // partition is guaranteed non-null here — the early return above prevents
    // rendering when draft is null, but TS can't see through closures.
    if (!trimmed || trimmed === partition!.label) {
      setNameValue(partition!.label);
      return;
    }
    dispatch({ type: "SET_PARTITION_LABEL", label: trimmed });
  }

  function commitWidth() {
    const parsed = Number(widthText);
    if (widthText === "" || isNaN(parsed) || parsed <= 0) {
      setWidthText("");
      return;
    }
    const newTotalMm = Math.max(1, Math.round(fromDisplay(parsed)));
    setWidthText("");
    dispatch({ type: "SET_PARTITION_WIDTH", widthMm: newTotalMm });
  }

  function commitHeight() {
    const parsed = Number(heightText);
    if (heightText === "" || isNaN(parsed) || parsed <= 0) {
      setHeightText("");
      return;
    }
    const newHeightMm = Math.max(1, Math.round(fromDisplay(parsed)));
    setHeightText("");
    dispatch({ type: "SET_PARTITION_HEIGHT", heightMm: newHeightMm });
  }

  function addPanel() {
    dispatch({ type: "ADD_PANEL" });
  }

  function removeSelectedPanel() {
    if (selection?.type !== "panel") return;
    dispatch({ type: "REMOVE_PANELS", panelIds: selection.panelIds });
  }

  function splitSelectedPanel() {
    if (selection?.type !== "panel" || selection.panelIds.length !== 1) return;
    dispatch({ type: "SPLIT_PANEL", panelId: selection.panelIds[0] });
  }

  function commitDoorHeight(panelId: string, heightMm: number) {
    dispatch({ type: "SET_DOOR_HEIGHT", panelId, heightMm });
  }

  // The "selected panel" for toolbar state checks — first in the array.
  const primaryPanelId = selection?.type === "panel" ? selection.panelIds[0] : undefined;
  const selectedPanel = primaryPanelId ? panels.find((p) => p.id === primaryPanelId) : undefined;
  const removeDisabled = !selection || selection.type !== "panel" || panels.length <= selection.panelIds.length;
  const splitDisabled =
    !selection || selection.type !== "panel" || selection.panelIds.length !== 1 ||
    !selectedPanel || selectedPanel.widthMm < MIN_SPLIT_WIDTH_MM;

  // Width display: use sum of panel widths (the server-authoritative value is derived
  // from this sum — partition.widthMm may lag until Save).
  const panelWidthSum = panels.reduce((s, p) => s + p.widthMm, 0);
  const widthDisplay = widthText !== "" ? widthText : String(toDisplay(panelWidthSum));
  const heightDisplay = heightText !== "" ? heightText : String(toDisplay(partition.heightMm));

  let hint: string;
  if (!selection) hint = t("hintNone");
  else if (selection.type === "panel") hint = t("hintPanel");
  else hint = t("hintEdge", { side: t(EDGE_LABEL_KEY[selection.side]) });

  return (
    <div className="relative flex w-full max-w-2xl flex-col gap-4">
      {/* Toolbar row — back, name, tags, dimensions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          title={t("backToLayout")}
          aria-label={t("backToLayout")}
          className="rounded-sm border border-border px-2 py-1 text-sm text-text-body hover:bg-primary-softer"
        >
          ←
        </button>
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
          className="truncate rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-base font-extrabold text-text-heading hover:border-border focus:border-primary focus:bg-bg-white focus:outline-none"
        />
        <span className="rounded-pill border border-primary-soft bg-primary-softer px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">
          {floorLabel} · {roomLabel}
        </span>
        <span className="rounded-pill border border-primary-soft bg-primary-softer px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">
          {t("panelsCount", { count: panels.length })}
        </span>

        <label className="ml-auto flex items-center gap-1.5 text-[11px] font-bold text-text-muted">
          {t("fieldWidth")}
          <input
            type="number"
            step="any"
            value={widthDisplay}
            onChange={(e) => setWidthText(e.target.value)}
            onBlur={commitWidth}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-20 rounded-sm border border-border bg-bg-white px-2 py-1 text-xs text-text-body focus:border-primary focus:outline-none"
          />
          {unit}
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-text-muted">
          {t("fieldHeight")}
          <input
            type="number"
            step="any"
            value={heightDisplay}
            onChange={(e) => setHeightText(e.target.value)}
            onBlur={commitHeight}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-20 rounded-sm border border-border bg-bg-white px-2 py-1 text-xs text-text-body focus:border-primary focus:outline-none"
          />
          {unit}
        </label>
      </div>

      {/* Canvas + edge profiles */}
      <div
        onClick={() => onSelectionChange(null)}
        className="flex flex-col items-center gap-2"
      >
        <div
          className="grid w-full max-w-lg items-center justify-items-center gap-2"
          style={{ gridTemplateColumns: "auto 1fr auto", gridTemplateAreas: '". top ." "left wall right" ". bottom ."' }}
        >
          <div style={{ gridArea: "top" }} className="w-full">
            <EdgeProfile
              side="top"
              stops={partition.design?.stops}
              selections={selections}
              selection={selection}
              onClick={() => selectEdge("top")}
            />
          </div>
          <div style={{ gridArea: "left" }}>
            <EdgeProfile
              side="left"
              stops={partition.design?.stops}
              selections={selections}
              selection={selection}
              onClick={() => selectEdge("left")}
            />
          </div>
          <div style={{ gridArea: "wall" }} className="w-full">
            <WallCanvas
              heightMm={partition.heightMm}
              panels={panels}
              selections={selections}
              selection={selection}
              onSelectPanel={selectPanel}
              onDoorHeightCommit={commitDoorHeight}
            />
          </div>
          <div style={{ gridArea: "right" }}>
            <EdgeProfile
              side="right"
              stops={partition.design?.stops}
              selections={selections}
              selection={selection}
              onClick={() => selectEdge("right")}
            />
          </div>
          <div style={{ gridArea: "bottom" }} className="w-full">
            <EdgeProfile
              side="bottom"
              stops={partition.design?.stops}
              selections={selections}
              selection={selection}
              onClick={() => selectEdge("bottom")}
            />
          </div>
        </div>
      </div>

      {/* Panel toolbar */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={addPanel}
          className="rounded-sm border border-border bg-bg-white px-3 py-1.5 text-xs font-bold text-text-body hover:border-primary"
        >
          {t("addPanel")}
        </button>
        <button
          type="button"
          onClick={removeSelectedPanel}
          disabled={removeDisabled}
          className="rounded-sm border border-border bg-bg-white px-3 py-1.5 text-xs font-bold text-text-body hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("removePanel")}
        </button>
        <button
          type="button"
          onClick={splitSelectedPanel}
          disabled={splitDisabled}
          className="rounded-sm border border-border bg-bg-white px-3 py-1.5 text-xs font-bold text-text-body hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("splitPanel")}
        </button>
      </div>

      <p className="text-center text-[10.5px] text-text-muted">{hint}</p>

      <PanelList panels={panels} selections={selections} selection={selection} onSelectPanel={selectPanel} />
    </div>
  );
}
