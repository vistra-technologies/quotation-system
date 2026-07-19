import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreatePartitionInput {
  floorId: string;
  location: string;
  heightMm: number;
  widthMm: number;
  organizationId: string;
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all partitions for a floor, ordered by partitionNumber (ascending).
 * Tenancy guard: filters by both floorId AND organizationId.
 */
export async function listPartitionsByFloor(
  floorId: string,
  organizationId: string,
) {
  return prisma.partition.findMany({
    where: { floorId, organizationId },
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
 * Create a new Partition scoped to the session org.
 *
 * `partitionNumber` is assigned as MAX(partitionNumber) + 1 across ALL
 * partitions for the org, inside a transaction. The sequence is org-wide
 * (matching the @@unique([organizationId, partitionNumber]) DB constraint)
 * — the same pattern as Project.@@unique([organizationId, projectNumber])
 * with its org-scoped MAX in createProject().
 *
 * Steps inside the transaction:
 * 1. Verify floorId belongs to the session's org (prevents cross-tenant FK reference).
 * 2. Aggregate MAX(partitionNumber) across ALL Partitions for the org
 *    (`where: { organizationId }`), matching the scope of the DB constraint.
 * 3. Assign partitionNumber = max + 1 and create the Partition row.
 *
 * Throws { code: "FLOOR_NOT_FOUND" } if floorId doesn't resolve within the org.
 * Throws { code: "SEQUENCE_CONFLICT" } on a concurrent partitionNumber race
 *   (P2002 from the @@unique([organizationId, partitionNumber]) DB constraint).
 * All other errors propagate.
 */
export async function createPartition(input: CreatePartitionInput) {
  const { floorId, location, heightMm, widthMm, organizationId } = input;

  try {
    return await prisma.$transaction(async (tx) => {
      // Step 1: tenancy guard — verify the floor belongs to the session's org.
      const floor = await tx.floor.findFirst({
        where: { id: floorId, organizationId },
        select: { id: true },
      });
      if (!floor) {
        throw Object.assign(new Error("Floor not found or access denied."), {
          code: "FLOOR_NOT_FOUND",
        });
      }

      // Step 2: find the highest partitionNumber across ALL partitions for the org.
      const max = await tx.partition.aggregate({
        where: { organizationId },
        _max: { partitionNumber: true },
      });
      const partitionNumber = (max._max.partitionNumber ?? 0) + 1;

      // Step 3: create the Partition.
      return tx.partition.create({
        data: {
          organizationId,
          floorId,
          partitionNumber,
          location,
          heightMm,
          widthMm,
          status: "DRAFT",
        },
      });
    });
  } catch (err) {
    // Re-throw our own structured errors unchanged.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "FLOOR_NOT_FOUND"
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
