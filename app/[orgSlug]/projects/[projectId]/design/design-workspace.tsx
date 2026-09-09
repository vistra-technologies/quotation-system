"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UnitProvider } from "./unit-context";
import { UnitToggle } from "./unit-toggle";
import { FloorBar } from "./floor-bar";
import { RoomList } from "./room-list";
import { RoomFloorPlan } from "./room-floor-plan";
import { LayoutModePanel } from "./layout-mode-panel";
import { ConfigureMode } from "./configure-mode";
import { SavedComponentsRail } from "./saved-components-rail";
import { NewRoomForm } from "./new-room-form";
import { RoomNameInput } from "./room-name-input";
import { redirectToLogin } from "./login-redirect";
import type {
  ConfigureSelection,
  FloorRow,
  FloorWithRooms,
  MutateResult,
  PartitionPatch,
  PartitionRow,
  RoomRow,
  SelectionRow,
  ViewMode,
} from "./types";

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
 * `viewMode` reaches all 3 states ('empty' | 'layout' | 'configure') as of
 * Piece 2 — Configure mode (partition/panel/door/edge editing) is wired via
 * `enterConfigureMode`/`backFromConfigureMode`, `mutatePartition()`
 * (re-read-before-write transport, shared by `ConfigureMode` and
 * `SavedComponentsRail`), and the `activePartition`/`configureSelection`
 * state below. "Configure Partition →" in `layout-mode-panel.tsx` is live,
 * not the Piece-1-era inert affordance this comment used to describe.
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
  const [activePartitionId, setActivePartitionId] = useState<string | null>(null);
  // The layout-mode side index that owns activePartitionId — restored as
  // layoutSideSelection when Configure mode's back button returns to Layout.
  const [configureFromSideIndex, setConfigureFromSideIndex] = useState<number | null>(null);
  const [activePartition, setActivePartition] = useState<PartitionRow | null>(null);
  const [configureSelection, setConfigureSelection] = useState<ConfigureSelection>(null);
  const [addingRoomForEmptyState, setAddingRoomForEmptyState] = useState(false);
  const [selectedRoomPartitions, setSelectedRoomPartitions] = useState<PartitionRow[]>([]);

  const selectedFloor = floors.find((f) => f.id === selectedFloorId) ?? null;
  const selectedRoom = selectedFloor?.rooms.find((r) => r.id === selectedRoomId) ?? null;

  // Escape clears the current selection — mirrors the mockup's
  // document-level keydown handler, extended to Configure mode's
  // panel/edge selection (design-step-poc.html:1423-1427).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (viewMode === "configure") setConfigureSelection(null);
      else setLayoutSideSelection(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewMode]);

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
        if (res.status === 401 || res.status === 403) {
          redirectToLogin(orgSlug, isSubdomain);
          return;
        }
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
  }, [orgSlug, isSubdomain, selectedRoom]);

  // Fetch the full partition (incl. design JSONB) whenever Configure mode's
  // active partition changes — the collection route (GET /partitions?roomId=)
  // never returns `design`, only the read used by Layout mode's summary.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (viewMode !== "configure" || !activePartitionId) {
        if (!cancelled) setActivePartition(null);
        return;
      }
      try {
        const res = await fetch(`/api/v1/orgs/${orgSlug}/partitions/${activePartitionId}`);
        if (res.status === 401 || res.status === 403) {
          redirectToLogin(orgSlug, isSubdomain);
          return;
        }
        if (!res.ok) {
          if (!cancelled) setActivePartition(null);
          return;
        }
        const { partition } = (await res.json()) as { partition: PartitionRow };
        if (!cancelled) setActivePartition(partition);
      } catch {
        if (!cancelled) setActivePartition(null);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [orgSlug, isSubdomain, viewMode, activePartitionId]);

  /**
   * Configure mode's single mutation transport: re-reads the partition
   * fresh from the server, lets the caller build a partial PATCH body from
   * that fresh copy, PATCHes it, then syncs local state (activePartition +
   * the matching entry in selectedRoomPartitions, so the floor-plan tooltip
   * and left-rail preview stay current without a reload). Every Configure-
   * mode mutation goes through this — the re-read-before-write condition
   * architect-review-item7.md attached to full-document writes, applied
   * uniformly rather than per-callsite.
   */
  async function mutatePartition(
    build: (fresh: PartitionRow) => PartitionPatch,
  ): Promise<MutateResult> {
    if (!activePartitionId) {
      return { ok: false, error: "No active partition." };
    }
    try {
      const freshRes = await fetch(`/api/v1/orgs/${orgSlug}/partitions/${activePartitionId}`);
      if (freshRes.status === 401 || freshRes.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return { ok: false, error: "Redirecting to login." };
      }
      if (!freshRes.ok) {
        return { ok: false, error: "Could not load the partition — please try again." };
      }
      const { partition: fresh } = (await freshRes.json()) as { partition: PartitionRow };
      const patch = build(fresh);

      const patchRes = await fetch(`/api/v1/orgs/${orgSlug}/partitions/${activePartitionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (patchRes.status === 401 || patchRes.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return { ok: false, error: "Redirecting to login." };
      }
      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: body.error ?? "An unexpected error occurred — please try again." };
      }
      const { partition: updated } = (await patchRes.json()) as { partition: PartitionRow };
      setActivePartition(updated);
      setSelectedRoomPartitions((prev) =>
        prev.map((p) =>
          p.id === updated.id
            ? { id: updated.id, label: updated.label, heightMm: updated.heightMm, widthMm: updated.widthMm }
            : p,
        ),
      );
      return { ok: true, partition: updated };
    } catch {
      return { ok: false, error: "Network error — please try again." };
    }
  }

  function enterConfigureMode(partitionId: string, sideIndex: number) {
    setActivePartitionId(partitionId);
    setConfigureFromSideIndex(sideIndex);
    setConfigureSelection(null);
    setViewMode("configure");
    setLayoutSideSelection(null);
  }

  function backFromConfigureMode() {
    setViewMode("layout");
    setLayoutSideSelection(configureFromSideIndex);
    setActivePartitionId(null);
    setActivePartition(null);
    setConfigureSelection(null);
    setConfigureFromSideIndex(null);
  }

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
      // Appended, not prepended — matches createRoom()'s server-side
      // orderIndex = MAX + 1 and listRoomsByFloor()'s orderIndex-asc
      // ordering (lib/data/rooms.ts), so the new room lands in the same
      // position the list will show after a reload.
      prev.map((f) => (f.id === room.floorId ? { ...f, rooms: [...f.rooms, room] } : f)),
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

  function handleRoomRenamed(updatedRoom: RoomRow) {
    setFloors((prev) =>
      prev.map((f) =>
        f.id === updatedRoom.floorId
          ? { ...f, rooms: f.rooms.map((r) => (r.id === updatedRoom.id ? updatedRoom : r)) }
          : f,
      ),
    );
  }

  return (
    <UnitProvider>
      <div className="flex shrink-0 items-center justify-end border-b border-border px-6 py-2">
        <UnitToggle />
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* Left rail — floor bar + room list */}
        <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-bg-card p-4">
          <FloorBar
            orgSlug={orgSlug}
            projectId={projectId}
            isSubdomain={isSubdomain}
            floors={floors}
            selectedFloorId={selectedFloorId}
            onSelectFloor={selectFloor}
            onFloorCreated={handleFloorCreated}
          />
          {floors.length === 0 ? (
            <p className="text-sm text-text-muted">{t("noWalls")}</p>
          ) : (
            <>
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

        {/* Center — empty / layout / configure */}
        <div
          className="flex flex-1 flex-col items-center justify-center overflow-y-auto rounded-md border border-border bg-bg-card p-6"
          onClick={() => setLayoutSideSelection(null)}
        >
          {viewMode === "configure" && activePartitionId ? (
            // stopPropagation mirrors the Layout-mode branch below — without
            // it, clicking the back button (or anything else) inside
            // ConfigureMode bubbles up to this wrapper's background-click-to-
            // deselect handler and immediately clobbers the
            // layoutSideSelection that backFromConfigureMode() just restored.
            <div onClick={(e) => e.stopPropagation()}>
              {activePartition ? (
                <ConfigureMode
                  partition={activePartition}
                  selections={selections}
                  floorLabel={selectedFloor?.label ?? ""}
                  roomLabel={selectedRoom?.label ?? ""}
                  selection={configureSelection}
                  onSelectionChange={setConfigureSelection}
                  onBack={backFromConfigureMode}
                  mutate={mutatePartition}
                />
              ) : (
                <p className="text-xs text-text-muted">{t("loadingPartition")}</p>
              )}
            </div>
          ) : viewMode === "layout" && selectedRoom ? (
            <div className="flex w-full max-w-xl flex-col gap-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex flex-wrap items-center gap-2">
                <RoomNameInput
                  orgSlug={orgSlug}
                  isSubdomain={isSubdomain}
                  room={selectedRoom}
                  onRenamed={handleRoomRenamed}
                />
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

        {/* Right rail — Saved Components (configure), layout-mode side
            details, or a context hint. Context-sensitive per
            design-step-poc.html's renderRightRail: Saved Components only
            matter in Configure mode. */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto rounded-md border border-border bg-bg-card p-4">
          {viewMode === "configure" && activePartitionId ? (
            activePartition ? (
              <SavedComponentsRail
                partition={activePartition}
                selections={selections}
                selection={configureSelection}
                mutate={mutatePartition}
              />
            ) : (
              <p className="text-xs text-text-muted">{t("loadingPartition")}</p>
            )
          ) : (
            <>
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
                  onConfigure={enterConfigureMode}
                />
              ) : viewMode === "layout" && selectedRoom ? (
                <p className="text-xs text-text-muted">{t("clickWallHint")}</p>
              ) : (
                <p className="text-xs text-text-muted">
                  {t("selectionsAvailable", { count: selections.length })}
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </UnitProvider>
  );
}
