import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import type { SessionData } from "@/lib/session";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreatePartitionInput {
  roomId: string;
  label: string;
  heightMm: number;
  widthMm: number;
  organizationId: string;
}

/** A door placed on a panel. `hinging` has no picker in this UI pass (Stage
 * 18 item 7 plan flag 5, architect-approved) — always defaulted to "left" by
 * the caller; the DAL doesn't enforce that, it just passes the shape
 * through. */
export interface DesignDoor {
  selectionId: string;
  hinging: "left" | "right";
  outerFrame?: { w: number; h: number };
}

/** One pane in `Partition.design.panels[]`. No `index` field — array
 * position is authoritative (04-data-model.md's own ruling, and the
 * architect's binding correction for this piece: `panels[].index` was
 * redundant and must not be added even though the mockup's implicit model
 * has one). */
export interface DesignPanel {
  id: string;
  type: "glass" | "door";
  widthMm: number;
  heightMm: number;
  selectionId: string | null;
  door?: DesignDoor | null;
}

export interface DesignStops {
  top?: string | null;
  bottom?: string | null;
  left?: string | null;
  right?: string | null;
}

/**
 * `Partition.design` JSONB shape (04-data-model.md). `measurements` and
 * `distribution` are documented keys this UI pass doesn't render or write —
 * updatePartition() below preserves them untouched on any partial `design`
 * write rather than dropping them.
 */
export interface PartitionDesign {
  measurements?: unknown;
  distribution?: unknown;
  stops?: DesignStops;
  panels?: DesignPanel[];
}

export interface UpdatePartitionPatch {
  label?: string;
  heightMm?: number;
  design?: PartitionDesign;
}

/** Thrown by updatePartition() when `design.panels`/`design.stops` reference
 * a Selection that doesn't resolve within the same org + project as this
 * partition. Mapped by the route to a 400. */
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
 * path — Stage 18 item 7 Piece 2). `widthMm` is NOT a direct input: per
 * Stage 18 invariant 3 (a PARTITION side's length on the room's floor plan
 * *is* Partition.widthMm), it is derived server-side from
 * `sum(design.panels[].widthMm)` whenever `patch.design.panels` is present —
 * never trusted from the client, so the canvas and the floor plan can never
 * desync.
 *
 * Cross-tenant reference validation: every `selectionId` referenced in
 * `patch.design` (`panels[].selectionId`, `panels[].door.selectionId`,
 * `stops.{top,bottom,left,right}`) must resolve to a real Selection in the
 * SAME organization AND the same project as this partition's own
 * room -> floor -> project chain. A client-planted foreign-org or
 * foreign-project selectionId is rejected with InvalidDesignError (mapped to
 * 400 by the route) rather than silently written — same class of invariant
 * lib/data/rooms.ts replaceSides() enforces for partitionId.
 *
 * Tenancy guard: verifies the partition belongs to the session's org before
 * updating. Returns null if not found (caller -> 404).
 */
export async function updatePartition(
  session: SessionData,
  id: string,
  patch: UpdatePartitionPatch,
) {
  const existing = await prisma.partition.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { room: { include: { floor: { select: { projectId: true } } } } },
  });
  if (!existing) return null;

  const data: Prisma.PartitionUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.heightMm !== undefined) data.heightMm = patch.heightMm;

  if (patch.design !== undefined) {
    // Preserve documented keys this UI pass doesn't render/write
    // (measurements, distribution) rather than dropping them on a partial
    // write — merge onto whatever's already stored, only overwriting the
    // keys actually present in the patch.
    const previousDesign = (existing.design as PartitionDesign | null) ?? {};
    const nextDesign: PartitionDesign = { ...previousDesign };
    if (patch.design.stops !== undefined) nextDesign.stops = patch.design.stops;
    if (patch.design.panels !== undefined) nextDesign.panels = patch.design.panels;
    if (patch.design.measurements !== undefined) nextDesign.measurements = patch.design.measurements;
    if (patch.design.distribution !== undefined) nextDesign.distribution = patch.design.distribution;

    // Collect every referenced selectionId across panels + stops for the
    // cross-tenant check.
    const selectionIds = new Set<string>();
    for (const panel of nextDesign.panels ?? []) {
      if (panel.selectionId) selectionIds.add(panel.selectionId);
      if (panel.door?.selectionId) selectionIds.add(panel.door.selectionId);
    }
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const stopId = nextDesign.stops?.[side];
      if (stopId) selectionIds.add(stopId);
    }

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

    // Derive widthMm from the panel array whenever panels are being
    // written — server-authoritative, never trusts a client-supplied
    // widthMm for a design write that touches panels (architect-review-
    // item7.md binding correction 4).
    if (patch.design.panels !== undefined) {
      data.widthMm = nextDesign.panels!.reduce((sum, p) => sum + p.widthMm, 0);
    }

    data.design = nextDesign as unknown as Prisma.InputJsonValue;
  }

  return prisma.partition.update({ where: { id }, data });
}
