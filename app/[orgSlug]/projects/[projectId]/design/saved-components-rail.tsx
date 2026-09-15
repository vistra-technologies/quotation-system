"use client";

/**
 * Right rail in Configure mode — Saved Components.
 *
 * S21-0.4: migrated from immediate-write mutations (mutatePartition) to the
 * draft-state context (useDraftContext / dispatch). The `mutate`, `partition`,
 * and `selection` props are gone; this component reads them from the context.
 *
 * Track C (S21-C2) will rebuild the full UI to mockup parity.
 */

import { useTranslations } from "next-intl";
import { MIN_DOOR_HEIGHT_MM, DEFAULT_DOOR_HEIGHT_RATIO } from "./configure-constants";
import { useDraftContext } from "./design-draft-context";
import type { DesignPanel, SelectionRow } from "./types";

interface SavedComponentsRailProps {
  selections: SelectionRow[];
  // partition, selection, mutate — removed (S21-0.4). Use useDraftContext().
}

export function SavedComponentsRail({ selections }: SavedComponentsRailProps) {
  const t = useTranslations("design");
  const { state, dispatch } = useDraftContext();

  const partition = state.draft;
  const selection = state.selection;

  // error/busy state removed: dispatch is synchronous, no async error handling needed here.
  // Save errors are surfaced at the design-workspace.tsx level.

  if (!partition) {
    return <p className="text-xs text-text-muted">{t("loadingPartition")}</p>;
  }

  const glassSelections = selections.filter((s) => s.componentType.code === "GLASS");
  const doorSelections = selections.filter((s) => s.componentType.code === "DOOR");
  const profileSelections = selections.filter((s) => s.componentType.code === "PROFILE_STOP");
  const otherSelections = selections.filter(
    (s) => !["GLASS", "DOOR", "PROFILE_STOP"].includes(s.componentType.code ?? ""),
  );

  const busy = false; // Dispatch is synchronous — no async busy guard needed.
  const doorEnabled = selection?.type === "panel";
  const profileEnabled = selection?.type === "edge";

  const panels = partition.design?.panels ?? [];
  // For door/profile operations, the primary selected panel is the first panelId.
  const primaryPanelId = selection?.type === "panel" ? selection.panelIds[0] : undefined;
  const selectedPanel: DesignPanel | undefined = primaryPanelId
    ? panels.find((p) => p.id === primaryPanelId)
    : undefined;

  function isGlassActive(id: string): boolean {
    return panels.length > 0 && panels.every((p) => p.selectionId === id);
  }
  function isDoorActive(id: string): boolean {
    return !!selectedPanel?.door && selectedPanel.door.selectionId === id;
  }
  function isProfileActive(id: string): boolean {
    // partition! — non-null assertion safe here: functions are only called after
    // the early return guard above ensures partition is non-null.
    return selection?.type === "edge" && partition!.design?.stops?.[selection.side] === id;
  }

  function assignGlass(componentId: string) {
    if (busy) return;
    const allPanelIds = panels.map((p) => p.id);
    dispatch({ type: "SET_GLASS", panelIds: allPanelIds, selectionId: componentId });
  }

  function toggleDoor(componentId: string) {
    if (busy || selection?.type !== "panel") return;
    const panelId = selection.panelIds[0];
    const wallHeightMm = partition!.heightMm; // non-null: see isProfileActive comment
    const existingHeight = selectedPanel?.door?.outerFrame?.h;
    const heightMm = existingHeight
      ? Math.min(existingHeight, wallHeightMm)
      : Math.max(MIN_DOOR_HEIGHT_MM, Math.round(wallHeightMm * DEFAULT_DOOR_HEIGHT_RATIO));
    if (selectedPanel?.door && selectedPanel.door.selectionId === componentId) {
      // Same door already active — toggle off (remove).
      dispatch({ type: "TOGGLE_DOOR", panelId, selectionId: componentId });
    } else {
      // Different door (or no door). TOGGLE_DOOR is a pure toggle: present→remove,
      // absent→add. To *replace* an existing door with a different component we must
      // remove the old one first, then add the new one.
      if (selectedPanel?.door) {
        dispatch({ type: "TOGGLE_DOOR", panelId, selectionId: selectedPanel.door.selectionId });
      }
      // Panel now has no door — TOGGLE_DOOR adds it with the new selectionId.
      dispatch({ type: "TOGGLE_DOOR", panelId, selectionId: componentId });
      dispatch({ type: "SET_DOOR_HEIGHT", panelId, heightMm });
    }
  }

  function assignProfile(componentId: string) {
    if (busy || selection?.type !== "edge") return;
    // Track D (S21-D5) removes this UI section. Until then, dispatch SET_STOPS
    // so the edge-profile assignment defers to Save rather than doing an immediate write.
    dispatch({ type: "SET_STOPS", side: selection.side, selectionId: componentId });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">
        {t("selectionsTitle")}
      </h2>
      <p className="mb-3 text-[11px] text-text-muted">{t("savedComponentsFrom")}</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {glassSelections.length > 0 && (
          <ComponentSection
            title={t("sectionPartitions")}
            note={t("appliesEveryPanel")}
            comps={glassSelections}
            enabled={!busy}
            isActive={isGlassActive}
            onClick={assignGlass}
          />
        )}
        {doorSelections.length > 0 && (
          <ComponentSection
            title={t("sectionDoors")}
            comps={doorSelections}
            enabled={doorEnabled && !busy}
            isActive={isDoorActive}
            onClick={toggleDoor}
          />
        )}
        {profileSelections.length > 0 && (
          <ComponentSection
            title={t("sectionProfiles")}
            comps={profileSelections}
            enabled={profileEnabled && !busy}
            isActive={isProfileActive}
            onClick={assignProfile}
          />
        )}
        {otherSelections.length > 0 && (
          <ComponentSection
            title={t("sectionOther")}
            comps={otherSelections}
            enabled={false}
            isActive={() => false}
            onClick={() => {}}
          />
        )}
        {glassSelections.length === 0 &&
          doorSelections.length === 0 &&
          profileSelections.length === 0 &&
          otherSelections.length === 0 && (
            <p className="text-xs text-text-muted">
              {t("selectionsAvailable", { count: 0 })}
            </p>
          )}
      </div>
    </div>
  );
}

interface ComponentSectionProps {
  title: string;
  note?: string;
  comps: SelectionRow[];
  enabled: boolean;
  isActive: (id: string) => boolean;
  onClick: (id: string) => void;
}

function ComponentSection({ title, note, comps, enabled, isActive, onClick }: ComponentSectionProps) {
  return (
    <section className="mb-4">
      <h3 className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wide text-text-muted">
        {title}
      </h3>
      {note && <p className="mb-2 text-[10px] italic text-text-muted">{note}</p>}
      <div className="flex flex-col gap-1.5">
        {comps.map((comp) => {
          const active = enabled && isActive(comp.id);
          return (
            <button
              key={comp.id}
              type="button"
              disabled={!enabled}
              onClick={() => onClick(comp.id)}
              className={
                "flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors " +
                (active
                  ? "border-primary-dark bg-primary-softer"
                  : "border-border bg-bg-white hover:border-primary-soft") +
                (!enabled ? " cursor-not-allowed opacity-35" : "")
              }
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-bold text-text-heading">{comp.label}</span>
                <span className="truncate text-[10.5px] text-text-muted">
                  {comp.componentType.name}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
