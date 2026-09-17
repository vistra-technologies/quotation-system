"use client";

/**
 * Panel right-click context menu — S21-D3.
 *
 * Built on Track 0's ContextMenu primitive (components/context-menu.tsx).
 * Mockup ref: lines 431-462 (CSS), 1413-1469 (split/unite/equal-width logic),
 *             1736 (contextmenu binding), 1754-1869 (menu render).
 *
 * Items (in order):
 *   1. ⊞ Make equal width  — MAKE_EQUAL_WIDTH (preserves sum by design)
 *   2. ✂ Split the panel   — SPLIT_PANEL      (a.width + b.width = orig.width)
 *   3. ↔ Unite panels       — UNITE_PANELS     (merged.width = sum of targets)
 *   [divider]
 *   4. Apply width input    — SET_PANEL_WIDTHS_MAP (sum-preserving, see below)
 *   5. Standard-width row   — 997 / 697 / 397 mm
 *
 * No Exclude/Include item — removed per D-2 deviation.
 *
 * Sum invariant for Apply Width / Standard Width
 * -----------------------------------------------
 * The mockup naively sets targets' widths without adjusting neighbors, which
 * changes partition.widthMm on Save.  Per the stage spec, we must preserve
 *   sum(panels[].widthMm) === current total
 * after each operation.  We do this by:
 *   1. Computing newTargetTotal = newWidth × targetCount.
 *   2. Distributing the remainder (total − newTargetTotal) proportionally
 *      across non-target panels, with the last non-target absorbing the
 *      integer rounding residual (same last-absorbs-remainder pattern as
 *      SET_PARTITION_WIDTH in the reducer).
 *   3. Dispatching SET_PANEL_WIDTHS_MAP with the full width map so the
 *      reducer applies all changes in one atomic update.
 *
 * If the requested width is infeasible (all panels selected, or would push
 * non-targets below 1 mm each), Apply Width and Standard Widths are disabled.
 */

import { useTranslations } from "next-intl";
import {
  ContextMenu,
  ApplyWidthSlot,
  StandardWidthSlot,
  type ContextMenuEntry,
} from "@/components/context-menu";
import { useDraftContext } from "./design-draft-context";
import { MIN_SPLIT_WIDTH_MM } from "./configure-constants";
import type { DesignPanel } from "./types";

// Standard-width quick buttons — mirrors mockup line 1853: [997, 697, 397]
const STANDARD_WIDTHS_MM = [997, 697, 397];

interface PanelContextMenuProps {
  panelId: string;
  x: number;
  y: number;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true iff the given panel IDs form a contiguous (adjacent) run in the
 * panels array — mirrors mockup's `isContiguousSelection` (lines 1413-1445).
 *
 * Ported verbatim per task spec:
 *   - Single-panel (or empty) selection returns false (not "trivially contiguous").
 *   - Any panelId not found in panels (indices.length !== panelIds.length) returns false.
 */
function isContiguousSelection(panels: DesignPanel[], panelIds: string[]): boolean {
  if (panelIds.length < 2) return false;
  const indices = panelIds.map((id) => panels.findIndex((p) => p.id === id)).sort((a, b) => a - b);
  // Guard: all IDs must exist in panels (mirrors mockup lines 1440-1445).
  if (indices.length !== panelIds.length || indices[0] === -1) return false;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
}

/**
 * Compute a sum-preserving width map for Apply Width / Standard Width operations.
 *
 * Given:
 *   - panels:             the full current panel array
 *   - targetIds:          the panels whose width we want to set
 *   - newWidthPerTarget:  the requested width (mm) for each target
 *
 * Returns a Record<panelId, widthMm> for ALL panels (targets + non-targets)
 * such that sum of all values === sum of original panel widths.
 *
 * Returns null when the operation is infeasible:
 *   - All panels are targets (no non-targets to absorb the residual).
 *   - The non-target remainder after setting targets would be < 1 mm per
 *     non-target panel (would create zero-width or negative panels).
 */
function computeSumPreservingWidths(
  panels: DesignPanel[],
  targetIds: string[],
  newWidthPerTarget: number,
): Record<string, number> | null {
  const total = panels.reduce((s, p) => s + p.widthMm, 0);
  const nonTargets = panels.filter((p) => !targetIds.includes(p.id));

  if (nonTargets.length === 0) return null; // no room to redistribute

  const newTargetTotal = newWidthPerTarget * targetIds.length;
  const newNonTargetTotal = total - newTargetTotal;

  // Each non-target must be at least 1 mm after redistribution.
  if (newNonTargetTotal < nonTargets.length) return null;

  const result: Record<string, number> = {};

  // Set all targets to the requested width.
  for (const id of targetIds) {
    result[id] = newWidthPerTarget;
  }

  // Redistribute newNonTargetTotal among non-targets, proportional to their
  // current widths, with the last non-target absorbing the integer remainder —
  // same pattern as SET_PARTITION_WIDTH in design-draft-context.tsx.
  const oldNonTargetTotal = nonTargets.reduce((s, p) => s + p.widthMm, 0);

  if (oldNonTargetTotal === 0) {
    // Distribute equally (pathological: all non-targets had 0 width).
    const base = Math.floor(newNonTargetTotal / nonTargets.length);
    nonTargets.forEach((p, i) => {
      result[p.id] =
        i === nonTargets.length - 1
          ? newNonTargetTotal - base * (nonTargets.length - 1)
          : base;
    });
  } else {
    const scale = newNonTargetTotal / oldNonTargetTotal;
    // Do NOT clamp intermediates with Math.max(1, …): clamping an intermediate
    // upward inflates scaledSum, makes adjustment negative, and drives the last
    // absorber below 1 (which was then also clamped, silently breaking the sum).
    // Instead: compute raw rounded values, let the last absorber carry the residual,
    // and reject as infeasible if the last absorber's final value would be < 1 mm.
    const scaled = nonTargets.map((p) => Math.round(p.widthMm * scale));
    const scaledSum = scaled.reduce((s, w) => s + w, 0);
    const adjustment = newNonTargetTotal - scaledSum;
    const lastValue = scaled[nonTargets.length - 1] + adjustment;
    // Infeasibility: rounding of intermediates can shift enough residual onto the
    // last absorber to push it below 1 mm even when the budget check passed.
    if (lastValue < 1) return null;
    nonTargets.forEach((p, i) => {
      result[p.id] =
        i === nonTargets.length - 1 ? lastValue : scaled[i];
    });
  }

  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PanelContextMenu({
  panelId,
  x,
  y,
  onClose,
}: PanelContextMenuProps) {
  const t = useTranslations("design");
  const { state, dispatch } = useDraftContext();

  const panels = state.draft?.design?.panels ?? [];

  // The context-menu opened on `panelId`. Bulk actions apply to the whole
  // multi-selection when panelId is a member; otherwise just this panel.
  const selPanelIds =
    state.selection?.type === "panel" ? state.selection.panelIds : [panelId];
  const targetIds =
    selPanelIds.includes(panelId) && selPanelIds.length > 1
      ? selPanelIds
      : [panelId];
  const primaryPanel = panels.find((p) => p.id === panelId);
  const multi = targetIds.length > 1;

  // Enablement checks
  const canSplit =
    !multi &&
    !!primaryPanel &&
    primaryPanel.widthMm >= MIN_SPLIT_WIDTH_MM;

  const contiguous = isContiguousSelection(panels, targetIds);
  const canUnite = panels.length > 1 && (multi ? contiguous : panels.length >= 2);

  const primaryWidth = primaryPanel?.widthMm ?? 0;

  function dispatchApplyWidth(newWidth: number) {
    const widthMap = computeSumPreservingWidths(panels, targetIds, newWidth);
    if (!widthMap) return; // infeasible
    dispatch({ type: "SET_PANEL_WIDTHS_MAP", widths: widthMap });
  }

  // Build menu items
  const items: ContextMenuEntry[] = [
    {
      type: "item",
      icon: "⊞",
      label: t("ctxMakeEqualWidth"),
      onClick: () => dispatch({ type: "MAKE_EQUAL_WIDTH", panelIds: targetIds }),
    },
    {
      type: "item",
      icon: "✂",
      label: t("ctxSplit"),
      onClick: () => {
        if (!primaryPanel) return;
        dispatch({ type: "SPLIT_PANEL", panelId: primaryPanel.id });
      },
      disabled: !canSplit,
    },
    {
      type: "item",
      icon: "↔",
      label: multi ? t("ctxUnitePanels") : t("ctxUnitePanel"),
      onClick: () => {
        if (multi) {
          dispatch({ type: "UNITE_PANELS", panelIds: targetIds });
        } else {
          // Single panel: unite with its neighbor (first available)
          const idx = panels.findIndex((p) => p.id === panelId);
          if (idx === -1) return;
          const neighborIdx = idx < panels.length - 1 ? idx + 1 : idx - 1;
          const neighborId = panels[neighborIdx]?.id;
          if (!neighborId) return;
          // Unite the two in index order
          const orderedIds =
            idx < neighborIdx ? [panelId, neighborId] : [neighborId, panelId];
          dispatch({ type: "UNITE_PANELS", panelIds: orderedIds });
        }
      },
      disabled: !canUnite,
      disabledTitle: multi && !contiguous ? t("ctxOnlyAdjacentUnite") : undefined,
    },
    { type: "divider" },
    {
      type: "custom",
      content: (
        <ApplyWidthSlot
          label={t("ctxApplyWidth")}
          initialValue={primaryWidth}
          onApply={(w) => {
            dispatchApplyWidth(w);
            onClose();
          }}
        />
      ),
    },
    {
      type: "custom",
      content: (
        <StandardWidthSlot
          label={t("ctxStandardWidth")}
          widths={STANDARD_WIDTHS_MM}
          onApply={(w) => dispatchApplyWidth(w)}
          onClose={onClose}
        />
      ),
    },
  ];

  return <ContextMenu anchorX={x} anchorY={y} items={items} onClose={onClose} />;
}
