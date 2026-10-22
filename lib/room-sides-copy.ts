import type { RoomSide } from "@/lib/data/rooms";

/**
 * Sides of a duplicated room (Stage 34 S34-5). PURE: no prisma. Same order and kinds as the source;
 * every side gets a fresh id; a PARTITION side points at the copy's new Partition (`partitionIdMap`:
 * source partition id -> new partition id). Throws when a PARTITION side has no mapping.
 */
export function copySides(
  sides: RoomSide[],
  partitionIdMap: ReadonlyMap<string, string>,
  newId: () => string,
): RoomSide[] {
  return sides.map((side): RoomSide => {
    if (side.kind === "PARTITION") {
      const partitionId = partitionIdMap.get(side.partitionId);
      if (!partitionId) throw new Error(`No copied partition for side partition ${side.partitionId}.`);
      return { id: newId(), kind: "PARTITION", partitionId, turnDegrees: side.turnDegrees, lengthMm: null, label: null };
    }
    return {
      id: newId(),
      kind: "PLAIN",
      partitionId: null,
      turnDegrees: side.turnDegrees,
      lengthMm: side.lengthMm,
      label: side.label,
    };
  });
}
