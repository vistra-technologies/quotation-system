import { prisma } from "@/lib/prisma";
import { invalidateProjectCalculation } from "@/lib/data/formula-pin";
import type { SessionData } from "@/lib/session";
import { ownedProjectWhere } from "@/lib/data/ownership";

// ─── Types ──────────────────────────────────────────────────────────────────

// (No dedicated input interface needed — all params are primitives.)

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all floors for a project, ordered by orderIndex (ascending).
 * Tenancy guard: filters by projectId, organizationId AND company ownership of the project (HF-3).
 * A foreign project yields an empty list.
 */
export async function listFloorsByProject(
  session: SessionData,
  projectId: string,
) {
  return prisma.floor.findMany({
    where: {
      projectId,
      organizationId: session.organizationId,
      project: ownedProjectWhere(session),
    },
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
 * Returns null if the project is missing or not owned by the caller (route -> 404).
 * Throws { code: "DUPLICATE_FLOOR_LABEL" } on a concurrent race collision.
 * All other errors propagate to the caller.
 */
export async function createFloorIfNotExists(
  session: SessionData,
  projectId: string,
  label: string,
) {
  const organizationId = session.organizationId;
  try {
    return await prisma.$transaction(async (tx) => {
      // HF-3/HF-5: the caller must own the parent project before any find-or-create.
      // Returns null for a missing or foreign project (caller -> 404).
      const project = await tx.project.findFirst({
        where: { id: projectId, ...ownedProjectWhere(session) },
        select: { id: true },
      });
      if (!project) return null;

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

/**
 * Rename a Floor. Tenancy guard: verifies the floor belongs to the session's
 * org before updating. Returns null if not found (caller -> 404).
 * Throws { code: "DUPLICATE_FLOOR_LABEL" } on a @@unique([projectId, label])
 * collision — mirrors createFloorIfNotExists's own mapping.
 */
export async function renameFloor(
  session: SessionData,
  floorId: string,
  label: string,
) {
  const existing = await prisma.floor.findFirst({
    where: {
      id: floorId,
      organizationId: session.organizationId,
      project: ownedProjectWhere(session),
    },
    select: { id: true },
  });
  if (!existing) return null;

  try {
    return await prisma.floor.update({
      where: { id: floorId },
      data: { label },
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw Object.assign(
        new Error("A floor with this name already exists in this project."),
        { code: "DUPLICATE_FLOOR_LABEL" },
      );
    }
    throw err;
  }
}

/**
 * Delete a Floor. Tenancy guard: verifies the floor belongs to the session's
 * org before deleting. Rooms under it (Room.floorId, onDelete: Cascade) and
 * their Partitions (Partition.roomId, onDelete: Cascade) are removed
 * automatically by the DB — no manual cleanup needed.
 * Returns null if not found (caller -> 404).
 */
export async function deleteFloor(session: SessionData, floorId: string) {
  const existing = await prisma.floor.findFirst({
    where: {
      id: floorId,
      organizationId: session.organizationId,
      project: ownedProjectWhere(session),
    },
    select: { id: true, projectId: true },
  });
  if (!existing) return null;

  // Stage 23 D-20: the cascade removes Partitions, so the project's calculation is invalidated in the same tx.
  await prisma.$transaction(async (tx) => {
    await tx.floor.delete({ where: { id: floorId } });
    await invalidateProjectCalculation(tx, existing.projectId);
  });
  return { id: existing.id };
}
