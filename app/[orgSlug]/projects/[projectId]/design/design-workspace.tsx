"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UnitProvider } from "./unit-context";
import { UnitToggle } from "./unit-toggle";
import { FloorBar } from "./floor-bar";
import { RoomList } from "./room-list";
import { RoomFloorPlan } from "./room-floor-plan";
import { LayoutModePanel } from "./layout-mode-panel";
import { NewRoomForm } from "./new-room-form";
import type { FloorRow, FloorWithRooms, PartitionRow, RoomRow, SelectionRow, ViewMode } from "./types";

interface DesignWorkspaceProps {
  orgSlug: string;
  projectId: string;
  isSubdomain: boolean;
  initialFloors: FloorWithRooms[];
  selections: SelectionRow[];
  /** Room to select on mount — set after the add-wall flow's server-side redirect
   * (?openRoom=<id>). Everything after mount is pure client state (no more
   * navigation-driven selection). */
  initialOpenRoomId: string | null;
}

/**
 * Design page's single client state owner — mirrors design-step-poc.html's
 * one `renderAll()` state machine as React state. Owns floor/room selection,
 * the center-column view mode, and the currently-selected floor-plan side.
 * Mounts UnitProvider once so both this component and its children
 * (room-floor-plan.tsx, layout-mode-panel.tsx, convert-side-form.tsx) share
 * one unit toggle.
 *
 * Piece 1 (plan-item7.md) — viewMode can only reach 'empty' | 'layout' here;
 * 'configure' is wired into the ViewMode type (types.ts) for Piece 2 to
 * extend into without a signature change, but no Configure-mode UI exists
 * yet — "Configure Partition ->" in layout-mode-panel.tsx is an inert
 * affordance until then.
 */
export function DesignWorkspace({
  orgSlug,
  projectId,
  isSubdomain,
  initialFloors,
  selections,
  initialOpenRoomId,
}: DesignWorkspaceProps) {
  const t = useTranslations("design");

  const [floors, setFloors] = useState<FloorWithRooms[]>(initialFloors);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(() => {
    if (initialOpenRoomId) {
      const owner = initialFloors.find((f) =>
        f.rooms.some((r) => r.id === initialOpenRoomId),
      );
      if (owner) return owner.id;
    }
    return initialFloors[0]?.id ?? null;
  });
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => {
    if (initialOpenRoomId) return initialOpenRoomId;
    const firstFloor = initialFloors[0];
    return firstFloor?.rooms[0]?.id ?? null;
  });
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    selectedRoomId ? "layout" : "empty",
  );
  const [layoutSideSelection, setLayoutSideSelection] = useState<number | null>(null);
  // Wired for Piece 2 (Configure mode) — unused until then.
  const [, setActivePartitionId] = useState<string | null>(null);
  const [addingRoomForEmptyState, setAddingRoomForEmptyState] = useState(false);
  const [selectedRoomPartitions, setSelectedRoomPartitions] = useState<PartitionRow[]>([]);

  const selectedFloor = floors.find((f) => f.id === selectedFloorId) ?? null;
  const selectedRoom = selectedFloor?.rooms.find((r) => r.id === selectedRoomId) ?? null;

  // Escape clears the current floor-plan side selection — mirrors the
  // mockup's document-level keydown handler.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLayoutSideSelection(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch partitions for the selected room's PARTITION sides (needed for the
  // floor-plan tooltip and layout-mode-panel's summary — a PARTITION side
  // element carries no label/dims of its own, see types.ts RoomSide).
  //
  // The reset branches are wrapped in an async function rather than calling
  // setState directly in the effect body (react-hooks/set-state-in-effect —
  // same fix shape Item 3 applied to design-left-rail.tsx's equivalent
  // effect).
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!selectedRoom) {
        if (!cancelled) setSelectedRoomPartitions([]);
        return;
      }
      const hasPartitionSides = selectedRoom.sides.some((s) => s.kind === "PARTITION");
      if (!hasPartitionSides) {
        if (!cancelled) setSelectedRoomPartitions([]);
        return;
      }
      try {
        const res = await fetch(`/api/v1/orgs/${orgSlug}/partitions?roomId=${selectedRoom.id}`);
        const data = (res.ok ? await res.json() : { partitions: [] }) as {
          partitions: PartitionRow[];
        };
        if (!cancelled) setSelectedRoomPartitions(data.partitions);
      } catch {
        if (!cancelled) setSelectedRoomPartitions([]);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [orgSlug, selectedRoom]);

  function selectFloor(floorId: string) {
    setSelectedFloorId(floorId);
    const floor = floors.find((f) => f.id === floorId);
    const firstRoom = floor?.rooms[0] ?? null;
    setSelectedRoomId(firstRoom?.id ?? null);
    setViewMode(firstRoom ? "layout" : "empty");
    setLayoutSideSelection(null);
    setActivePartitionId(null);
  }

  function handleFloorCreated(floor: FloorRow) {
    setFloors((prev) => [...prev, { ...floor, rooms: [] }]);
    setSelectedFloorId(floor.id);
    setSelectedRoomId(null);
    setViewMode("empty");
    setLayoutSideSelection(null);
  }

  function selectRoom(room: RoomRow) {
    setSelectedRoomId(room.id);
    setViewMode("layout");
    setLayoutSideSelection(null);
    setActivePartitionId(null);
  }

  function handleRoomCreated(room: RoomRow) {
    setFloors((prev) =>
      prev.map((f) => (f.id === room.floorId ? { ...f, rooms: [room, ...f.rooms] } : f)),
    );
    setSelectedFloorId(room.floorId);
    setSelectedRoomId(room.id);
    setViewMode("layout");
    setLayoutSideSelection(null);
    setAddingRoomForEmptyState(false);
  }

  function handleSideConverted(updatedRoom: RoomRow) {
    setFloors((prev) =>
      prev.map((f) =>
        f.id === updatedRoom.floorId
          ? { ...f, rooms: f.rooms.map((r) => (r.id === updatedRoom.id ? updatedRoom : r)) }
          : f,
      ),
    );
    setLayoutSideSelection(null);
  }

  return (
    <UnitProvider>
      <div className="flex shrink-0 items-center justify-end border-b border-border px-6 py-2">
        <UnitToggle />
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* Left rail — floor bar + room list */}
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-bg-card p-4">
          {floors.length === 0 ? (
            <p className="text-sm text-text-muted">{t("noWalls")}</p>
          ) : (
            <>
              <FloorBar
                orgSlug={orgSlug}
                projectId={projectId}
                isSubdomain={isSubdomain}
                floors={floors}
                selectedFloorId={selectedFloorId}
                onSelectFloor={selectFloor}
                onFloorCreated={handleFloorCreated}
              />
              <h2 className="mb-1 text-xs font-bold text-text-heading">{t("wallsTitle")}</h2>
              {selectedFloor ? (
                <RoomList
                  orgSlug={orgSlug}
                  isSubdomain={isSubdomain}
                  floorId={selectedFloor.id}
                  rooms={selectedFloor.rooms}
                  selectedRoomId={viewMode === "layout" ? selectedRoomId : null}
                  onSelectRoom={selectRoom}
                  onRoomCreated={handleRoomCreated}
                />
              ) : null}
            </>
          )}
        </aside>

        {/* Center — empty / layout (Configure mode is Piece 2) */}
        <div
          className="flex flex-1 flex-col items-center justify-center overflow-y-auto rounded-md border border-border bg-bg-card p-6"
          onClick={() => setLayoutSideSelection(null)}
        >
          {viewMode === "layout" && selectedRoom ? (
            <div className="flex w-full max-w-xl flex-col gap-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-extrabold text-text-heading">
                  {selectedRoom.label}
                </h3>
                {selectedFloor && (
                  <span className="rounded-pill border border-primary-soft bg-primary-softer px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">
                    {selectedFloor.label}
                  </span>
                )}
                <span className="rounded-pill border border-primary-soft bg-primary-softer px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">
                  {t("sidesCount", { count: selectedRoom.sides.length })}
                </span>
              </div>

              <RoomFloorPlan
                room={selectedRoom}
                partitions={selectedRoomPartitions}
                selectedIndex={layoutSideSelection}
                onSelectSide={setLayoutSideSelection}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <h2 className="text-base font-extrabold text-text-heading">
                {t("emptyStateTitle")}
              </h2>
              <p className="max-w-xs text-xs text-text-muted">{t("emptyStateBody")}</p>
              {selectedFloor &&
                (addingRoomForEmptyState ? (
                  <div className="w-full max-w-xs">
                    <NewRoomForm
                      orgSlug={orgSlug}
                      isSubdomain={isSubdomain}
                      floorId={selectedFloor.id}
                      onCancel={() => setAddingRoomForEmptyState(false)}
                      onCreated={handleRoomCreated}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingRoomForEmptyState(true)}
                    className="rounded-sm border border-primary-soft bg-primary-softer px-4 py-2 text-xs font-bold text-primary-dark hover:border-primary"
                  >
                    {t("newRoom")}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Right rail — layout-mode side details, or a context hint */}
        <aside className="w-72 shrink-0 overflow-y-auto rounded-md border border-border bg-bg-card p-4">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("selectionsTitle")}
          </h2>
          {viewMode === "layout" && selectedRoom && layoutSideSelection !== null ? (
            <LayoutModePanel
              orgSlug={orgSlug}
              isSubdomain={isSubdomain}
              floorId={selectedRoom.floorId}
              room={selectedRoom}
              sideIndex={layoutSideSelection}
              partitions={selectedRoomPartitions}
              onCancel={() => setLayoutSideSelection(null)}
              onConverted={handleSideConverted}
            />
          ) : viewMode === "layout" && selectedRoom ? (
            <p className="text-xs text-text-muted">{t("clickWallHint")}</p>
          ) : (
            <p className="text-xs text-text-muted">
              {t("selectionsAvailable", { count: selections.length })}
            </p>
          )}
        </aside>
      </div>
    </UnitProvider>
  );
}
