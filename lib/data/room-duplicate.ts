import { prisma } from "@/lib/prisma";
import { invalidateProjectCalculation } from "@/lib/data/formula-pin";
import type { Prisma } from "@/app/generated/prisma/client";
import type { SessionData } from "@/lib/session";
import { ownedProjectWhere } from "@/lib/data/ownership";
import { createPartitionInTx } from "@/lib/data/partitions";
import type { RoomSide } from "@/lib/data/rooms";
import { cloneDesignWithFreshIds } from "@/lib/partition-design";
import { copySides } from "@/lib/room-sides-copy";

function duplicateLabelError() {
  return Object.assign(new Error("A room with this name already exists on this floor."), {
    code: "DUPLICATE_ROOM_LABEL",
  });
}

/**
 * Stage 34 S34-5: copy one room (same floor, MAX+1 orderIndex, isClosed copied) with a new Partition per
 * PARTITION side, in one transaction. Partitions are numbered by createPartitionInTx (MAX+1 per org), keep
 * label/heightMm/widthMm, start DRAFT and get a deep-copied design with fresh section/cell ids. Selections
 * are not copied. The project's calculation is invalidated in the same transaction.
 *
 * Tenancy: the source must be in the session's org and (external users) in a project of the session's
 * company; otherwise returns null (caller -> the same 404 as a nonexistent id).
 * Throws { code: "DUPLICATE_ROOM_LABEL" } when the floor already has a room with this label (pre-check,
 * or a P2002 that a label re-check confirms). No project-status gate (D-3).
 */
export async function duplicateRoom(session: SessionData, roomId: string, label: string) {
  let floorId: string | null = null;
  try {
    return await prisma.$transaction(async (tx) => {
      const source = await tx.room.findFirst({
        where: {
          id: roomId,
          organizationId: session.organizationId,
          floor: { project: ownedProjectWhere(session) },
        },
        include: { floor: { select: { projectId: true } } },
      });
      if (!source) return null;
      floorId = source.floorId;

      const taken = await tx.room.findFirst({ where: { floorId: source.floorId, label }, select: { id: true } });
      if (taken) throw duplicateLabelError();

      const sides = Array.isArray(source.sides) ? (source.sides as unknown as RoomSide[]) : [];
      const sourcePartitionIds = sides.flatMap((s) => (s.kind === "PARTITION" ? [s.partitionId] : []));
      const sourcePartitions = sourcePartitionIds.length
        ? await tx.partition.findMany({
            where: { id: { in: sourcePartitionIds }, organizationId: session.organizationId, roomId: source.id },
          })
        : [];
      const byId = new Map(sourcePartitions.map((p) => [p.id, p]));
      for (const id of sourcePartitionIds) {
        if (!byId.has(id)) throw new Error(`Room ${source.id} references a missing partition ${id}.`);
      }

      const max = await tx.room.aggregate({
        where: { floorId: source.floorId, organizationId: session.organizationId },
        _max: { orderIndex: true },
      });
      const room = await tx.room.create({
        data: {
          organizationId: session.organizationId,
          floorId: source.floorId,
          label,
          orderIndex: (max._max.orderIndex ?? -1) + 1,
          isClosed: source.isClosed,
          sides: [],
        },
      });

      // Sequential on purpose: createPartitionInTx numbers MAX+1, so parallel calls would collide.
      const idMap = new Map<string, string>();
      for (const side of sides) {
        if (side.kind !== "PARTITION") continue;
        const src = byId.get(side.partitionId)!;
        const created = await createPartitionInTx(tx, {
          roomId: room.id,
          label: src.label,
          heightMm: src.heightMm,
          widthMm: src.widthMm,
          organizationId: session.organizationId,
        });
        if (src.design != null) {
          await tx.partition.update({
            where: { id: created.id },
            data: {
              design: cloneDesignWithFreshIds(src.design, () => crypto.randomUUID()) as Prisma.InputJsonValue,
            },
          });
        }
        idMap.set(src.id, created.id);
      }

      const copied = await tx.room.update({
        where: { id: room.id },
        data: { sides: copySides(sides, idMap, () => crypto.randomUUID()) as unknown as Prisma.InputJsonValue },
      });
      await invalidateProjectCalculation(tx, source.floor.projectId);
      return copied;
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") {
      // The room label unique and the partitionNumber unique both raise P2002: only a taken label is a 409.
      if (floorId) {
        const taken = await prisma.room.findFirst({ where: { floorId, label }, select: { id: true } });
        if (taken) throw duplicateLabelError();
      }
    }
    throw err;
  }
}
