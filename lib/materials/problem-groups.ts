/**
 * Problem popup grouping (Stage 34 Batch 7, S34-7 / D-33, D-34, D-37).
 *
 * PURE: no React, no Prisma. Groups DESIGN-scope problems floor -> room -> wall by the `locus` ids,
 * never by message text, and never relying on input contiguity (the collector sorts by kind, so one
 * wall's problems can be interleaved with another's). Order of floors/rooms/walls = first appearance.
 */
import type { CalculationProblem } from "@/lib/materials/problems";

export interface WallGroup {
  partitionId: string;
  label: string;
  count: number;
  notStarted: number;
  malformed: number;
  /** Null glass cells ("panels without glass"). */
  noGlass: number;
  /** Null door cells ("doors without a component"). */
  noDoor: number;
  /** CELL_UNASSIGNED with no `reason` (older reports): counted, worded neutrally. */
  unassigned: number;
  deleted: number;
  retired: number;
}

export interface RoomGroup {
  roomId: string;
  name: string;
  floorId: string;
  floorName: string;
  walls: WallGroup[];
  /** Problems in this room with no partition locus: shown as plain rows, never dropped. */
  loose: CalculationProblem[];
  count: number;
}

export interface DesignGroups {
  showFloor: boolean;
  rooms: RoomGroup[];
  /** Problems with no room locus at all. */
  loose: CalculationProblem[];
  total: number;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function groupDesignProblems(
  problems: CalculationProblem[],
  opts: { floorCount?: number } = {},
): DesignGroups {
  const rooms: RoomGroup[] = [];
  const roomById = new Map<string, RoomGroup>();
  const wallById = new Map<string, WallGroup>();
  const looseTop: CalculationProblem[] = [];
  const floorIds = new Set<string>();
  let total = 0;

  for (const p of problems) {
    if (p.scope !== "DESIGN") continue;
    total++;
    const l = p.locus;
    if (!l?.roomId) {
      looseTop.push(p);
      continue;
    }
    if (l.floorId) floorIds.add(l.floorId);
    let room = roomById.get(l.roomId);
    if (!room) {
      room = {
        roomId: l.roomId,
        name: l.roomName || "Room",
        floorId: l.floorId ?? "",
        floorName: l.floorName || "Floor",
        walls: [],
        loose: [],
        count: 0,
      };
      roomById.set(l.roomId, room);
      rooms.push(room);
    }
    room.count++;
    if (!l.partitionId) {
      room.loose.push(p);
      continue;
    }
    // Wall key includes the room so a (corrupt) partition id repeated across rooms cannot merge rooms.
    const key = `${l.roomId}|${l.partitionId}`;
    let wall = wallById.get(key);
    if (!wall) {
      wall = {
        partitionId: l.partitionId,
        label: l.partitionLabel || "Wall",
        count: 0,
        notStarted: 0,
        malformed: 0,
        noGlass: 0,
        noDoor: 0,
        unassigned: 0,
        deleted: 0,
        retired: 0,
      };
      wallById.set(key, wall);
      room.walls.push(wall);
    }
    wall.count++;
    if (p.kind === "SELECTION_MISSING") wall.deleted++;
    else if (p.kind === "SELECTION_TYPE_UNKNOWN") wall.retired++;
    else if (p.reason === "NOT_STARTED") wall.notStarted++;
    else if (p.reason === "MALFORMED") wall.malformed++;
    else if (p.reason === "GLASS_CELL") wall.noGlass++;
    else if (p.reason === "DOOR_CELL") wall.noDoor++;
    else wall.unassigned++;
  }

  // Floors must be reordered only when showing them: keep rooms of a floor together, floors in
  // first-appearance order, rooms within a floor in first-appearance order.
  const showFloor = (opts.floorCount ?? floorIds.size) > 1;
  let ordered = rooms;
  if (showFloor) {
    const floorOrder: string[] = [];
    for (const r of rooms) if (!floorOrder.includes(r.floorId)) floorOrder.push(r.floorId);
    ordered = floorOrder.flatMap((f) => rooms.filter((r) => r.floorId === f));
  }
  return { showFloor, rooms: ordered, loose: looseTop, total };
}

/** One wall's summary line, e.g. "2 panels without glass · 1 door without a component". */
export function wallSummary(w: WallGroup): string {
  const parts: string[] = [];
  if (w.notStarted) parts.push("Design not started");
  if (w.malformed) parts.push("Design is incomplete");
  if (w.noGlass) parts.push(`${plural(w.noGlass, "panel", "panels")} without glass`);
  if (w.noDoor) parts.push(`${plural(w.noDoor, "door", "doors")} without a component`);
  if (w.unassigned) parts.push(`${plural(w.unassigned, "cell", "cells")} without a component`);
  if (w.deleted) parts.push(`${plural(w.deleted, "panel uses", "panels use")} a deleted component`);
  if (w.retired) parts.push(`${plural(w.retired, "panel uses", "panels use")} a retired component type`);
  return parts.join(" · ");
}

/** One room's summary line (mockup `roomSummary`). */
export function roomSummary(r: RoomGroup): string {
  const looseN = r.loose.length;
  const onlyGlass =
    looseN === 0 &&
    r.walls.every((w) => w.count === w.noGlass);
  if (r.walls.length === 1 && looseN === 0) return `1 wall · ${wallSummary(r.walls[0])}`;
  const wallsText = r.walls.length > 0 ? `${plural(r.walls.length, "wall", "walls")} · ` : "";
  const tail = onlyGlass
    ? `${plural(r.count, "panel", "panels")} without glass`
    : plural(r.count, "problem", "problems");
  return `${wallsText}${tail}`;
}
