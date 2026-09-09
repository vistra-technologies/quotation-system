"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { NewRoomForm } from "./new-room-form";
import { ConvertSideForm } from "./convert-side-form";

// ─── Types (API response shapes, duplicated from lib/data/rooms.ts /
// lib/data/partitions.ts to avoid bundling server-only DAL code into this
// Client Component — same convention as configuration/page.tsx) ───────────

type RoomSide =
  | {
      id: string;
      kind: "PLAIN";
      partitionId: null;
      turnDegrees: number;
      lengthMm: number | null;
      label: string | null;
    }
  | {
      id: string;
      kind: "PARTITION";
      partitionId: string;
      turnDegrees: number;
      lengthMm: null;
      label: null;
    };

export interface RoomRow {
  id: string;
  floorId: string;
  label: string;
  isClosed: boolean;
  sides: RoomSide[];
}

export interface FloorWithRooms {
  id: string;
  label: string;
  rooms: RoomRow[];
}

interface PartitionRow {
  id: string;
  label: string;
  heightMm: number;
  widthMm: number;
}

interface DesignLeftRailProps {
  orgSlug: string;
  projectId: string;
  floors: FloorWithRooms[];
  /** Room to auto-expand on mount — from ?openRoom= after a create/convert redirect. */
  initialOpenRoomId: string | null;
}

/**
 * Left rail of the design page (Stage 18 rework) — Floor -> Room -> sides.
 *
 * Per plan-item3.md flag 4: sides render as a simple ORDERED LIST (array
 * order = topology), not a 4-bar N/S/E/W square — the mockup
 * (design-step-poc.html) is an interaction-pattern reference only, not a
 * literal layout spec.
 *
 * Per plan-item3.md flag 5 (GATE A, cut): PLAIN sides are READ-ONLY here —
 * label/lengthMm display only, no inline editor. The only PLAIN-side action
 * is "Convert to Partition".
 *
 * Per review-item2-round2.md finding 9: a PLAIN side's `id` is not stable
 * across reorders (only PARTITION side ids are, matched server-side by
 * partitionId). This component never keys UI state off `side.id` for PLAIN
 * sides — the convert form is passed the side's ARRAY INDEX, and every
 * mutation redirects through the server action (which re-fetches fresh data
 * via router refresh), so there is no optimistic client-side patch-by-id to
 * go stale.
 */
export function DesignLeftRail({
  orgSlug,
  projectId,
  floors,
  initialOpenRoomId,
}: DesignLeftRailProps) {
  const t = useTranslations("design");

  const [expandedRoomIds, setExpandedRoomIds] = useState<Set<string>>(
    () => new Set(initialOpenRoomId ? [initialOpenRoomId] : []),
  );
  const [newRoomFloorId, setNewRoomFloorId] = useState<string | null>(null);
  const [convertingSide, setConvertingSide] = useState<{
    roomId: string;
    floorId: string;
    sideIndex: number;
  } | null>(null);
  // Partitions fetched lazily per room (only rooms with a PARTITION side need
  // this — Room.sides carries no label/dimensions for a PARTITION element,
  // see RoomSide's type comment).
  const [partitionsByRoom, setPartitionsByRoom] = useState<
    Record<string, PartitionRow[]>
  >({});

  // Fetch partitions for any expanded room that has PARTITION sides not yet
  // covered by the cache. Plain browser fetch() — precedent:
  // app/controls/(authenticated)/orgs/_suspend-button.tsx calls /api/v1/...
  // directly from a Client Component (cookies flow same-origin).
  //
  // Review-item3.md IMPORTANT 1: the cache check must be COVERAGE, not
  // PRESENCE. A server-action redirect() (e.g. after converting a side) is a
  // soft navigation — this component stays mounted, so a stale
  // partitionsByRoom[room.id] entry from an earlier fetch survives. Checking
  // only "does an entry exist for this room" meant a *second* convert in the
  // same room never refetched (the entry from the first convert already
  // existed), leaving the newly-converted side stuck on the loading
  // placeholder. Instead, check that every PARTITION side's partitionId in
  // the room's current `sides` is actually present in the cached array —
  // refetch whenever one is missing.
  useEffect(() => {
    for (const floor of floors) {
      for (const room of floor.rooms) {
        if (!expandedRoomIds.has(room.id)) continue;
        const partitionSideIds = room.sides
          .filter((s): s is Extract<RoomSide, { kind: "PARTITION" }> => s.kind === "PARTITION")
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
            setPartitionsByRoom((prev) => ({
              ...prev,
              [room.id]: data.partitions,
            }));
          })
          .catch(() => {
            setPartitionsByRoom((prev) => ({ ...prev, [room.id]: [] }));
          });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- floors is a fresh server-fetched prop each render; re-running per room-id/partitionsByRoom change is what we want.
  }, [floors, expandedRoomIds]);

  function toggleRoom(roomId: string) {
    setExpandedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {floors.map((floor) => (
        <div key={floor.id}>
          <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-text-body">
            {floor.label}
          </h3>

          <ul className="flex flex-col gap-1">
            {floor.rooms.map((room) => {
              const expanded = expandedRoomIds.has(room.id);
              return (
                <li key={room.id}>
                  <button
                    type="button"
                    onClick={() => toggleRoom(room.id)}
                    className="flex w-full items-center justify-between rounded-sm border border-border bg-primary-softer px-3 py-2 text-left text-xs font-semibold text-text-body hover:bg-primary-soft"
                  >
                    <span>
                      {expanded ? "▾" : "▸"} {room.label}
                    </span>
                    <span className="text-[10px] font-normal text-text-muted">
                      {t("sidesCount", { count: room.sides.length })}
                    </span>
                  </button>

                  {expanded && (
                    <ol className="ml-3 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                      {room.sides.map((side, sideIndex) => {
                        const isConvertingThis =
                          convertingSide?.roomId === room.id &&
                          convertingSide?.sideIndex === sideIndex;

                        if (side.kind === "PLAIN") {
                          return (
                            <li key={sideIndex} className="text-xs">
                              <div className="flex items-center justify-between gap-2 rounded-sm border border-border bg-bg-white px-2.5 py-1.5">
                                <span className="text-text-body">
                                  {side.label ?? t("untitledSide")}
                                  {side.lengthMm != null
                                    ? ` — ${side.lengthMm} mm`
                                    : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConvertingSide(
                                      isConvertingThis
                                        ? null
                                        : { roomId: room.id, floorId: floor.id, sideIndex },
                                    )
                                  }
                                  className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-primary hover:underline"
                                >
                                  {t("convertToPartition")}
                                </button>
                              </div>
                              {isConvertingThis && (
                                <ConvertSideForm
                                  orgSlug={orgSlug}
                                  projectId={projectId}
                                  floorId={floor.id}
                                  roomId={room.id}
                                  sideIndex={sideIndex}
                                  onCancel={() => setConvertingSide(null)}
                                />
                              )}
                            </li>
                          );
                        }

                        // PARTITION side — label/dimensions come from the
                        // Partition row (lazily fetched above). No dedicated
                        // partition edit page exists in the repo yet
                        // (confirmed — no app/[orgSlug]/**/partitions/[id]
                        // route), so this row is informational only.
                        const partition = partitionsByRoom[room.id]?.find(
                          (p) => p.id === side.partitionId,
                        );
                        return (
                          <li
                            key={sideIndex}
                            className="rounded-sm border border-border bg-primary-softer px-2.5 py-1.5 text-xs text-text-body"
                          >
                            {partition
                              ? `${partition.label} — ${partition.heightMm} × ${partition.widthMm} mm`
                              : t("loadingPartition")}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>

          {newRoomFloorId === floor.id ? (
            <NewRoomForm
              orgSlug={orgSlug}
              projectId={projectId}
              floorId={floor.id}
              onCancel={() => setNewRoomFloorId(null)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setNewRoomFloorId(floor.id)}
              className="mt-1 w-full rounded-sm border border-dashed border-border px-3 py-1.5 text-xs text-text-muted hover:border-primary hover:text-primary"
            >
              {t("newRoom")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
