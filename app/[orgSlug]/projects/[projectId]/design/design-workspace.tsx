"use client";

/**
 * Design page's single client state owner.
 *
 * S21-0.3: shell replaced with CSS grid (3 fluid columns + 2 breakpoints)
 *   matching design-page.html's .app-shell layout.
 * S21-0.4: mutatePartition removed; DraftProvider added; Save/Discard wired
 *   via useDraftContext(). enterConfigureMode fetches the partition and
 *   dispatches LOAD_PARTITION. Back button checks isDirty → unsaved modal.
 * S21-0.6: UnsavedChangesModal wired — Save & Go Back / Discard Changes / Cancel.
 *
 * FROZEN (Track 0 contract): other tracks must not edit this file. They
 * dispatch actions via useDraftContext() from their own component files.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { UnitProvider } from "./unit-context";
import { DraftProvider, useDraftContext } from "./design-draft-context";
import { FloorBar } from "./floor-bar";
import { RoomList } from "./room-list";
import { RoomFloorPlan, sideName } from "./room-floor-plan";
import { LayoutModePanel } from "./layout-mode-panel";
import { ConfigureMode } from "./configure-mode";
import { SavedComponentsRail } from "./saved-components-rail";
import { NewRoomForm } from "./new-room-form";
import { RoomNameInput } from "./room-name-input";
import { redirectToLogin } from "./login-redirect";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type {
  FloorRow,
  FloorWithRooms,
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
  initialOpenRoomId: string | null;
}

/**
 * Inner workspace — must be rendered inside DraftProvider (see below).
 * Separated so useDraftContext() is valid at the call site.
 */
function DesignWorkspaceInner({
  orgSlug,
  projectId,
  isSubdomain,
  initialFloors,
  selections,
  initialOpenRoomId,
}: DesignWorkspaceProps) {
  const t = useTranslations("design");
  const { state, dispatch, save, discard } = useDraftContext();

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
  const [configureFromSideIndex, setConfigureFromSideIndex] = useState<number | null>(null);
  const [addingRoomForEmptyState, setAddingRoomForEmptyState] = useState(false);
  const [selectedRoomPartitions, setSelectedRoomPartitions] = useState<PartitionRow[]>([]);

  // Unsaved-changes modal state — shown when Back is clicked while isDirty.
  const [unsavedModal, setUnsavedModal] = useState<{
    onSave: () => void;
    onDiscard: () => void;
  } | null>(null);

  // Cancellation token for enterConfigureMode's async fetch — prevents the earlier
  // response from overwriting the state if the user clicks two partitions quickly.
  const fetchCancelRef = useRef({ cancelled: false });
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedFloor = floors.find((f) => f.id === selectedFloorId) ?? null;
  const selectedRoom = selectedFloor?.rooms.find((r) => r.id === selectedRoomId) ?? null;

  // Escape: clear context-menu-level selections (context menus added by D3/D4
  // handle Escape themselves first); then clear panel/edge selection via context.
  // The unsaved-changes modal explicitly does NOT dismiss on Escape — per mockup
  // lines 2112-2118.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (unsavedModal) return; // modal consumes Escape — do nothing
      if (viewMode === "configure") dispatch({ type: "SET_SELECTION", selection: null });
      else setLayoutSideSelection(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [viewMode, dispatch, unsavedModal]);

  // Fetch partitions for the selected room's PARTITION sides (layout-mode tooltip + left-rail preview).
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
    return () => { cancelled = true; };
  }, [orgSlug, isSubdomain, selectedRoom]);

  /** Enter Configure mode: fetch partition → LOAD_PARTITION → switch view. */
  async function enterConfigureMode(partitionId: string, sideIndex: number) {
    // Cancel any previous in-flight fetch so a rapid double-click between partitions
    // doesn't let the earlier response overwrite the later one.
    fetchCancelRef.current.cancelled = true;
    const token = { cancelled: false };
    fetchCancelRef.current = token;
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/partitions/${partitionId}`);
      if (token.cancelled) return;
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      if (!res.ok) return;
      const { partition } = (await res.json()) as { partition: PartitionRow };
      if (token.cancelled) return;
      dispatch({ type: "LOAD_PARTITION", partition });
    } catch {
      return;
    }
    setConfigureFromSideIndex(sideIndex);
    setViewMode("configure");
    setLayoutSideSelection(null);
  }

  /** Navigate back from Configure mode — guards against unsaved changes. */
  function requestBackFromConfigureMode() {
    if (state.isDirty) {
      setUnsavedModal({
        onSave: handleSaveAndGoBack,
        onDiscard: handleDiscardAndGoBack,
      });
    } else {
      doBackFromConfigureMode();
    }
  }

  function doBackFromConfigureMode() {
    setViewMode("layout");
    setLayoutSideSelection(configureFromSideIndex);
    setConfigureFromSideIndex(null);
    setSaveError(null);
    setUnsavedModal(null);
  }

  async function handleSaveAndGoBack() {
    setSaveError(null);
    const result = await save(orgSlug, isSubdomain);
    if (!result.ok) {
      setSaveError(result.error);
      setUnsavedModal(null);
      return;
    }
    setSelectedRoomPartitions((prev) =>
      prev.map((p) =>
        p.id === result.partition.id
          ? { id: result.partition.id, label: result.partition.label, heightMm: result.partition.heightMm, widthMm: result.partition.widthMm }
          : p,
      ),
    );
    result.updatedRooms.forEach(handleRoomRenamed);
    doBackFromConfigureMode();
  }

  async function handleDiscardAndGoBack() {
    setUnsavedModal(null);
    await discard(orgSlug, isSubdomain);
    doBackFromConfigureMode();
  }

  /** Save from the Save button in Configure mode (no navigation). */
  async function handleSave() {
    setSaveError(null);
    const result = await save(orgSlug, isSubdomain);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSelectedRoomPartitions((prev) =>
      prev.map((p) =>
        p.id === result.partition.id
          ? { id: result.partition.id, label: result.partition.label, heightMm: result.partition.heightMm, widthMm: result.partition.widthMm }
          : p,
      ),
    );
    result.updatedRooms.forEach(handleRoomRenamed);
  }

  function selectFloor(floorId: string) {
    setSelectedFloorId(floorId);
    const floor = floors.find((f) => f.id === floorId);
    const firstRoom = floor?.rooms[0] ?? null;
    setSelectedRoomId(firstRoom?.id ?? null);
    setViewMode(firstRoom ? "layout" : "empty");
    setLayoutSideSelection(null);
  }

  function handleFloorCreated(floor: FloorRow) {
    setFloors((prev) => [...prev, { ...floor, rooms: [] }]);
    setSelectedFloorId(floor.id);
    setSelectedRoomId(null);
    setViewMode("empty");
    setLayoutSideSelection(null);
  }

  function handleFloorRenamed(floor: FloorRow) {
    setFloors((prev) =>
      prev.map((f) => (f.id === floor.id ? { ...f, label: floor.label } : f)),
    );
  }

  function handleFloorDeleted(floorId: string) {
    setFloors((prev) => prev.filter((f) => f.id !== floorId));
    // FloorBar already calls onSelectFloor(remaining[0]) after a deletion,
    // which updates selectedFloorId. If no floors remain, selectedFloorId
    // will stay as the deleted id momentarily — the FloorBar guard
    // (canDelete = visibleFloors.length > 1) prevents deleting the last floor,
    // so there is always at least one surviving floor.
  }

  function selectRoom(room: RoomRow) {
    setSelectedRoomId(room.id);
    setViewMode("layout");
    setLayoutSideSelection(null);
  }

  function handleRoomCreated(room: RoomRow) {
    setFloors((prev) =>
      prev.map((f) => (f.id === room.floorId ? { ...f, rooms: [...f.rooms, room] } : f)),
    );
    setSelectedFloorId(room.floorId);
    setSelectedRoomId(room.id);
    setViewMode("layout");
    setLayoutSideSelection(null);
    setAddingRoomForEmptyState(false);
  }

  function handleRoomDeleted(roomId: string) {
    // Remove the room from workspace's floors state so re-renders don't resurrect it.
    setFloors((prev) =>
      prev.map((f) =>
        f.id === selectedFloorId
          ? { ...f, rooms: f.rooms.filter((r) => r.id !== roomId) }
          : f,
      ),
    );
    // If the deleted room was selected and no remaining rooms exist on this floor,
    // go to empty state. The case with remaining rooms is handled by RoomList
    // already calling onSelectRoom(remaining[0]) in its own handleDeleteRoom.
    if (selectedRoomId === roomId) {
      const currentFloor = floors.find((f) => f.id === selectedFloorId);
      const remaining = (currentFloor?.rooms ?? []).filter((r) => r.id !== roomId);
      if (remaining.length === 0) {
        setSelectedRoomId(null);
        setViewMode("empty");
        setLayoutSideSelection(null);
      }
    }
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

  const isDirty = state.isDirty;

  return (
    <>
      {/* S21-0.3: three-column CSS grid shell.
          Replaces: flex flex-1 gap-4 overflow-hidden p-4
          Grid contract (published for Tracks A–D):
            col 1 = left rail  (Track A)
            col 2 = center     (Tracks B/D)
            col 3 = right rail (Track C)
          Breakpoints: max-[1400px] → tighter cols, max-[1180px] → single column */}
      <div
        className={[
          "grid flex-1 overflow-hidden",
          // Default: minmax(210px,250px) 1fr minmax(260px,300px)
          // Tailwind v4 arbitrary grid-template-columns:
          "[grid-template-columns:minmax(210px,250px)_minmax(360px,1fr)_minmax(260px,300px)]",
          "gap-[18px] px-6 py-[18px]",
          "max-w-[1480px] mx-auto w-full",
          // 1400px breakpoint
          "max-[1400px]:[grid-template-columns:minmax(196px,226px)_minmax(320px,1fr)_minmax(240px,270px)]",
          "max-[1400px]:gap-[14px] max-[1400px]:px-[18px] max-[1400px]:py-[14px]",
          // 1180px breakpoint → single column
          "max-[1180px]:grid-cols-1",
        ].join(" ")}
      >
        {/* Column 1: left rail — floor bar + room list */}
        <aside className="flex flex-col overflow-hidden rounded-[10px] border border-border bg-bg-card p-4">
          <FloorBar
            orgSlug={orgSlug}
            projectId={projectId}
            isSubdomain={isSubdomain}
            floors={floors}
            selectedFloorId={selectedFloorId}
            onSelectFloor={selectFloor}
            onFloorCreated={handleFloorCreated}
            onFloorRenamed={handleFloorRenamed}
            onFloorDeleted={handleFloorDeleted}
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
                  onRoomDeleted={handleRoomDeleted}
                  onSelectPartition={enterConfigureMode}
                  selectedPartitionId={viewMode === "configure" ? state.partitionId : null}
                />
              ) : null}
            </>
          )}
        </aside>

        {/* Column 2: center — empty / layout / configure */}
        <div
          className="flex flex-col overflow-hidden rounded-[10px] border border-border bg-bg-card"
          onClick={() => setLayoutSideSelection(null)}
        >
          {saveError && (
            <p className="px-4 pt-3 text-xs text-red-700 dark:text-red-400">{saveError}</p>
          )}

          {viewMode === "configure" && state.partitionId ? (
            <div
              className="flex flex-1 flex-col gap-3 overflow-y-auto p-[14px_18px]"
              onClick={(e) => e.stopPropagation()}
            >
              <ConfigureMode
                selections={selections}
                floorLabel={selectedFloor?.label ?? ""}
                roomLabel={selectedRoom?.label ?? ""}
                onBack={requestBackFromConfigureMode}
              />
              {/* Configure mode footer: Save button */}
              <div className="mt-auto flex shrink-0 justify-end border-t border-border pt-[10px]">
                <button
                  type="button"
                  disabled={!isDirty}
                  onClick={() => void handleSave()}
                  className={[
                    "rounded-pill border px-5 py-2.5 text-[12.5px] font-bold transition-colors",
                    isDirty
                      ? "border-primary-dark bg-primary text-white hover:bg-primary-dark"
                      : "cursor-default border-text-muted bg-text-muted text-white opacity-55",
                  ].join(" ")}
                >
                  {isDirty ? t("saveChanges") : t("saved")}
                </button>
              </div>
            </div>
          ) : viewMode === "layout" && selectedRoom ? (
            <div
              className="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
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
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
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

        {/* Column 3: right rail — Saved Components (configure) or layout side details */}
        <aside className="flex flex-col overflow-y-auto rounded-[10px] border border-border bg-bg-card p-4">
          {viewMode === "configure" && state.partitionId ? (
            <SavedComponentsRail selections={selections} />
          ) : (
            <>
              <h2 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">
                {viewMode === "layout" ? t("wallDetails") : t("selectionsTitle")}
              </h2>
              {viewMode === "layout" && selectedRoom && layoutSideSelection !== null && (
                <p className="mb-2 text-xs text-text-muted">
                  {t("wallSelected", {
                    side: sideName(layoutSideSelection, selectedRoom.sides.length),
                  })}
                </p>
              )}
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

      {/* S21-0.6: Unsaved-changes modal — requires explicit choice; Escape is a no-op.
          Uses ConfirmDialog extended with a thirdAction for the three-button layout:
          Save & Go Back (primary) / Discard Changes (danger) / Cancel. */}
      {unsavedModal && (
        <ConfirmDialog
          isOpen={true}
          title={t("unsavedChangesTitle")}
          message={t("unsavedChangesMessage")}
          confirmLabel={t("saveAndGoBack")}
          confirmVariant="primary"
          cancelLabel={t("cancelStay")}
          disableEscapeClose={true}
          disableOverlayClose={true}
          thirdAction={{
            label: t("discardChanges"),
            onClick: () => void handleDiscardAndGoBack(),
            variant: "danger",
          }}
          onConfirm={() => void handleSaveAndGoBack()}
          onCancel={() => setUnsavedModal(null)}
        />
      )}
    </>
  );
}

/**
 * Public export — wraps the inner workspace with UnitProvider + DraftProvider.
 * DraftProvider must be inside a Client Component boundary (this file is
 * "use client" via its imports). UnitProvider keeps its existing position.
 */
export function DesignWorkspace(props: DesignWorkspaceProps) {
  return (
    <UnitProvider>
      {/* UnitProvider is kept even though the unit toggle was removed (Stage 20 B5)
          — child components still call useUnit() and the provider is the correct
          boundary for that hook, permanently fixed to "mm". */}
      <DraftProvider>
        <DesignWorkspaceInner {...props} />
      </DraftProvider>
    </UnitProvider>
  );
}
