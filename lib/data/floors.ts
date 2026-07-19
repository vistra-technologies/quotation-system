import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

// (No dedicated input interface needed — all params are primitives.)

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all floors for a project, ordered by orderIndex (ascending).
 * Tenancy guard: filters by both projectId AND organizationId.
 */
export async function listFloorsByProject(
  projectId: string,
  organizationId: string,
) {
  return prisma.floor.findMany({
    where: { projectId, organizationId },
    orderBy: { orderIndex: "asc" },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Return an existing Floor matching (projectId, label), or create one.
 *
 * Idempotent by label within a project — the add-wall form passes the user's
 * typed floor label; if the label already exists the existing row is returned
 * without creating a duplicate. If it doesn't exist yet, it's created with
 * orderIndex = MAX(orderIndex for the project) + 1.
 *
 * The @@unique([projectId, label]) DB constraint is the real collision guard;
 * a concurrent race that slips through the findFirst is caught as P2002 and
 * surfaced as { code: "DUPLICATE_FLOOR_LABEL" }.
 *
 * Throws { code: "DUPLICATE_FLOOR_LABEL" } on a concurrent race collision.
 * All other errors propagate to the caller.
 */
export async function createFloorIfNotExists(
  projectId: string,
  label: string,
  organizationId: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Return the existing floor if the label is already in use for this project.
      const existing = await tx.floor.findFirst({
        where: { projectId, label, organizationId },
      });
      if (existing) return existing;

      // Compute the next orderIndex: MAX(orderIndex) + 1 within the project, or 0.
      const max = await tx.floor.aggregate({
        where: { projectId, organizationId },
        _max: { orderIndex: true },
      });
      const orderIndex = (max._max.orderIndex ?? -1) + 1;

      return tx.floor.create({
        data: {
          organizationId,
          projectId,
          label,
          orderIndex,
        },
      });
    });
  } catch (err) {
    // P2002 on (projectId, label) = concurrent race creating the same label.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      // On concurrent collision, re-fetch and return the winning row.
      const winner = await prisma.floor.findFirst({
        where: { projectId, label, organizationId },
      });
      if (winner) return winner;
      throw Object.assign(
        new Error("Floor label conflict — please try again."),
        { code: "DUPLICATE_FLOOR_LABEL" },
      );
    }
    throw err;
  }
}
