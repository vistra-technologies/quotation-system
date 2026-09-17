"use client";

/**
 * Right rail in Configure mode — Saved Components.
 *
 * S21-0.4: migrated from immediate-write mutations (mutatePartition) to the
 * draft-state context (useDraftContext / dispatch). The `mutate`, `partition`,
 * and `selection` props are gone; this component reads them from the context.
 *
 * S21-C2: fixed doorEnabled to require exactly one panel selected (not just
 * any panel selection). Active-state highlighting, heading/note copy, and
 * comp-card structure updated to mockup parity (lines 567-599, 1964-1996,
 * 2038-2054).
 *
 * S21-C3: Door Height slider — shown only when exactly one door-bearing panel
 * is selected. Dispatches SET_DOOR_HEIGHT on every input event so the canvas
 * updates live while dragging; numeric readout updates alongside the thumb.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
// MIN_DOOR_HEIGHT_MM / DEFAULT_DOOR_HEIGHT_RATIO removed from import — Bug 12
// changed the door default to full wall height and slider min to 0, making
// both constants unused in this file. configure-constants.ts is unchanged.
import { useDraftContext } from "./design-draft-context";
import { useUnit } from "./unit-context";
import type { DesignPanel, SelectionRow } from "./types";

interface SavedComponentsRailProps {
  selections: SelectionRow[];
  // partition, selection, mutate — removed (S21-0.4). Use useDraftContext().
}

export function SavedComponentsRail({ selections }: SavedComponentsRailProps) {
  const t = useTranslations("design");
  const { formatLen } = useUnit();
  const { state, dispatch } = useDraftContext();

  const partition = state.draft;
  const selection = state.selection;

  if (!partition) {
    return <p className="text-xs text-text-muted">{t("loadingPartition")}</p>;
  }

  const glassSelections = selections.filter((s) => s.componentType.code === "GLASS");
  const doorSelections = selections.filter((s) => s.componentType.code === "DOOR");
  const profileSelections = selections.filter((s) => s.componentType.code === "PROFILE_STOP");
  const otherSelections = selections.filter(
    (s) => !["GLASS", "DOOR", "PROFILE_STOP"].includes(s.componentType.code ?? ""),
  );

  // Glass: always enabled (whole-wall property — applies to every panel).
  // Doors: enabled ONLY when exactly one panel is selected (mockup line 2083:
  //   `const doorEnabled = !!soloPanelId` where soloPanelId requires length===1).
  const soloPanelId =
    selection?.type === "panel" && selection.panelIds.length === 1
      ? selection.panelIds[0]
      : undefined;
  const doorEnabled = soloPanelId !== undefined;
  const profileEnabled = selection?.type === "edge";

  const panels = partition.design?.panels ?? [];
  const selectedPanel: DesignPanel | undefined = soloPanelId
    ? panels.find((p) => p.id === soloPanelId)
    : undefined;

  // C3: Door Height slider — shown only when exactly one door-bearing panel is selected.
  const hasDoorHeightControl = !!(selectedPanel?.door);

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
    const allPanelIds = panels.map((p) => p.id);
    dispatch({ type: "SET_GLASS", panelIds: allPanelIds, selectionId: componentId });
  }

  function toggleDoor(componentId: string) {
    if (!soloPanelId) return;
    const wallHeightMm = partition!.heightMm;
    const existingHeight = selectedPanel?.door?.outerFrame?.h;
    // Bug 12: new door defaults to FULL wall height (bugs-3.md: "the default
    // should be fully occupied"). Previously defaulted to 0.85 * wallHeight.
    // existingHeight path unchanged — preserves the height when switching doors.
    const heightMm = existingHeight
      ? Math.min(existingHeight, wallHeightMm)
      : wallHeightMm;
    if (selectedPanel?.door && selectedPanel.door.selectionId === componentId) {
      // Same door already active — toggle off (remove).
      dispatch({ type: "TOGGLE_DOOR", panelId: soloPanelId, selectionId: componentId });
    } else {
      // Different door (or no door). Replace: remove old first, then add new.
      if (selectedPanel?.door) {
        dispatch({ type: "TOGGLE_DOOR", panelId: soloPanelId, selectionId: selectedPanel.door.selectionId });
      }
      dispatch({ type: "TOGGLE_DOOR", panelId: soloPanelId, selectionId: componentId });
      dispatch({ type: "SET_DOOR_HEIGHT", panelId: soloPanelId, heightMm });
    }
  }

  function assignProfile(componentId: string) {
    if (selection?.type !== "edge") return;
    // Track D (S21-D5) removes this UI section. Until then, dispatch SET_STOPS
    // so the edge-profile assignment defers to Save rather than doing an immediate write.
    dispatch({ type: "SET_STOPS", side: selection.side, selectionId: componentId });
  }

  // C3: Door height slider values
  const wallHeightMm = partition.heightMm;
  const currentDoorHeightMm = selectedPanel?.door?.outerFrame?.h ?? wallHeightMm;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Heading + sub — mirrors renderConfigureSidebar lines 2045-2047 */}
      <h2 className="mb-0.5 text-xs font-bold uppercase tracking-wider text-text-muted">
        {t("selectionsTitle")}
      </h2>
      <p className="mb-3.5 text-[11.5px] text-text-muted">{t("savedComponentsFrom")}</p>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
        {/* Partitions (glass) — always enabled */}
        {glassSelections.length > 0 && (
          <ComponentSection
            title={t("sectionPartitions")}
            note={t("appliesEveryPanel")}
            comps={glassSelections}
            enabled={true}
            isActive={isGlassActive}
            onClick={assignGlass}
          />
        )}

        {/* Doors — enabled only when exactly one panel is selected */}
        {doorSelections.length > 0 && (
          <ComponentSection
            title={t("sectionDoors")}
            comps={doorSelections}
            enabled={doorEnabled}
            isActive={isDoorActive}
            onClick={toggleDoor}
          />
        )}

        {/* C3: Door Height slider — only when one door-bearing panel is selected */}
        {hasDoorHeightControl && soloPanelId && (
          <section className="mb-4">
            <h3 className="mb-0.5 text-[10.5px] font-bold uppercase tracking-[.04em] text-text-muted">
              {t("sectionDoorHeight")}
            </h3>
            <div className="flex items-center gap-2.5">
              {/* Bug 12: min={0} — user must be able to slide all the way to zero.
                  Previously MIN_DOOR_HEIGHT_MM (914mm) was the floor, preventing
                  low-door configurations. */}
              <input
                type="range"
                min={0}
                max={wallHeightMm}
                value={currentDoorHeightMm}
                // Dispatch on every input event so the canvas door graphic
                // updates live while dragging (mockup line 2070-2076). The
                // draft reducer's SET_DOOR_HEIGHT is synchronous — no network
                // write until Save. Only the components consuming draft.design.panels
                // re-render; the rest of the workspace is unaffected.
                onInput={(e) => {
                  const heightMm = parseInt((e.target as HTMLInputElement).value, 10);
                  dispatch({ type: "SET_DOOR_HEIGHT", panelId: soloPanelId, heightMm });
                }}
                onChange={() => {
                  // onChange fires on release — the onInput dispatch above has
                  // already committed the value; nothing extra needed here. The
                  // event handler is present to satisfy React's controlled-input
                  // contract (onInput alone doesn't suppress the warning).
                }}
                className="min-w-0 flex-1 accent-primary"
              />
              <span className="min-w-[52px] text-right text-xs font-bold text-text-heading">
                {formatLen(currentDoorHeightMm)}
              </span>
            </div>
          </section>
        )}

        {/* Profiles — Track D (S21-D5) removes this section */}
        {profileSelections.length > 0 && (
          <ComponentSection
            title={t("sectionProfiles")}
            comps={profileSelections}
            enabled={profileEnabled}
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

/**
 * A list of component cards — mirrors renderCompList (lines 1964-1993) and
 * the comp-item / comp-icon / comp-text / comp-edit structure (lines 567-581).
 *
 * Bug 10: The ✎ pencil icon is replaced with an ⓘ info icon.
 *   Clicking it opens a small popover listing the saved config key-value pairs
 *   so the user can inspect what's configured without triggering any edit action.
 *   Info icon has the same hover treatment as a delete/action icon (visual
 *   feedback on hover) per the user's request: "same thing over here" referencing
 *   the delete icon's hover state at bugs-3.md timestamp 14:26.
 */
function ComponentSection({ title, note, comps, enabled, isActive, onClick }: ComponentSectionProps) {
  const [openInfoId, setOpenInfoId] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close the popover when the user clicks outside it.
  useEffect(() => {
    if (!openInfoId) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenInfoId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openInfoId]);

  return (
    <section className="mb-4 last:mb-1">
      <h3 className="mb-0.5 text-[10.5px] font-bold uppercase tracking-[.04em] text-text-muted">
        {title}
      </h3>
      {note && <p className="mb-2 text-[10px] italic text-text-muted">{note}</p>}
      <div className="flex flex-col gap-1.5">
        {comps.map((comp) => {
          const active = enabled && isActive(comp.id);
          const iconChar = comp.label.charAt(0).toUpperCase();
          const isInfoOpen = openInfoId === comp.id;

          // Format a config key as a human-readable label (camelCase / snake_case → words).
          const formatKey = (k: string) =>
            k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()).trim();

          const configEntries = Object.entries(comp.config ?? {}).filter(
            ([, v]) => v !== null && v !== "" && v !== false,
          );

          return (
            <div key={comp.id} className="relative">
              <div
                className={
                  "flex items-center gap-2.5 rounded-[7px] border px-2.5 py-2 transition-colors duration-150 " +
                  (active
                    ? "border-primary bg-primary-softer"
                    : enabled
                    ? "border-border bg-bg-white hover:border-primary hover:bg-[#f7fbf7]"
                    : "border-border bg-bg-white") +
                  (!enabled ? " opacity-35" : "")
                }
              >
                {/* Clickable area: icon + name (assigns the component) */}
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => onClick(comp.id)}
                  className={"flex min-w-0 flex-1 items-center gap-2.5 text-left" + (!enabled ? " cursor-not-allowed" : "")}
                >
                  {/* comp-icon */}
                  <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[6px] border border-[#d8dcd0] bg-[#fbfcf9] text-xs">
                    {iconChar}
                  </span>
                  {/* comp-text */}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-bold text-text-heading">{comp.label}</span>
                    <span className="truncate text-[10.5px] text-text-muted">
                      {comp.componentType.name}
                    </span>
                  </span>
                </button>

                {/* Bug 10: info/eye icon — replaces the non-functional ✎ pencil.
                    Opens a read-only config popover. Hover state mirrors the
                    delete icon's hover treatment: color shift on :hover. */}
                <button
                  type="button"
                  title="View configuration"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenInfoId(isInfoOpen ? null : comp.id);
                  }}
                  className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] text-[#b7bcae] transition-colors hover:bg-primary-softer hover:text-primary-dark"
                >
                  {/* Eye/info SVG icon */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="8" strokeWidth="2.5" />
                    <line x1="12" y1="12" x2="12" y2="16" />
                  </svg>
                </button>
              </div>

              {/* Read-only config popover */}
              {isInfoOpen && (
                <div
                  ref={popoverRef}
                  className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[180px] max-w-[240px] rounded-md border border-border bg-bg-white p-3 shadow-[0_8px_24px_-8px_rgba(27,40,30,0.22)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[.06em] text-text-muted">
                    {comp.label}
                  </p>
                  {configEntries.length === 0 ? (
                    <p className="text-[10.5px] text-text-muted italic">No configuration saved.</p>
                  ) : (
                    <dl className="flex flex-col gap-1">
                      {configEntries.map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-1.5">
                          <dt className="shrink-0 text-[10px] text-text-muted">{formatKey(k)}:</dt>
                          <dd className="min-w-0 truncate text-[10.5px] font-semibold text-text-heading">
                            {String(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
