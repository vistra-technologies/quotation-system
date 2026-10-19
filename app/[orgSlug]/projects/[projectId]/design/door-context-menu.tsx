"use client";

/**
 * Door right-click context menu — S21-D4.
 *
 * Built on Track 0's ContextMenu primitive (components/context-menu.tsx).
 * Mockup ref: line 1714 (door contextmenu binding), lines 1874-1914 (render).
 *
 * Items: Lock / Unlock panel FIRST (Stage 34 — every door menu, double leaf included), then for a
 * single-leaf door Left hinge / Right hinge with a ✓ marker on the active side (SET_DOOR_HINGE). A
 * double leaf is hinged at both jambs, so its menu is the lock item only. On a locked panel the hinge
 * items are greyed ("Panel is locked"); the reducer's freeze guard is the authority.
 * The canvas re-renders immediately (the swing arc mirrors the new value).
 *
 * Hinging field lives inline on design.panels[].door (v1 data shape, tracked
 * as follow-up F-4 in 04-data-model.md — kept inline for Stage 21 per the
 * architect's working assumption).
 */

import { useTranslations } from "next-intl";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { useDraftContext } from "./design-draft-context";
import { LockIcon, UnlockIcon } from "./lock-icons";

interface DoorContextMenuProps {
  panelId: string;
  x: number;
  y: number;
  /** Double-leaf door: no hinge side to switch, so only the lock item is shown. */
  isDouble?: boolean;
  onClose: () => void;
}

export function DoorContextMenu({
  panelId,
  x,
  y,
  isDouble = false,
  onClose,
}: DoorContextMenuProps) {
  const t = useTranslations("design");
  const { state, dispatch } = useDraftContext();

  const panels = state.draft?.design?.panels ?? [];
  const panel = panels.find((p) => p.id === panelId);

  // If the panel has no door (shouldn't happen normally), render nothing.
  if (!panel?.door) return null;

  const currentHinge = panel.door.hinging ?? "left";

  // Stage 21 QA bug #15: door height is NOT edited here — a working slider
  // for it already exists in the right rail (saved-components-rail.tsx's
  // Track C3 "Door Height" control, shown whenever exactly one door-bearing
  // panel is selected). An earlier fix pass added a redundant/duplicate
  // height input to this menu, which only added confusion — removed.
  const locked = !!panel.locked;
  const items: ContextMenuEntry[] = [
    {
      type: "item",
      icon: locked ? <UnlockIcon /> : <LockIcon />,
      label: locked ? t("ctxUnlockPanel") : t("ctxLockPanel"),
      onClick: () => dispatch({ type: "SET_PANEL_LOCKED", panelIds: [panelId], locked: !locked }),
    },
    ...(isDouble
      ? []
      : ([
          { type: "divider" },
          {
            type: "item",
            icon: "⇤",
            label: t("ctxHingeLeft") + (currentHinge === "left" ? " ✓" : ""),
            onClick: () => dispatch({ type: "SET_DOOR_HINGE", panelId, hinging: "left" }),
            disabled: locked,
            disabledTitle: locked ? t("panelIsLocked") : undefined,
          },
          {
            type: "item",
            icon: "⇥",
            label: t("ctxHingeRight") + (currentHinge === "right" ? " ✓" : ""),
            onClick: () => dispatch({ type: "SET_DOOR_HINGE", panelId, hinging: "right" }),
            disabled: locked,
            disabledTitle: locked ? t("panelIsLocked") : undefined,
          },
        ] as ContextMenuEntry[])),
  ];

  return <ContextMenu anchorX={x} anchorY={y} items={items} onClose={onClose} />;
}
