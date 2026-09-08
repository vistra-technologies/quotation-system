import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import { createPartitionInTx } from "@/lib/data/partitions";

// ─── Types ──────────────────────────────────────────────────────────────────

// One element of Room.sides (see prisma/schema.prisma's Room model comment and
// design-docs/04-data-model.md — Room). Stored as JSONB; validated in app code
// only — there is no DB constraint on this shape.
export type PartitionSide = {
  id: string;
  kind: "PARTITION";
  partitionId: string;
  turnDegrees: number;
  lengthMm: null;
  label: null;
};

export type PlainSide = {
  id: string;
  kind: "PLAIN";
  partitionId: null;
  turnDegrees: number;
  lengthMm: number | null;
  label: string | null;
};

export type RoomSide = PartitionSide | PlainSide;

// Shape accepted from the client for a PATCH .../sides call. Note there is no
// `id` field here — ids are always server-minted/re-derived (never trusted
// from the client), per the Stage 18 plan's resolution of the id-generation
// open item. For a PARTITION element, `partitionId` (if it matches an
// existing side on this room) signals "keep this partition"; a PARTITION
// element with no matching existing partitionId is a new plain→partition
// convert and must carry heightMm/widthMm/label to create the Partition row.
export type IncomingSide =
  | {
      kind: "PARTITION";
      partitionId?: string | null;
      turnDegrees: number;
      // Only used when this is a NEW convert (no matching existing partitionId).
      label?: string;
      heightMm?: number;
      widthMm?: number;
    }
  | {
      kind: "PLAIN";
      turnDegrees: number;
      lengthMm?: number | null;
      label?: string | null;
    };

/** Thrown by replaceSides() on any of the 3 invariant violations, or malformed input. */
export class InvalidSidesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSidesError";
  }
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * List all Rooms on a floor, ordered by orderIndex.
 *
 * Tenancy guard: first verifies the floor belongs to the session's org before
 * returning any rows. Returns an empty array if the floor is not found in the
 * session's org (rather than leaking that the floor exists in another org).
 */
export async function listRoomsByFloor(session: SessionData, floorId: string) {
  const floor = await prisma.floor.findFirst({
    where: { id: floorId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!floor) return [];

  return prisma.room.findMany({
    where: { floorId, organizationId: session.organizationId },
    orderBy: { orderIndex: "asc" },
  });
}

/**
 * Get a single Room by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getRoomById(session: SessionData, roomId: string) {
  return prisma.room.findFirst({
    where: { id: roomId, organizationId: session.organizationId },
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/** The default 4-side PLAIN rectangle a new Room is created with (stage doc scope item 3). */
function defaultRectangleSides(): RoomSide[] {
  return Array.from({ length: 4 }, () => ({
    id: crypto.randomUUID(),
    kind: "PLAIN" as const,
    partitionId: null,
    turnDegrees: 90,
    lengthMm: null,
    label: null,
  }));
}

/**
 * Create a new Room under a floor, scoped to the session org.
 *
 * Writes the default 4-side PLAIN rectangle (all turnDegrees: 90, isClosed: true)
 * per stage doc scope item 3. orderIndex = MAX(orderIndex for the floor) + 1,
 * assigned inside a transaction (mirrors lib/data/floors.ts's createFloorIfNotExists).
 *
 * Tenancy guard: verifies floorId belongs to the session's org.
 * Throws { code: "FLOOR_NOT_FOUND" } if floorId doesn't resolve within the org.
 * Throws { code: "DUPLICATE_ROOM_LABEL" } on @@unique([floorId, label]) collision.
 */
export async function createRoom(
  session: SessionData,
  floorId: string,
  label: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const floor = await tx.floor.findFirst({
        where: { id: floorId, organizationId: session.organizationId },
        select: { id: true },
      });
      if (!floor) {
        throw Object.assign(new Error("Floor not found or access denied."), {
          code: "FLOOR_NOT_FOUND",
        });
      }

      const max = await tx.room.aggregate({
        where: { floorId, organizationId: session.organizationId },
        _max: { orderIndex: true },
      });
      const orderIndex = (max._max.orderIndex ?? -1) + 1;

      return tx.room.create({
        data: {
          organizationId: session.organizationId,
          floorId,
          label,
          orderIndex,
          isClosed: true,
          sides: defaultRectangleSides(),
        },
      });
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "FLOOR_NOT_FOUND"
    ) {
      throw err;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      throw Object.assign(
        new Error("Room label conflict — please try again."),
        { code: "DUPLICATE_ROOM_LABEL" },
      );
    }
    throw err;
  }
}

/**
 * Rename an existing Room. Tenancy guard: verifies the room belongs to the
 * session's org before updating. Returns null if not found (caller -> 404).
 */
export async function renameRoom(
  session: SessionData,
  roomId: string,
  label: string,
) {
  const existing = await prisma.room.findFirst({
    where: { id: roomId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) return null;

  return prisma.room.update({
    where: { id: roomId },
    data: { label },
  });
}

/**
 * Reorder all Rooms on a floor in one shot — all-or-nothing.
 *
 * `orderedRoomIds` must be exactly the set of room ids currently on the floor
 * (same length, no extras, no missing ids) — this is enforced so a partial or
 * stale client array can never silently drop a room from the ordering.
 *
 * Tenancy guard: verifies the floor belongs to the session's org, and that
 * every id in orderedRoomIds belongs to that floor + org, before writing.
 * Throws { code: "FLOOR_NOT_FOUND" } / { code: "INVALID_ROOM_SET" }.
 */
export async function reorderRooms(
  session: SessionData,
  floorId: string,
  orderedRoomIds: string[],
) {
  return prisma.$transaction(async (tx) => {
    const floor = await tx.floor.findFirst({
      where: { id: floorId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!floor) {
      throw Object.assign(new Error("Floor not found or access denied."), {
        code: "FLOOR_NOT_FOUND",
      });
    }

    const rooms = await tx.room.findMany({
      where: { floorId, organizationId: session.organizationId },
      select: { id: true },
    });
    const currentIds = new Set(rooms.map((r) => r.id));
    const incomingIds = new Set(orderedRoomIds);
    if (
      currentIds.size !== incomingIds.size ||
      [...currentIds].some((id) => !incomingIds.has(id))
    ) {
      throw Object.assign(
        new Error(
          "orderedRoomIds must contain exactly the rooms currently on this floor.",
        ),
        { code: "INVALID_ROOM_SET" },
      );
    }

    await Promise.all(
      orderedRoomIds.map((id, orderIndex) =>
        tx.room.update({ where: { id }, data: { orderIndex } }),
      ),
    );

    return tx.room.findMany({
      where: { floorId, organizationId: session.organizationId },
      orderBy: { orderIndex: "asc" },
    });
  });
}

/**
 * Delete a Room. Tenancy guard: verifies the room belongs to the session's
 * org before deleting. Partitions under it (Partition.roomId, onDelete:
 * Cascade) are removed automatically by the DB — no manual cleanup needed.
 * Returns null if not found (caller -> 404).
 */
export async function deleteRoom(session: SessionData, roomId: string) {
  const existing = await prisma.room.findFirst({
    where: { id: roomId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) return null;

  await prisma.room.delete({ where: { id: roomId } });
  return existing;
}

/**
 * Replace a Room's entire `sides` array — the single function that owns ALL
 * `sides` writes (per stage-18.md §2). Validates the 3 invariants and
 * performs the plain<->partition compound convert operations, all inside one
 * transaction so a PATCH is all-or-nothing.
 *
 * The 3 invariants (rejected with InvalidSidesError, mapped by the route to
 * a 400):
 *   1. No duplicate partitionId across the array.
 *   2. Every PARTITION element's referenced Partition.roomId agrees with this
 *      room after the write (enforced by construction below — a PARTITION
 *      element either keeps an existing Partition already owned by this room,
 *      or creates a brand new one with roomId = this room).
 *   3. lengthMm is set only on PLAIN elements (PARTITION elements never carry it).
 *
 * Below-3-sides validation is enforced only when the room's isClosed is (or
 * becomes) true — an open run can legitimately be 1+ sides (Stage 18 plan's
 * resolution of the stage doc's open item).
 *
 * Side ids are always re-derived server-side, never trusted from the client
 * (Stage 18 plan's resolution of the id-generation open item):
 *   - PARTITION elements are matched to the room's previous sides by
 *     `partitionId` — matched ones keep their existing side id; a PARTITION
 *     element with no `partitionId` at all is a new plain->partition convert
 *     (creates a fresh Partition row); a PARTITION element whose supplied
 *     `partitionId` does NOT match anything on this room is rejected with
 *     InvalidSidesError (not silently treated as a new convert — see
 *     stage-18 review-item2.md finding 2).
 *   - PLAIN elements are matched to the room's previous sides *positionally*
 *     purely for id continuity (a PLAIN element in the same position as a
 *     previous PLAIN element keeps its id; anything else, including a
 *     position previously occupied by a PARTITION, mints a fresh id).
 *     Position is NOT used to decide whether a Partition gets deleted —
 *     deletion is decided entirely by the order-independent sweep after the
 *     loop (comparing the set of partitionIds referenced before vs. after
 *     the write), specifically so that reordering a PARTITION side (moving
 *     its index without changing its kind) can never be mistaken for a
 *     convert-back and delete a live Partition out from under it (see
 *     stage-18 review-item2.md finding 1 — this was a real bug in an earlier
 *     version of this function).
 *
 * Tenancy guard: verifies the room belongs to the session's org.
 * Returns null if the room is not found (caller -> 404).
 * Throws InvalidSidesError on invariant violations.
 */
export async function replaceSides(
  session: SessionData,
  roomId: string,
  newSides: IncomingSide[],
  isClosed?: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.findFirst({
      where: { id: roomId, organizationId: session.organizationId },
    });
    if (!room) return null;

    const previousSides = (room.sides as unknown as RoomSide[]) ?? [];
    const willBeClosed = isClosed ?? room.isClosed;

    // ── Shape validation (invariants 1 & 3) ─────────────────────────────────
    if (!Array.isArray(newSides)) {
      throw new InvalidSidesError("sides must be an array.");
    }
    if (willBeClosed && newSides.length < 3) {
      throw new InvalidSidesError(
        "A closed room must have at least 3 sides.",
      );
    }

    const seenPartitionIds = new Set<string>();
    for (const side of newSides) {
      if (side.kind === "PARTITION") {
        if (side.partitionId) {
          if (seenPartitionIds.has(side.partitionId)) {
            throw new InvalidSidesError(
              `Duplicate partitionId in sides array: ${side.partitionId}`,
            );
          }
          seenPartitionIds.add(side.partitionId);
        }
      } else if (side.kind === "PLAIN") {
        // lengthMm is only ever meaningful on PLAIN sides — nothing to check
        // here since PARTITION's type has no lengthMm field at all; this
        // branch exists so the exhaustiveness of `kind` is explicit.
      } else {
        throw new InvalidSidesError(
          `Invalid side kind: ${(side as { kind: unknown }).kind}`,
        );
      }
    }

    // ── Build the final array, resolving converts + re-deriving ids ────────
    //
    // NOTE: convert-back (PARTITION -> PLAIN) is intentionally NOT detected
    // positionally here (a previous version compared newSides[i] against
    // previousSides[i] and deleted on a PARTITION->PLAIN transition at the
    // same index). That was wrong: a PATCH that reorders a PARTITION side
    // (or inserts/removes a side ahead of one) shifts its index without the
    // side itself changing kind, which the positional check couldn't tell
    // apart from an actual convert-back — it deleted live Partition rows out
    // from under sides that were simply moved. Convert-back deletion is
    // instead handled entirely by the order-independent sweep below, which
    // compares the *set* of partitionIds referenced before and after the
    // write — a PARTITION side that doesn't appear anywhere in the new array
    // (whether because it was converted back to PLAIN or removed outright)
    // gets its Partition row deleted exactly once, regardless of position.
    const finalSides: RoomSide[] = [];
    for (let i = 0; i < newSides.length; i++) {
      const incoming = newSides[i];
      const previousAtSamePos = previousSides[i];

      if (incoming.kind === "PARTITION") {
        const matchedExisting =
          incoming.partitionId != null
            ? previousSides.find(
                (s) => s.kind === "PARTITION" && s.partitionId === incoming.partitionId,
              )
            : undefined;

        if (incoming.partitionId != null && !matchedExisting) {
          // An explicit partitionId that doesn't resolve to a side already on
          // this room is an error, not an implicit "create a new one" — e.g.
          // a stale client cache or a partitionId belonging to another room.
          throw new InvalidSidesError(
            `partitionId ${incoming.partitionId} is not a side of this room.`,
          );
        }

        if (matchedExisting && matchedExisting.kind === "PARTITION") {
          // Keep — verify the referenced Partition still belongs to this room.
          const partition = await tx.partition.findFirst({
            where: {
              id: matchedExisting.partitionId,
              organizationId: session.organizationId,
              roomId,
            },
            select: { id: true },
          });
          if (!partition) {
            throw new InvalidSidesError(
              `partitionId ${matchedExisting.partitionId} does not belong to this room.`,
            );
          }
          finalSides.push({
            id: matchedExisting.id,
            kind: "PARTITION",
            partitionId: matchedExisting.partitionId,
            turnDegrees: incoming.turnDegrees,
            lengthMm: null,
            label: null,
          });
        } else {
          // New convert: PLAIN -> PARTITION (no partitionId supplied at all).
          // Create the Partition row now.
          if (!incoming.label || !incoming.heightMm || !incoming.widthMm) {
            throw new InvalidSidesError(
              "Converting a side to PARTITION requires label, heightMm, and widthMm.",
            );
          }
          const partition = await createPartitionInTx(tx, {
            roomId,
            label: incoming.label,
            heightMm: incoming.heightMm,
            widthMm: incoming.widthMm,
            organizationId: session.organizationId,
          });
          finalSides.push({
            id: crypto.randomUUID(),
            kind: "PARTITION",
            partitionId: partition.id,
            turnDegrees: incoming.turnDegrees,
            lengthMm: null,
            label: null,
          });
        }
      } else {
        // incoming.kind === "PLAIN" — reuse the previous side's id only when
        // a PLAIN side occupied this exact position before (no partition
        // deletion here; see the sweep below for why).
        finalSides.push({
          id: previousAtSamePos?.kind === "PLAIN" ? previousAtSamePos.id : crypto.randomUUID(),
          kind: "PLAIN",
          partitionId: null,
          turnDegrees: incoming.turnDegrees,
          lengthMm: incoming.lengthMm ?? null,
          label: incoming.label ?? null,
        });
      }
    }

    // Any previous PARTITION sides that no longer appear anywhere in the new
    // array — whether converted back to PLAIN or removed outright — must
    // have their Partition row deleted, order-independently. This is the
    // single place partition deletion happens for this function (see the
    // note above the loop): comparing the *sets* of partitionIds before and
    // after the write means a reorder that merely moves a PARTITION side
    // (present in both sets) never triggers a delete.
    const finalPartitionIds = new Set(
      finalSides
        .filter((s): s is PartitionSide => s.kind === "PARTITION")
        .map((s) => s.partitionId),
    );
    const removedPartitionIds = previousSides
      .filter((s): s is PartitionSide => s.kind === "PARTITION")
      .map((s) => s.partitionId)
      .filter((id) => !finalPartitionIds.has(id));
    if (removedPartitionIds.length > 0) {
      await tx.partition.deleteMany({
        where: {
          id: { in: removedPartitionIds },
          organizationId: session.organizationId,
          roomId,
        },
      });
    }

    return tx.room.update({
      where: { id: roomId },
      data: {
        sides: finalSides,
        ...(isClosed !== undefined ? { isClosed } : {}),
      },
    });
  });
}
