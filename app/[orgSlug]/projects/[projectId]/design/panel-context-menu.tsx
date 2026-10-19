"use client";

/**
 * Panel right-click context menu — S21-D3, reworked for Stage 34 (explicit apply + lock).
 *
 * Built on Track 0's ContextMenu primitive (components/context-menu.tsx).
 *
 * Items (in order):
 *   1. Lock panel / Unlock panel — SET_PANEL_LOCKED (Stage 34 S34-3)
 *   2. Make equal width          — MAKE_EQUAL_WIDTH (unlocked panels only; D-14 scope)
 *   3. Split the panel           — SPLIT_PANEL
 *   4. Unite panels              — UNITE_PANELS
 *   [divider]
 *   5. Apply width input + tick  — SET_PANEL_WIDTH (applies only via tick / Enter, S34-2)
 *   6. Standard-width row        — 25% / 35% / 50% of the wall's width, same action
 *
 * No Exclude/Include item — removed per D-2 deviation.
 *
 * All width redistribution lives in lib/panel-widths.ts (one module, unit tested); this menu only
 * pre-validates with the same planner so a refusal shows inline and keeps the menu open. The reducer
 * runs the planner again and is the authority.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ContextMenu,
  ApplyWidthSlot,
  StandardWidthSlot,
  type ContextMenuEntry,
} from "@/components/context-menu";
import { planSetWidths } from "@/lib/panel-widths";
import { useDraftContext } from "./design-draft-context";
import { MIN_SPLIT_WIDTH_MM } from "./configure-constants";
import { LockIcon, UnlockIcon } from "./lock-icons";
import type { DesignPanel } from "./types";

// Standard-width quick buttons — proportional to the partition's current
// total width rather than fixed mm values, so they stay meaningful across
// partitions of very different sizes.
const STANDARD_WIDTH_FRACTIONS = [0.25, 0.35, 0.5];

interface PanelContextMenuProps {
  panelId: string;
  x: number;
  y: number;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true iff the given panel IDs form a contiguous (adjacent) run in the
 * panels array — mirrors mockup's `isContiguousSelection`.
 *   - Single-panel (or empty) selection returns false (not "trivially contiguous").
 *   - Any panelId not found in panels (indices.length !== panelIds.length) returns false.
 */
function isContiguousSelection(panels: DesignPanel[], panelIds: string[]): boolean {
  if (panelIds.length < 2) return false;
  const indices = panelIds.map((id) => panels.findIndex((p) => p.id === id)).sort((a, b) => a - b);
  if (indices.length !== panelIds.length || indices[0] === -1) return false;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
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
  // Inline refusal text for the width rows (keeps the menu open, S34-2).
  const [error, setError] = useState<string | null>(null);

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
  const targets = panels.filter((p) => targetIds.includes(p.id));
  const allLocked = targets.length > 0 && targets.every((p) => p.locked);

  // Enablement checks
  // Stage 34 (D-17/D-18): items that would change a locked panel are greyed ("Panel is locked"); the
  // reducer's freeze guard (lib/panel-freeze.ts) is the authority, this only mirrors it for UX.
  const lockedTitle = t("panelIsLocked");
  const canSplit =
    !multi &&
    !!primaryPanel &&
    !primaryPanel.locked &&
    primaryPanel.widthMm >= MIN_SPLIT_WIDTH_MM;

  const contiguous = isContiguousSelection(panels, targetIds);
  // Single panel: unite with the first UNLOCKED neighbour (next, then previous); multi: the whole
  // contiguous range must be unlocked.
  const panelIdx = panels.findIndex((p) => p.id === panelId);
  const uniteNeighbourIdx = [panelIdx + 1, panelIdx - 1].find((k) => k >= 0 && k < panels.length && !panels[k]!.locked);
  const uniteLocked = multi
    ? targets.some((p) => p.locked)
    : !!primaryPanel?.locked || uniteNeighbourIdx === undefined;
  const canUnite = panels.length > 1 && (multi ? contiguous : panels.length >= 2) && !uniteLocked;

  const primaryWidth = primaryPanel?.widthMm ?? 0;
  const totalWidthMm = panels.reduce((s, p) => s + p.widthMm, 0);
  const standardWidths = STANDARD_WIDTH_FRACTIONS.map((f) => Math.round(totalWidthMm * f));

  /** Apply a width to the targets: pre-validate, then dispatch and close; else show the error. */
  function applyWidth(widthMm: number) {
    if (!Number.isFinite(widthMm)) {
      setError(t("widthRefusalINVALID"));
      return;
    }
    const width = Math.round(widthMm);
    // The planner decides "unchanged" for ALL targets: an empty plan just closes (no lock), and in a
    // multi-selection the targets that differ still get the width.
    // Locked targets are skipped (the reducer's freeze guard narrows the same way and the canvas notice
    // counts them); with nothing left to edit the menu says so inline.
    const editableIds = targetIds.filter((id) => !panels.find((p) => p.id === id)?.locked);
    if (editableIds.length === 0) {
      setError(t("panelIsLocked"));
      return;
    }
    const plan = planSetWidths(panels, editableIds, width);
    if (!plan.ok) {
      setError(t(`widthRefusal${plan.reason}`));
      return;
    }
    if (Object.keys(plan.widths).length > 0 || plan.lockIds.length > 0) {
      dispatch({ type: "SET_PANEL_WIDTH", panelIds: targetIds, widthMm: width });
    }
    onClose();
  }

  // Build menu items
  const items: ContextMenuEntry[] = [
    {
      type: "item",
      icon: allLocked ? <UnlockIcon /> : <LockIcon />,
      label: allLocked
        ? multi ? t("ctxUnlockPanels") : t("ctxUnlockPanel")
        : multi ? t("ctxLockPanels") : t("ctxLockPanel"),
      onClick: () =>
        dispatch({ type: "SET_PANEL_LOCKED", panelIds: targetIds, locked: !allLocked }),
    },
    {
      type: "item",
      icon: "⊞",
      label: t("ctxMakeEqualWidth"),
      // Multi-select: only the selected panels. Single panel: the whole wall (D-14).
      onClick: () => dispatch({ type: "MAKE_EQUAL_WIDTH", panelIds: multi ? targetIds : [] }),
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
      disabledTitle: primaryPanel?.locked ? lockedTitle : undefined,
    },
    {
      type: "item",
      icon: "↔",
      label: multi ? t("ctxUnitePanels") : t("ctxUnitePanel"),
      onClick: () => {
        if (multi) {
          dispatch({ type: "UNITE_PANELS", panelIds: targetIds });
        } else {
          // Single panel: unite with its first unlocked neighbour (D-18), in index order.
          const idx = panelIdx;
          if (idx === -1 || uniteNeighbourIdx === undefined) return;
          const neighborId = panels[uniteNeighbourIdx]?.id;
          if (!neighborId) return;
          const orderedIds =
            idx < uniteNeighbourIdx ? [panelId, neighborId] : [neighborId, panelId];
          dispatch({ type: "UNITE_PANELS", panelIds: orderedIds });
        }
      },
      disabled: !canUnite,
      disabledTitle:
        multi && !contiguous
          ? t("ctxOnlyAdjacentUnite")
          : uniteLocked
            ? lockedTitle
            : undefined,
    },
    { type: "divider" },
    {
      type: "custom",
      content: (
        <ApplyWidthSlot
          label={t("ctxApplyWidth")}
          tickLabel={t("applyWidthTick")}
          initialValue={primaryWidth}
          error={error}
          onDraftChange={() => setError(null)}
          onApply={(w) => applyWidth(w)}
        />
      ),
    },
    {
      type: "custom",
      content: (
        <StandardWidthSlot
          label={t("ctxStandardWidth")}
          widths={standardWidths}
          onApply={(w) => applyWidth(w)}
        />
      ),
    },
  ];

  return <ContextMenu anchorX={x} anchorY={y} items={items} onClose={onClose} />;
}
