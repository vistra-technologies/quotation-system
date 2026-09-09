"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { useUnit } from "./unit-context";
import { WallCanvas } from "./wall-canvas";
import { PanelList } from "./panel-list";
import { EdgeProfile, EDGE_LABEL_KEY } from "./edge-profile";
import { DEFAULT_PANEL_WIDTH_MM, MIN_SPLIT_WIDTH_MM } from "./configure-constants";
import type {
  ConfigureSelection,
  DesignPanel,
  EdgeSide,
  MutateResult,
  PartitionPatch,
  PartitionRow,
  SelectionRow,
} from "./types";

interface ConfigureModeProps {
  partition: PartitionRow;
  selections: SelectionRow[];
  floorLabel: string;
  roomLabel: string;
  selection: ConfigureSelection;
  onSelectionChange: (selection: ConfigureSelection) => void;
  onBack: () => void;
  /** Every mutation re-reads the partition fresh from the server before
   * building its PATCH body (see design-workspace.tsx's mutatePartition) —
   * the binding condition architect-review-item7.md attached to client-side
   * mutation transport for any full-document write, ported from Piece 1's
   * convert-side-form.tsx. */
  mutate: (build: (fresh: PartitionRow) => PartitionPatch) => Promise<MutateResult>;
}

/**
 * Configure mode — the wall/panel editor. Mirrors design-step-poc.html's
 * `renderConfigureMode`/`renderCanvas`: a consolidated toolbar row (back,
 * name, floor/panel tags, dimensions), a to-scale wall canvas with 4
 * edge-profile pickers around it, add/remove/split-panel controls, a
 * contextual hint line, and the itemized panel list.
 */
export function ConfigureMode({
  partition,
  selections,
  floorLabel,
  roomLabel,
  selection,
  onSelectionChange,
  onBack,
  mutate,
}: ConfigureModeProps) {
  const t = useTranslations("design");
  const { unit, toDisplay, fromDisplay } = useUnit();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nameValue, setNameValue] = useState(partition.label);
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");

  // Reset local drafts when a DIFFERENT partition becomes active (not on
  // every prop update from this same partition, which would clobber
  // in-progress typing) — same "adjust state during render" pattern
  // room-name-input.tsx / convert-side-form.tsx already use.
  const [prevPartitionId, setPrevPartitionId] = useState(partition.id);
  if (prevPartitionId !== partition.id) {
    setPrevPartitionId(partition.id);
    setNameValue(partition.label);
    setWidthText("");
    setHeightText("");
  }
  // Unit-toggle change: clear the raw text mirrors so the display re-derives
  // from the same canonical mm through the new unit (convert-side-form.tsx's
  // fixed pattern — never reinterpret stale digits through fromDisplay()).
  const [prevUnit, setPrevUnit] = useState(unit);
  if (prevUnit !== unit) {
    setPrevUnit(unit);
    setWidthText("");
    setHeightText("");
  }

  async function run(build: (fresh: PartitionRow) => PartitionPatch): Promise<MutateResult> {
    setBusy(true);
    setError(null);
    const result = await mutate(build);
    if (!result.ok) setError(result.error);
    setBusy(false);
    return result;
  }

  async function commitName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === partition.label) {
      setNameValue(partition.label);
      return;
    }
    const result = await run(() => ({ label: trimmed }));
    if (!result.ok) setNameValue(partition.label);
  }

  async function commitWidth() {
    const parsed = Number(widthText);
    if (widthText === "" || isNaN(parsed) || parsed <= 0) {
      setWidthText("");
      return;
    }
    const newTotalMm = Math.round(fromDisplay(parsed));
    setWidthText("");
    await run((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      const oldTotalMm = freshPanels.reduce((sum, p) => sum + p.widthMm, 0) || 1;
      const scale = newTotalMm / oldTotalMm;
      const nextPanels = freshPanels.map((p) => ({
        ...p,
        widthMm: Math.max(1, Math.round(p.widthMm * scale)),
      }));
      return { design: { panels: nextPanels } };
    });
  }

  async function commitHeight() {
    const parsed = Number(heightText);
    if (heightText === "" || isNaN(parsed) || parsed <= 0) {
      setHeightText("");
      return;
    }
    const newHeightMm = Math.round(fromDisplay(parsed));
    setHeightText("");
    await run((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      // Clamp any door heights that now exceed the new (shorter) wall height
      // — mirrors design-step-poc.html:1086.
      const nextPanels = freshPanels.map((p): DesignPanel => {
        if (!p.door) return p;
        const currentH = p.door.outerFrame?.h ?? newHeightMm;
        const clampedH = Math.min(currentH, newHeightMm);
        return {
          ...p,
          door: { ...p.door, outerFrame: { w: p.door.outerFrame?.w ?? p.widthMm, h: clampedH } },
        };
      });
      return { heightMm: newHeightMm, design: { panels: nextPanels } };
    });
  }

  function selectPanel(panelId: string) {
    onSelectionChange(
      selection?.type === "panel" && selection.panelId === panelId
        ? null
        : { type: "panel", panelId },
    );
  }
  function selectEdge(side: EdgeSide) {
    onSelectionChange(
      selection?.type === "edge" && selection.side === side ? null : { type: "edge", side },
    );
  }

  function addPanel() {
    void run((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      const newPanel: DesignPanel = {
        id: crypto.randomUUID(),
        type: "glass",
        widthMm: DEFAULT_PANEL_WIDTH_MM,
        heightMm: fresh.heightMm,
        selectionId: null,
      };
      return { design: { panels: [...freshPanels, newPanel] } };
    });
  }

  function removeSelectedPanel() {
    if (selection?.type !== "panel") return;
    const panelId = selection.panelId;
    void run((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      if (freshPanels.length <= 1) return {};
      return { design: { panels: freshPanels.filter((p) => p.id !== panelId) } };
    }).then((result) => {
      if (result.ok) onSelectionChange(null);
    });
  }

  function splitSelectedPanel() {
    if (selection?.type !== "panel") return;
    const panelId = selection.panelId;
    let firstHalfId: string | undefined;
    void run((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      const idx = freshPanels.findIndex((p) => p.id === panelId);
      if (idx === -1) return {};
      const panel = freshPanels[idx];
      if (panel.widthMm < MIN_SPLIT_WIDTH_MM) return {};
      const halfA = Math.floor(panel.widthMm / 2);
      const halfB = panel.widthMm - halfA;
      firstHalfId = crypto.randomUUID();
      const secondHalfId = crypto.randomUUID();
      const nextPanels = [...freshPanels];
      nextPanels.splice(
        idx,
        1,
        { id: firstHalfId, type: "glass", widthMm: halfA, heightMm: panel.heightMm, selectionId: null },
        { id: secondHalfId, type: "glass", widthMm: halfB, heightMm: panel.heightMm, selectionId: null },
      );
      return { design: { panels: nextPanels } };
    }).then((result) => {
      if (result.ok && firstHalfId) onSelectionChange({ type: "panel", panelId: firstHalfId });
    });
  }

  function commitDoorHeight(panelId: string, heightMm: number) {
    void run((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      const nextPanels = freshPanels.map((p) => {
        if (p.id !== panelId || !p.door) return p;
        return {
          ...p,
          door: { ...p.door, outerFrame: { w: p.door.outerFrame?.w ?? p.widthMm, h: heightMm } },
        };
      });
      return { design: { panels: nextPanels } };
    });
  }

  const panels = partition.design?.panels ?? [];
  const selectedPanel =
    selection?.type === "panel" ? panels.find((p) => p.id === selection.panelId) : undefined;
  const removeDisabled = !selectedPanel || panels.length <= 1;
  const splitDisabled = !selectedPanel || selectedPanel.widthMm < MIN_SPLIT_WIDTH_MM;

  const widthDisplay = widthText !== "" ? widthText : String(toDisplay(partition.widthMm));
  const heightDisplay = heightText !== "" ? heightText : String(toDisplay(partition.heightMm));

  let hint: string;
  if (!selection) hint = t("hintNone");
  else if (selection.type === "panel") hint = t("hintPanel");
  else hint = t("hintEdge", { side: t(EDGE_LABEL_KEY[selection.side]) });

  return (
    <div className="relative flex w-full max-w-2xl flex-col gap-4">
      <LoadingOverlay visible={busy} />
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}

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
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") setNameValue(partition.label);
          }}
          className="rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-base font-extrabold text-text-heading hover:border-border focus:border-primary focus:bg-bg-white focus:outline-none"
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
            onBlur={() => void commitWidth()}
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
            onBlur={() => void commitHeight()}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-20 rounded-sm border border-border bg-bg-white px-2 py-1 text-xs text-text-body focus:border-primary focus:outline-none"
          />
          {unit}
        </label>
      </div>

      {/* Canvas + edge profiles — background click clears selection, mirrors
          design-step-poc.html's `canvasWrap` click listener. */}
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
