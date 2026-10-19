import type { Prisma } from "@/app/generated/prisma/client";
import { fillDefaultGlass, isGlassCell, type DesignSectionV2 } from "@/lib/partition-design";

// Stage 34 S34-7: a project's default glass is its first GLASS Selection (lowest orderIndex, then oldest).
// This module takes the client as an argument and never imports `@/lib/prisma`, so the back-fill script
// (prisma/backfill-default-glass.ts) can share it with the app.

/** Anything with the Prisma delegates used here: the app's client, a transaction, or the script's client. */
type Db = Pick<Prisma.TransactionClient, "selection" | "partition">;

export async function findDefaultGlassSelectionId(
  client: Pick<Prisma.TransactionClient, "selection">,
  projectId: string,
): Promise<string | null> {
  const row = await client.selection.findFirst({
    where: { projectId, componentType: { code: "GLASS" } },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Fill the null glass cells of every v2 partition of the project with `glassId` and persist the changed
 * ones. Returns the number of partitions and cells changed. Does NOT invalidate the calculation — the
 * caller does, in the same transaction, when `partitions > 0`.
 */
export async function fillProjectNullGlass(
  tx: Db,
  organizationId: string,
  projectId: string,
  glassId: string,
): Promise<{ partitions: number; cells: number }> {
  const rows = await tx.partition.findMany({
    where: { organizationId, room: { floor: { projectId } } },
    select: { id: true, design: true },
  });
  let partitions = 0;
  let cells = 0;
  for (const row of rows) {
    const design = row.design as Record<string, unknown> | null;
    if (!design || design.schemaVersion !== 2 || !Array.isArray(design.sections)) continue;
    const before = design.sections as DesignSectionV2[];
    const filled = fillDefaultGlass(before, glassId);
    if (!filled.changed) continue;
    await tx.partition.update({
      where: { id: row.id },
      data: { design: { ...design, sections: filled.sections } as unknown as Prisma.InputJsonValue },
    });
    partitions++;
    cells += countNullGlass(before);
  }
  return { partitions, cells };
}

function countNullGlass(sections: DesignSectionV2[]): number {
  let n = 0;
  for (const s of sections) {
    s.cells.forEach((c, i) => {
      if (!c.selectionId && isGlassCell(s, i)) n++;
    });
  }
  return n;
}
