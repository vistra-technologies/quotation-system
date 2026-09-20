import { prisma } from "@/lib/prisma";
import { invalidateProjectCalculation } from "@/lib/data/formula-pin";
import type { Prisma } from "@/app/generated/prisma/client";
import type { SessionData } from "@/lib/session";
import {
  PartitionDesignError,
  assertSectionHeights,
  collectSelectionIds,
  sumSectionWidths,
  type DesignSectionV2,
  type DesignStops,
  type PartitionDesignPatch,
} from "@/lib/partition-design";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreatePartitionInput {
  roomId: string;
  label: string;
  heightMm: number;
  widthMm: number;
  organizationId: string;
}

export type { PartitionDesignPatch } from "@/lib/partition-design";

export interface UpdatePartitionPatch {
  label?: string;
  heightMm?: number;
  /** Validated v2 body (parseDesignPatch) — partial-replace onto the stored document. */
  design?: PartitionDesignPatch;
}

/** Thrown by updatePartition() when the design breaks an invariant (per-section height sum) or
 * references a Selection that doesn't resolve within the same org + project as this partition.
 * Mapped by the route to a 400. */
export class InvalidDesignError extends Error {}

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

/**
 * Update a Partition's `label`/`heightMm`/`design` (Configure mode's write
 * path). Stage 22 Batch 1: `design` is the v2 `sections[].cells[]` shape
 * (design-docs/04-data-model.md); v1 `panels` bodies are rejected by the
 * route's parseDesignPatch and never reach here.
 *
 * `widthMm` is NOT a direct input: per Stage 18 invariant 3 (a PARTITION
 * side's length on the room's floor plan *is* Partition.widthMm) it is
 * derived server-side as `sum(sections[].widthMm)` whenever
 * `patch.design.sections` is present — never trusted from the client.
 *
 * Height invariant (new in v2, replaces v1's silent normalization): per
 * section, `sum(cells[].heightMm) === effective partition height`, checked
 * whenever sections are written OR the height changes on a stored v2 row.
 * Violations throw InvalidDesignError (400). Note (Stage 22 D-9): a
 * `heightMm`-only PATCH on a v2 row that doesn't also send matching sections
 * is therefore a 400 — the app's UI always sends both together.
 *
 * Cross-tenant reference validation: every `selectionId` in the merged
 * document's cells and `stops.{top,bottom,left,right}` must resolve to a real
 * Selection in the SAME organization AND the same project as this partition's
 * room -> floor -> project chain, else InvalidDesignError (400).
 *
 * Writing sections onto a stored v1 row replaces it wholesale: the legacy
 * `panels` key is dropped, `schemaVersion: 2` is stamped, and
 * stops/measurements/distribution/defaults are preserved unless patched.
 *
 * Tenancy guard: verifies the partition belongs to the session's org before
 * updating. Returns null if not found (caller -> 404).
 *
 * Stage 22 Batch 6 (D-14): if the project's `designSubmittedAt` is set and
 * this PATCH carries `design` or `heightMm` (a geometry-affecting edit,
 * as opposed to a label-only rename), it's cleared back to null in the same
 * transaction as the partition write — re-locking the Summary/Quotation
 * wizard steps until Submit Design is clicked again. Stage 23 (D-17) extends that
 * same transaction via invalidateProjectCalculation(), which also deletes the
 * project's ProjectCalculation and no longer depends on the flag's current value.
 */
export async function updatePartition(
  session: SessionData,
  id: string,
  patch: UpdatePartitionPatch,
) {
  const existing = await prisma.partition.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      room: {
        include: {
          floor: {
            select: {
              projectId: true,
            },
          },
        },
      },
    },
  });
  if (!existing) return null;

  const data: Prisma.PartitionUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.heightMm !== undefined) data.heightMm = patch.heightMm;
  const effectiveHeightMm = patch.heightMm ?? existing.heightMm;

  const previousDesign = (existing.design as Record<string, unknown> | null) ?? {};
  let nextDesign: Record<string, unknown> = previousDesign;
  let designChanged = false;

  if (patch.design !== undefined) {
    // Preserve documented keys this UI pass doesn't render/write
    // (measurements, distribution) rather than dropping them on a partial
    // write — merge onto whatever's already stored, only overwriting the
    // keys actually present in the patch.
    nextDesign = { ...previousDesign };
    designChanged = true;
    if (patch.design.stops !== undefined) nextDesign.stops = patch.design.stops;
    if (patch.design.defaults !== undefined) nextDesign.defaults = patch.design.defaults;
    if (patch.design.measurements !== undefined) nextDesign.measurements = patch.design.measurements;
    if (patch.design.distribution !== undefined) nextDesign.distribution = patch.design.distribution;
    if (patch.design.sections !== undefined) {
      delete nextDesign.panels; // legacy v1 key — a v2 write replaces it
      nextDesign.schemaVersion = 2;
      nextDesign.sections = patch.design.sections;
    }
  }

  // The merged document's v2 sections (patched or already stored), if any.
  const mergedSections =
    nextDesign.schemaVersion === 2 && Array.isArray(nextDesign.sections)
      ? (nextDesign.sections as DesignSectionV2[])
      : undefined;

  if (mergedSections && (patch.design?.sections !== undefined || patch.heightMm !== undefined)) {
    try {
      assertSectionHeights(mergedSections, effectiveHeightMm);
    } catch (err) {
      if (err instanceof PartitionDesignError) throw new InvalidDesignError(err.message);
      throw err;
    }
  }

  if (designChanged) {
    const selectionIds = collectSelectionIds({
      stops: nextDesign.stops as DesignStops | undefined,
      sections: mergedSections,
    });
    if (selectionIds.size > 0) {
      const projectId = existing.room.floor.projectId;
      const found = await prisma.selection.findMany({
        where: {
          id: { in: [...selectionIds] },
          organizationId: session.organizationId,
          projectId,
        },
        select: { id: true },
      });
      const foundIds = new Set(found.map((s) => s.id));
      const missing = [...selectionIds].filter((sid) => !foundIds.has(sid));
      if (missing.length > 0) {
        throw new InvalidDesignError(
          `The following selectionId(s) do not belong to this project: ${missing.join(", ")}`,
        );
      }
    }

    // Derive widthMm from the sections whenever they're being written —
    // server-authoritative, never trusts a client-supplied widthMm.
    if (patch.design?.sections !== undefined) {
      data.widthMm = sumSectionWidths(patch.design.sections);
    }
    data.design = nextDesign as unknown as Prisma.InputJsonValue;
  }

  // Stage 22 D-14: a PATCH that carries `design` or `heightMm` is a
  // geometry-affecting edit — it invalidates any prior Summary/Quotation
  // calculation, so a submitted design must be re-submitted. Label-only
  // edits don't touch geometry and leave the flag alone. No query is issued
  // when the flag is already null.
  const projectId = existing.room.floor.projectId;
  const geometryChanged = patch.design !== undefined || patch.heightMm !== undefined;

  // Stage 23 D-17: NOT gated on designSubmittedAt — a calculation can exist with a null flag (after a
  // Recompute, or an earlier edit already cleared it). The shared helper deletes the calculation
  // (no-op-safe) and clears designSubmittedAt only when non-null.
  if (geometryChanged) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.partition.update({ where: { id }, data });
      await invalidateProjectCalculation(tx, projectId);
      return updated;
    });
  }

  return prisma.partition.update({ where: { id }, data });
}
