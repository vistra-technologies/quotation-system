"use client";

import { useTranslations } from "next-intl";
import { MIN_DOOR_HEIGHT_MM, DEFAULT_DOOR_HEIGHT_RATIO } from "./configure-constants";
import type {
  ConfigureSelection,
  DesignPanel,
  MutateResult,
  PartitionPatch,
  PartitionRow,
  SelectionRow,
} from "./types";

interface SavedComponentsRailProps {
  partition: PartitionRow;
  selections: SelectionRow[];
  selection: ConfigureSelection;
  mutate: (build: (fresh: PartitionRow) => PartitionPatch) => Promise<MutateResult>;
}

/**
 * Right rail in Configure mode — mirrors design-step-poc.html's
 * `renderConfigureSidebar`: 3 gated sections (glass always enabled, doors
 * only with a panel selected, profiles only with an edge selected), plus a
 * trailing "Other" section for any Selection whose componentType.code isn't
 * one of the 3 recognized codes.
 *
 * GROUPING IS BY `componentType.code` (GLASS/DOOR/PROFILE_STOP), NOT
 * `category.name` — architect-review-item7.md's binding correction to
 * plan-item7.md's flag 3, which incorrectly assumed free-text category
 * grouping. Every org seeds exactly one category ("Glass Partitions")
 * containing these 3 coded ComponentTypes (lib/component-catalog-seed.ts),
 * so category-name grouping would put everything in one bucket — the code
 * is the only thing that carries behavioral meaning here (same precedent as
 * lib/component-icons.tsx).
 */
export function SavedComponentsRail({
  partition,
  selections,
  selection,
  mutate,
}: SavedComponentsRailProps) {
  const t = useTranslations("design");

  const glassSelections = selections.filter((s) => s.componentType.code === "GLASS");
  const doorSelections = selections.filter((s) => s.componentType.code === "DOOR");
  const profileSelections = selections.filter((s) => s.componentType.code === "PROFILE_STOP");
  const otherSelections = selections.filter(
    (s) => !["GLASS", "DOOR", "PROFILE_STOP"].includes(s.componentType.code ?? ""),
  );

  const doorEnabled = selection?.type === "panel";
  const profileEnabled = selection?.type === "edge";

  const panels = partition.design?.panels ?? [];
  const selectedPanel: DesignPanel | undefined =
    selection?.type === "panel" ? panels.find((p) => p.id === selection.panelId) : undefined;

  function isGlassActive(id: string): boolean {
    return panels.length > 0 && panels.every((p) => p.selectionId === id);
  }
  function isDoorActive(id: string): boolean {
    return !!selectedPanel?.door && selectedPanel.door.selectionId === id;
  }
  function isProfileActive(id: string): boolean {
    return selection?.type === "edge" && partition.design?.stops?.[selection.side] === id;
  }

  function assignGlass(componentId: string) {
    void mutate((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      const nextPanels = freshPanels.map((p) => ({ ...p, selectionId: componentId }));
      return { design: { panels: nextPanels } };
    });
  }

  function toggleDoor(componentId: string) {
    if (selection?.type !== "panel") return;
    const panelId = selection.panelId;
    void mutate((fresh) => {
      const freshPanels = fresh.design?.panels ?? [];
      const nextPanels = freshPanels.map((p): DesignPanel => {
        if (p.id !== panelId) return p;
        if (p.door && p.door.selectionId === componentId) {
          return { ...p, type: "glass", door: null };
        }
        const wallHeightMm = fresh.heightMm;
        const existingHeight = p.door?.outerFrame?.h;
        const heightMm = existingHeight
          ? Math.min(existingHeight, wallHeightMm)
          : Math.max(MIN_DOOR_HEIGHT_MM, Math.round(wallHeightMm * DEFAULT_DOOR_HEIGHT_RATIO));
        return {
          ...p,
          type: "door",
          door: {
            selectionId: componentId,
            hinging: "left",
            outerFrame: { w: p.widthMm, h: heightMm },
          },
        };
      });
      return { design: { panels: nextPanels } };
    });
  }

  function assignProfile(componentId: string) {
    if (selection?.type !== "edge") return;
    const side = selection.side;
    void mutate((fresh) => {
      const stops = { ...(fresh.design?.stops ?? {}), [side]: componentId };
      return { design: { stops } };
    });
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
            enabled
            isActive={isGlassActive}
            onClick={assignGlass}
          />
        )}
        {doorSelections.length > 0 && (
          <ComponentSection
            title={t("sectionDoors")}
            comps={doorSelections}
            enabled={doorEnabled}
            isActive={isDoorActive}
            onClick={toggleDoor}
          />
        )}
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
