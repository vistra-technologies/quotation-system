import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreatePartitionInput {
  roomId: string;
  label: string;
  heightMm: number;
  widthMm: number;
  organizationId: string;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all partitions for a room, ordered by partitionNumber (ascending).
 * Tenancy guard: filters by both roomId AND organizationId.
 */
export async function listPartitionsByRoom(
  roomId: string,
  organizationId: string,
) {
  return prisma.partition.findMany({
    where: { roomId, organizationId },
    orderBy: { partitionNumber: "asc" },
  });
}

/**
 * Get a single partition by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getPartitionById(id: string, organizationId: string) {
  return prisma.partition.findFirst({
    where: { id, organizationId },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Create a Partition inside an already-open transaction — the shared step
 * used by both createPartition() below and lib/data/rooms.ts's
 * replaceSides() (which opens its own transaction for the plain->partition
 * convert compound op and cannot nest a second prisma.$transaction()).
 *
 * `partitionNumber` is assigned as MAX(partitionNumber) + 1 across ALL
 * partitions for the org, matching the @@unique([organizationId,
 * partitionNumber]) DB constraint (same pattern as
 * Project.@@unique([organizationId, projectNumber])).
 *
 * Steps:
 * 1. Verify roomId belongs to the session's org (prevents cross-tenant FK reference).
 * 2. Aggregate MAX(partitionNumber) across ALL Partitions for the org.
 * 3. Assign partitionNumber = max + 1 and create the Partition row.
 *
 * Throws { code: "ROOM_NOT_FOUND" } if roomId doesn't resolve within the org.
 * A P2002 race on the @@unique constraint propagates unchanged — callers that
 * want the friendlier { code: "SEQUENCE_CONFLICT" } mapping should use
 * createPartition() below, which wraps this in its own transaction + catch.
 */
export async function createPartitionInTx(
  tx: Prisma.TransactionClient,
  input: CreatePartitionInput,
) {
  const { roomId, label, heightMm, widthMm, organizationId } = input;

  const room = await tx.room.findFirst({
    where: { id: roomId, organizationId },
    select: { id: true },
  });
  if (!room) {
    throw Object.assign(new Error("Room not found or access denied."), {
      code: "ROOM_NOT_FOUND",
    });
  }

  const max = await tx.partition.aggregate({
    where: { organizationId },
    _max: { partitionNumber: true },
  });
  const partitionNumber = (max._max.partitionNumber ?? 0) + 1;

  return tx.partition.create({
    data: {
      organizationId,
      roomId,
      partitionNumber,
      label,
      heightMm,
      widthMm,
      status: "DRAFT",
    },
  });
}

/**
 * Create a new Partition scoped to the session org, in its own transaction.
 * Thin wrapper around createPartitionInTx() — see that function for the
 * step-by-step behavior. This is the standalone entry point (e.g. for a
 * future direct "create wall" flow); lib/data/rooms.ts's replaceSides() calls
 * createPartitionInTx() directly instead, since it needs the create to run
 * inside its own already-open transaction.
 *
 * Throws { code: "ROOM_NOT_FOUND" } if roomId doesn't resolve within the org.
 * Throws { code: "SEQUENCE_CONFLICT" } on a concurrent partitionNumber race
 *   (P2002 from the @@unique([organizationId, partitionNumber]) DB constraint).
 * All other errors propagate.
 */
export async function createPartition(input: CreatePartitionInput) {
  try {
    return await prisma.$transaction((tx) => createPartitionInTx(tx, input));
  } catch (err) {
    // Re-throw our own structured errors unchanged.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "ROOM_NOT_FOUND"
    ) {
      throw err;
    }
    // P2002 on @@unique([organizationId, partitionNumber]) = concurrent race collision.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw Object.assign(
        new Error("Partition number conflict — please try again."),
        { code: "SEQUENCE_CONFLICT" },
      );
    }
    throw err;
  }
}
