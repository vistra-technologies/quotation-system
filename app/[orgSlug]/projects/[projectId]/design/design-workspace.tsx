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
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UnitProvider } from "./unit-context";
import { DraftProvider, useDraftContext } from "./design-draft-context";
import { FloorBar } from "./floor-bar";
import { RoomList } from "./room-list";
import { RoomFloorPlan, RoomFloorPlanLegend, sideName } from "./room-floor-plan";
import { LayoutModePanel } from "./layout-mode-panel";
import { ConfigureMode } from "./configure-mode";
import { SavedComponentsRail } from "./saved-components-rail";
import { NewRoomForm } from "./new-room-form";
import { RoomNameInput } from "./room-name-input";
import { redirectToLogin } from "./login-redirect";
import { makeDoorResolver, toPanelViewRow, toPanelViewRows } from "./partition-view";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Toast, useToast } from "@/components/toast";
import { ProblemPopup } from "../_problem-popup";
import type { CalculationProblemReport } from "@/lib/materials/problems";
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
  /**
   * Stage 25 B9: when set, the workspace enters Configure mode for this
   * partition on mount (deep-link from the problem popup's "Go" link via
   * design?partition=[partitionId]).
   */
  initialPartitionId: string | null;
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
  initialPartitionId,
}: DesignWorkspaceProps) {
  const t = useTranslations("design");
  const router = useRouter();
  const { state, dispatch, save, discard } = useDraftContext();
  // Bug 13: toast for Submit Design feedback.
  const submitToast = useToast();

  const [floors, setFloors] = useState<FloorWithRooms[]>(initialFloors);
  const [submittingDesign, setSubmittingDesign] = useState(false);
  const [submitDesignError, setSubmitDesignError] = useState<string | null>(null);
  // Stage 25 B9: when Submit Design returns 422, store the report and show the popup.
  const [submitDesignReport, setSubmitDesignReport] = useState<CalculationProblemReport | null>(null);

  // Derived live from floors state (not a static prop) so it stays correct as
  // walls are converted/reverted in this session without waiting for a reload.
  const totalPartitionCount = floors
    .flatMap((f) => f.rooms)
    .flatMap((r) => r.sides)
    .filter((s) => s.kind === "PARTITION").length;

  async function handleSubmitDesign() {
    setSubmitDesignError(null);
    setSubmitDesignReport(null);
    setSubmittingDesign(true);
    try {
      const res = await fetch(
        `/api/v1/orgs/${orgSlug}/projects/${projectId}/submit-design`,
        { method: "POST" },
      );
      if (res.status === 401 || res.status === 403) {
        redirectToLogin(orgSlug, isSubdomain);
        return;
      }
      // 422: calculation was refused — show the problem popup instead of a generic error.
      if (res.status === 422) {
        const report = (await res.json().catch(() => null)) as CalculationProblemReport | null;
        if (report?.ok === false && Array.isArray(report.problems)) {
          setSubmitDesignReport(report);
        } else {
          setSubmitDesignError("Design cannot be submitted — fix the problems and try again.");
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSubmitDesignError(body.error ?? "Could not submit the design — please try again.");
        return;
      }
      // Bug 13: show translucent slide-in toast confirming submission.
      submitToast.show(t("designSubmitted"));
      // Re-render the server-rendered wizard breadcrumb so Summary/Quotation
      // reflect the unlock immediately, without a manual page reload. The
      // response body isn't otherwise consumed — the button's own label
      // never reflects submitted state (bug #21).
      router.refresh();
    } catch {
      setSubmitDesignError("Network error — please try again.");
    } finally {
      setSubmittingDesign(false);
    }
  }
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
  const [addingRoomForEmptyState, setAddingRoomForEmptyState] = useState(false);
  const [selectedRoomPartitions, setSelectedRoomPartitions] = useState<PartitionRow[]>([]);
  // Stage 21 QA bug #18: the left-rail RoomList caches partitions locally and
  // only fetches when not already cached, so a Configure-mode save (new
  // panels/doors) didn't show up there until a full page refresh. Bumping
  // this after every successful save lets RoomList patch its cache in place.
  const [lastSavedPartition, setLastSavedPartition] = useState<PartitionRow | null>(null);

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

  // Stage 25 B9: if the page was loaded with ?partition=<id> (from a problem popup "Go" link),
  // enter Configure mode for that partition on mount — once only.
  useEffect(() => {
    if (initialPartitionId) void doEnterConfigureMode(initialPartitionId);
    // Intentionally empty dep array — runs once on mount; initialPartitionId is stable from props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (!cancelled) {
          setSelectedRoomPartitions(toPanelViewRows(data.partitions, makeDoorResolver(selections)));
        }
      } catch {
        if (!cancelled) setSelectedRoomPartitions([]);
      }
    }

    void run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `selections` is stable page props; adding it would refetch on every parent render.
  }, [orgSlug, isSubdomain, selectedRoom]);

  /**
   * Guard any navigation away from a dirty Configure-mode session — not just
   * the explicit Back button, but also jumping straight to a different room,
   * floor, or partition from the left rail while unsaved edits are pending.
   * When clean (or not in Configure mode), runs `resumeAction` immediately;
   * otherwise shows the unsaved-changes modal and runs it after Save/Discard.
   */
  function runWithUnsavedGuard(resumeAction: () => void) {
    if (viewMode !== "configure" || !state.isDirty) {
      resumeAction();
      return;
    }
    setUnsavedModal({
      onSave: async () => {
        setSaveError(null);
        const result = await save(orgSlug, isSubdomain);
        if (!result.ok) {
          setSaveError(result.error);
          setUnsavedModal(null);
          return;
        }
        // Re-fetch the server-rendered layout so Summary/Quotation pills reflect
        // the cleared designSubmittedAt immediately — no manual page reload needed.
        router.refresh();
        setSelectedRoomPartitions((prev) =>
          prev.map((p) =>
            p.id === result.partition.id
              ? { id: result.partition.id, label: result.partition.label, heightMm: result.partition.heightMm, widthMm: result.partition.widthMm }
              : p,
          ),
        );
        setLastSavedPartition(result.partition);
        result.updatedRooms.forEach(handleRoomRenamed);
        setUnsavedModal(null);
        resumeAction();
      },
      onDiscard: async () => {
        setUnsavedModal(null);
        await discard(orgSlug, isSubdomain);
        resumeAction();
      },
    });
  }

  /** Enter Configure mode: fetch partition → LOAD_PARTITION → switch view. */
  function enterConfigureMode(partitionId: string) {
    runWithUnsavedGuard(() => void doEnterConfigureMode(partitionId));
  }

  async function doEnterConfigureMode(partitionId: string) {
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
      const { partition: rawPartition } = (await res.json()) as { partition: PartitionRow };
      if (token.cancelled) return;
      // Stage 22 (D-6): stored v1/v2 design -> panel view, once, at this boundary. Throws on a
      // malformed stored document -> caught below, Configure mode simply doesn't open.
      const partition = toPanelViewRow(rawPartition, makeDoorResolver(selections));
      dispatch({ type: "LOAD_PARTITION", partition });
      // Pre-select the first panel so Configure mode opens ready to edit
      // (assign a door/material) instead of requiring an explicit click first.
      const firstPanel = partition.design?.panels?.[0];
      if (firstPanel) {
        dispatch({
          type: "SET_SELECTION",
          selection: { type: "panel", panelIds: [firstPanel.id] },
        });
      }
      // Bug 9 (bugs-3.md): "No partition panel should ever start with no glass."
      // If any panels have no glass selection, auto-assign the first available
      // glass selection so the user always lands on a configured state.
      // This makes the partition immediately dirty (isDirty=true) — intentional,
      // since the user explicitly asked for glass to always be pre-assigned.
      // Stage 22: only panels that own a glass cell count — a glass panel, or a door panel with a
      // transom (door height < wall height). A full-height door has no glass cell in v2, so its
      // null panel.selectionId is normal and must not mark the partition dirty on open.
      const panels = partition.design?.panels ?? [];
      const needsGlass = (p: (typeof panels)[number]) =>
        !p.selectionId &&
        (p.type === "glass" ||
          (p.door ? (p.door.outerFrame?.h ?? partition.heightMm) < partition.heightMm : false));
      const unglazedIds = panels.filter(needsGlass).map((p) => p.id);
      if (unglazedIds.length > 0) {
        const firstGlass = selections.find((s) => s.componentType.code === "GLASS");
        if (firstGlass) {
          dispatch({
            type: "SET_GLASS",
            panelIds: unglazedIds,
            selectionId: firstGlass.id,
          });
        }
      }
    } catch (err) {
      console.error("Failed to open partition in Configure mode", err);
      return;
    }
    // Navigate the left rail to the room that owns this partition so the rail
    // stays in sync with Configure mode (otherwise the room selector stays on
    // whatever room was previously selected while the centre shows a different
    // partition — flagged in R4 finding #1 as the "same applies to mount-time" issue).
    for (const floor of floors) {
      const owningRoom = floor.rooms.find((r) =>
        r.sides.some((s) => s.kind === "PARTITION" && s.partitionId === partitionId),
      );
      if (owningRoom) {
        setSelectedFloorId(floor.id);
        setSelectedRoomId(owningRoom.id);
        break;
      }
    }
    setViewMode("configure");
    setLayoutSideSelection(null);
  }

  /** Navigate back from Configure mode — guards against unsaved changes. */
  function requestBackFromConfigureMode() {
    runWithUnsavedGuard(doBackFromConfigureMode);
  }

  function doBackFromConfigureMode() {
    setViewMode("layout");
    // No wall preselected on return — land on the plain "click a wall" state
    // instead of re-highlighting the wall just converted/configured.
    setLayoutSideSelection(null);
    setSaveError(null);
    setUnsavedModal(null);
  }

  /** Save from the Save button in Configure mode (no navigation). */
  async function handleSave() {
    setSaveError(null);
    const result = await save(orgSlug, isSubdomain);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    // Re-fetch the server-rendered layout (layout.tsx) so the wizard breadcrumb
    // reflects the newly cleared designSubmittedAt immediately — no manual reload.
    // The API's updatePartition() clears designSubmittedAt whenever design/heightMm
    // is in the PATCH body (D-14/D-17); the refresh propagates that to the pills.
    router.refresh();
    setSelectedRoomPartitions((prev) =>
      prev.map((p) =>
        p.id === result.partition.id
          ? { id: result.partition.id, label: result.partition.label, heightMm: result.partition.heightMm, widthMm: result.partition.widthMm }
          : p,
      ),
    );
    setLastSavedPartition(result.partition);
    result.updatedRooms.forEach(handleRoomRenamed);
  }

  function selectFloor(floorId: string) {
    runWithUnsavedGuard(() => {
      setSelectedFloorId(floorId);
      const floor = floors.find((f) => f.id === floorId);
      const firstRoom = floor?.rooms[0] ?? null;
      setSelectedRoomId(firstRoom?.id ?? null);
      setViewMode(firstRoom ? "layout" : "empty");
      setLayoutSideSelection(null);
    });
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
    // Floor delete cascades to Rooms + Partitions, clearing designSubmittedAt
    // (D-20) — refresh the layout breadcrumb so pills lock immediately.
    router.refresh();
  }

  function selectRoom(room: RoomRow) {
    runWithUnsavedGuard(() => {
      setSelectedRoomId(room.id);
      setViewMode("layout");
      setLayoutSideSelection(null);
    });
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
    // Room delete cascades to Partitions, clearing designSubmittedAt (D-20) —
    // refresh the layout breadcrumb so pills lock immediately.
    router.refresh();
  }

  function handleSideConverted(updatedRoom: RoomRow) {
    setFloors((prev) =>
      prev.map((f) =>
        f.id === updatedRoom.floorId
          ? { ...f, rooms: f.rooms.map((r) => (r.id === updatedRoom.id ? updatedRoom : r)) }
          : f,
      ),
    );
    // Stage 21 QA bug #12: keep the just-converted wall selected when converting
    // PLAIN → PARTITION so the detail panel remains visible immediately after.
    //
    // Bug 7 (bugs-3.md): when REMOVING a partition (PARTITION → PLAIN), the side
    // that was selected no longer has a partition — the right rail would show a
    // stale "wall still selected" state.  Detect the direction by checking whether
    // the updated side at layoutSideSelection is now PLAIN, and if so, clear the
    // selection back to "nothing selected" (same as the initial layout state).
    setLayoutSideSelection((prev) => {
      if (prev === null) return prev;
      const updatedSide = updatedRoom.sides[prev];
      if (!updatedSide) return null; // side index no longer valid
      // If the side is now PLAIN, this was a removal — clear selection.
      if (updatedSide.kind === "PLAIN") return null;
      // PARTITION — conversion case, keep selected (QA bug #12 intent).
      return prev;
    });
    // Side conversion always creates or removes a Partition, which clears
    // designSubmittedAt via replaceSides() (D-18) — refresh the layout
    // breadcrumb so the Summary/Quotation pills lock immediately.
    router.refresh();
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
              {/* Bug 3: "Rooms" h2 label moved into RoomList so it appears
                  below the "Add Room" button. No h2 here any more. */}
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
                  lastSavedPartition={lastSavedPartition}
                  selections={selections}
                />
              ) : null}
            </>
          )}

          {/* Submit Design — unlocks Summary/Quotation (previously auto-unlocked
              at partitionCount>0; now a deliberate action). Pinned to the
              bottom of the left rail via mt-auto. */}
          <div className="mt-auto shrink-0 pt-3">
            {submitDesignError && (
              <p className="mb-2 text-[11px] text-red-700 dark:text-red-400">{submitDesignError}</p>
            )}
            {/*
              Stage 21 QA bug #21: this used to swap to a static "Design
              submitted" paragraph once designSubmittedAt was set, locking the
              button out — even after further edits. Per the approved mockup
              (section 21, "After"), the button's label never changes either —
              it always reads "Submit Design" (only "Submitting…" is a
              legitimate transient label); designSubmittedAt no longer affects
              anything about this button's rendering.
            */}
            <button
              type="button"
              disabled={totalPartitionCount === 0 || submittingDesign}
              onClick={() => void handleSubmitDesign()}
              title={totalPartitionCount === 0 ? t("submitDesignDisabledHint") : undefined}
              className="w-full rounded-sm bg-primary px-3 py-2 text-[12.5px] font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingDesign ? t("submitting") : t("submitDesign")}
            </button>
          </div>
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
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-[14px_18px]"
              onClick={(e) => e.stopPropagation()}
            >
              <ConfigureMode
                selections={selections}
                onBack={requestBackFromConfigureMode}
                isDirty={isDirty}
                onSave={() => void handleSave()}
              />
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
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {selectedFloor && (
                    <span className="rounded-pill border border-primary-soft bg-primary-softer px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">
                      {selectedFloor.label}
                    </span>
                  )}
                  <span className="rounded-pill border border-primary-soft bg-primary-softer px-2.5 py-0.5 text-[11px] font-semibold text-primary-dark">
                    {t("convertedWalls", {
                      converted: selectedRoom.sides.filter((s) => s.kind === "PARTITION").length,
                      total: selectedRoom.sides.length,
                    })}
                  </span>
                </div>
              </div>

              {/* Canvas card — mirrors mockup .canvas-wrap so the floor plan sits
                  inside a bordered/shadowed white card instead of floating
                  directly on the page background. */}
              <div className="flex min-h-0 flex-1 items-center justify-center rounded-[8px] border border-[var(--color-border-strong)] bg-bg-white px-[26px] py-[20px] shadow-[0_2px_10px_-4px_rgba(27,40,30,.10)]">
                <RoomFloorPlan
                  room={selectedRoom}
                  partitions={selectedRoomPartitions}
                  selectedIndex={layoutSideSelection}
                  onSelectSide={setLayoutSideSelection}
                />
              </div>

              {/* Legend — sibling BELOW the canvas card, not nested inside it
                  (matches the mockup: it sits on the page background). */}
              <RoomFloorPlanLegend />
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
            onClick: () => unsavedModal.onDiscard(),
            variant: "danger",
          }}
          onConfirm={() => unsavedModal.onSave()}
          onCancel={() => setUnsavedModal(null)}
        />
      )}

      {/* Bug 13: slide-in toast for Submit Design feedback — bottom-right,
          translucent, auto-dismisses after 3 seconds. Reusable component;
          message is set at call-site so the component has no hardcoded copy. */}
      <Toast {...submitToast} />

      {/* Stage 25 B9: problem popup — shown when Submit Design returns 422 + CalculationProblemReport.
          onNavigateToPartition uses enterConfigureMode (which goes through runWithUnsavedGuard)
          so the workspace enters Configure mode directly without a Link navigation — necessary
          because same-page query-string-only navigation does not remount DesignWorkspace and
          the mount-time useEffect that would enter Configure mode never re-fires. */}
      {submitDesignReport && (
        <ProblemPopup
          report={submitDesignReport}
          title={t("designCannotBeSubmitted")}
          orgSlug={orgSlug}
          projectId={projectId}
          isSubdomain={isSubdomain}
          onClose={() => setSubmitDesignReport(null)}
          onNavigateToPartition={(partitionId) => {
            setSubmitDesignReport(null);
            enterConfigureMode(partitionId);
          }}
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
      <DraftProvider selections={props.selections}>
        <DesignWorkspaceInner
          orgSlug={props.orgSlug}
          projectId={props.projectId}
          isSubdomain={props.isSubdomain}
          initialFloors={props.initialFloors}
          selections={props.selections}
          initialOpenRoomId={props.initialOpenRoomId}
          initialPartitionId={props.initialPartitionId}
        />
      </DraftProvider>
    </UnitProvider>
  );
}
