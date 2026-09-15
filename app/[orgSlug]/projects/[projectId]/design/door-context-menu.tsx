"use client";

/**
 * Door right-click context menu — S21-D4.
 *
 * Built on Track 0's ContextMenu primitive (components/context-menu.tsx).
 * Mockup ref: line 1714 (door contextmenu binding), lines 1874-1914 (render).
 *
 * Shows two items — Left hinge / Right hinge — with a ✓ marker on the
 * currently active side.  Dispatches SET_DOOR_HINGE to update the draft.
 * The canvas re-renders immediately (the swing arc mirrors the new value).
 *
 * Hinging field lives inline on design.panels[].door (v1 data shape, tracked
 * as follow-up F-4 in 04-data-model.md — kept inline for Stage 21 per the
 * architect's working assumption).
 */

import { useTranslations } from "next-intl";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { useDraftContext } from "./design-draft-context";

interface DoorContextMenuProps {
  panelId: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function DoorContextMenu({
  panelId,
  x,
  y,
  onClose,
}: DoorContextMenuProps) {
  const t = useTranslations("design");
  const { state, dispatch } = useDraftContext();

  const panels = state.draft?.design?.panels ?? [];
  const panel = panels.find((p) => p.id === panelId);

  // If the panel has no door (shouldn't happen normally), render nothing.
  if (!panel?.door) return null;

  const currentHinge = panel.door.hinging ?? "left";

  const items: ContextMenuEntry[] = [
    {
      type: "item",
      icon: "⇤",
      label: t("ctxHingeLeft") + (currentHinge === "left" ? " ✓" : ""),
      onClick: () => dispatch({ type: "SET_DOOR_HINGE", panelId, hinging: "left" }),
    },
    {
      type: "item",
      icon: "⇥",
      label: t("ctxHingeRight") + (currentHinge === "right" ? " ✓" : ""),
      onClick: () => dispatch({ type: "SET_DOOR_HINGE", panelId, hinging: "right" }),
    },
  ];

  return <ContextMenu anchorX={x} anchorY={y} items={items} onClose={onClose} />;
}
