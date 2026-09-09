"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { NewRoomForm } from "./new-room-form";
import { PartitionPreview } from "./partition-preview";
import type { PartitionRow, RoomRow } from "./types";

interface RoomListProps {
  orgSlug: string;
  isSubdomain: boolean;
  floorId: string;
  rooms: RoomRow[];
  selectedRoomId: string | null;
  onSelectRoom: (room: RoomRow) => void;
  onRoomCreated: (room: RoomRow) => void;
}

/**
 * Left-rail room list — collapsible room groups + "+ Add Room", scoped to
 * the currently selected floor (mirrors design-step-poc.html's
 * `renderRoomList`, which filters to `roomsForFloor()`). Replaces
 * design-left-rail.tsx.
 *
 * Per-side conversion happens via the floor-plan diagram
 * (room-floor-plan.tsx, click a side) + the right-rail form
 * (layout-mode-panel.tsx) — matching design-step-poc.html's own split
 * (the room list only shows already-converted partitions; the wall-bar
 * diagram is where a plain side gets clicked to convert). Selecting a room
 * is pure client state (no redirect) — the parent (design-workspace.tsx)
 * owns selectedRoomId/viewMode (plan-item7.md flag 6).
 */
export function RoomList({
  orgSlug,
  isSubdomain,
  floorId,
  rooms,
  selectedRoomId,
  onSelectRoom,
  onRoomCreated,
}: RoomListProps) {
  const t = useTranslations("design");

  const [expandedRoomIds, setExpandedRoomIds] = useState<Set<string>>(new Set());
  const [addingRoom, setAddingRoom] = useState(false);
  // Partitions fetched lazily per expanded room (a PARTITION side carries no
  // label/dimensions of its own — see types.ts RoomSide).
  const [partitionsByRoom, setPartitionsByRoom] = useState<
    Record<string, PartitionRow[]>
  >({});

  // Coverage-checked refetch (review-item3.md IMPORTANT 1's fix, ported):
  // only skip a room's refetch when every one of its PARTITION-side
  // partitionIds is already present in the cached array.
  useEffect(() => {
    for (const room of rooms) {
      if (!expandedRoomIds.has(room.id)) continue;
      const partitionSideIds = room.sides
        .filter((s): s is Extract<RoomRow["sides"][number], { kind: "PARTITION" }> => s.kind === "PARTITION")
        .map((s) => s.partitionId);
      if (partitionSideIds.length === 0) continue;

      const cached = partitionsByRoom[room.id];
      const fullyCovered =
        cached !== undefined &&
        partitionSideIds.every((id) => cached.some((p) => p.id === id));
      if (fullyCovered) continue;

      fetch(`/api/v1/orgs/${orgSlug}/partitions?roomId=${room.id}`)
        .then((res) => (res.ok ? res.json() : { partitions: [] }))
        .then((data: { partitions: PartitionRow[] }) => {
          setPartitionsByRoom((prev) => ({ ...prev, [room.id]: data.partitions }));
        })
        .catch(() => {
          setPartitionsByRoom((prev) => ({ ...prev, [room.id]: [] }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rooms is a fresh prop each render; re-running per room/partitionsByRoom change is what we want.
  }, [rooms, expandedRoomIds, orgSlug]);

  function toggleRoom(room: RoomRow) {
    setExpandedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(room.id)) next.delete(room.id);
      else next.add(room.id);
      return next;
    });
    onSelectRoom(room);
  }

  const totalPartitions = rooms.reduce(
    (sum, r) => sum + r.sides.filter((s) => s.kind === "PARTITION").length,
    0,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-3 shrink-0 text-[11.5px] text-text-muted">
        {t("roomsSummary", { rooms: rooms.length, partitions: totalPartitions })}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-0.5">
          {rooms.map((room) => {
            const expanded = expandedRoomIds.has(room.id);
            const isActiveRoom = selectedRoomId === room.id;
            return (
              <li key={room.id} className={expanded ? "" : "border-b border-border pb-1"}>
                <button
                  type="button"
                  onClick={() => toggleRoom(room)}
                  className={
                    "flex w-full items-center gap-1.5 rounded-sm px-1 py-1.5 text-left hover:bg-primary-softer" +
                    (isActiveRoom ? " bg-primary-softer" : "")
                  }
                >
                  <span
                    className={
                      "inline-block text-[11px] text-text-muted transition-transform" +
                      (expanded ? " rotate-90" : "")
                    }
                  >
                    ›
                  </span>
                  <span className="flex-1 truncate text-xs font-bold text-text-heading">
                    {room.label}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-muted">
                    {t("sidesCount", { count: room.sides.length })}
                  </span>
                </button>

                {expanded && (
                  <div className="ml-2 flex flex-col gap-1 border-l border-border py-1 pl-3">
                    {room.sides.filter((s) => s.kind === "PARTITION").length === 0 ? (
                      <p className="px-1 py-1 text-[11px] text-text-muted">
                        {t("noPartitionsYet")}
                      </p>
                    ) : null}
                    {room.sides.map((side, sideIndex) => {
                      if (side.kind === "PLAIN") return null;
                      const partition = partitionsByRoom[room.id]?.find(
                        (p) => p.id === side.partitionId,
                      );
                      return (
                        <div
                          key={sideIndex}
                          className="rounded-sm border-l-2 border-primary bg-primary-softer px-2.5 py-1.5 text-xs"
                        >
                          {partition ? (
                            <>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate font-bold text-text-heading">
                                  {partition.label}
                                </span>
                              </div>
                              <PartitionPreview partition={partition} />
                            </>
                          ) : (
                            <span className="text-text-muted">{t("loadingPartition")}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {addingRoom ? (
          <NewRoomForm
            orgSlug={orgSlug}
            isSubdomain={isSubdomain}
            floorId={floorId}
            onCancel={() => setAddingRoom(false)}
            onCreated={(room) => {
              setAddingRoom(false);
              onRoomCreated(room);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingRoom(true)}
            className="mt-2 w-full rounded-sm border border-dashed border-primary-soft px-3 py-2 text-center text-xs font-bold text-primary-dark hover:bg-primary-softer"
          >
            {t("newRoom")}
          </button>
        )}
      </div>
    </div>
  );
}
