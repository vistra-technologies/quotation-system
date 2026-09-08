/**
 * Stage 18 — Rooms (`Floor -> Room -> Partition`) behavior-level E2E coverage.
 *
 * API-level only (page.request.get/post/patch/delete against apiUrl()) — no DOM/
 * layout assertions, per the workspace's UI-is-wireframe-stage rule and
 * profile.md's "Testing posture". Covers exactly the invariants listed in
 * stage-18.md section 6 / profile.md's "Testing posture":
 *   1. Tenancy isolation on Room/sides.
 *   2. No duplicate partitionId across a room's sides (the single most
 *      important invariant — a JSONB array has no DB unique constraint).
 *   3. Partition.roomId agreement with the array, incl. the IMPORTANT-bug
 *      regression (an unrecognized partitionId must 400, not silently mint a
 *      duplicate Partition — see review-item2.md finding 2).
 *   4. Side ordering round-trips exactly, and a reorder that moves a
 *      PARTITION side's array index must succeed without corrupting/deleting
 *      the underlying Partition row (see review-item2.md CRITICAL 1 / the
 *      round-2 fix) — this is the highest-value regression in this file.
 *   5. Convert correctness both directions (PLAIN->PARTITION creates exactly
 *      one Partition; convert-back deletes it, no orphan, no dangling id).
 *   6. Cascade correctness: deleting a room removes its partitions. (Deleting
 *      a floor and expecting its rooms to cascade is NOT covered here — see
 *      the note above that test below; there is no floor-delete API route in
 *      this stage's scope to drive it through.)
 *   7. Adjacency read — sides read in order are trustworthy (folded into the
 *      ordering/reorder test, since there's no separate "adjacency" endpoint).
 *   8. Below-3-sides validation applies only when isClosed: true.
 *   9. lengthMm on a PARTITION element is rejected 400 (Gate A / MINOR 3).
 *
 * Design: one shared authenticated browser context per org (sign in once in
 * beforeAll, matching subdomain-navigation.spec.ts's pattern), serial mode to
 * respect better-auth's per-IP rate limiter and because later tests build on
 * fixtures (project/floor/rooms) created by earlier ones in the same file.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { signIn, apiUrl } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";

let acmeCtx: BrowserContext;
let nordicCtx: BrowserContext;
let acmePage: Page;
let nordicPage: Page;

// Fixtures shared across tests in this file (created once, reused/mutated).
let projectId: string;
let floorId: string;
let roomAId: string; // "Room A" — used for reorder/convert/invariant tests
let roomBId: string; // "Room B" — used for cross-room partitionId tests

const RUN = Date.now();

test.beforeAll(async ({ browser }) => {
  acmeCtx = await browser.newContext();
  nordicCtx = await browser.newContext();
  acmePage = await acmeCtx.newPage();
  nordicPage = await nordicCtx.newPage();

  await signIn(acmePage, "admin", "Seed1234!", ACME);
  await signIn(nordicPage, "admin", "Seed1234!", NORDIC);

  // Project -> Floor -> two Rooms, all via the real APIs (not direct DB access).
  const projRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`),
    { data: { name: `Stage18 E2E ${RUN}`, currency: "AED" } },
  );
  expect(projRes.status()).toBe(201);
  ({ project: { id: projectId } } = (await projRes.json()) as {
    project: { id: string };
  });

  const floorRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors`),
    { data: { projectId, label: `Ground ${RUN}` } },
  );
  expect(floorRes.status()).toBe(201);
  ({ floor: { id: floorId } } = (await floorRes.json()) as {
    floor: { id: string };
  });

  const roomARes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms`),
    { data: { floorId, label: `Room A ${RUN}` } },
  );
  expect(roomARes.status()).toBe(201);
  ({ room: { id: roomAId } } = (await roomARes.json()) as {
    room: { id: string };
  });

  const roomBRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms`),
    { data: { floorId, label: `Room B ${RUN}` } },
  );
  expect(roomBRes.status()).toBe(201);
  ({ room: { id: roomBId } } = (await roomBRes.json()) as {
    room: { id: string };
  });
});

test.afterAll(async () => {
  await acmeCtx.close();
  await nordicCtx.close();
});

// ---------------------------------------------------------------------------
// 1. Tenancy isolation
// ---------------------------------------------------------------------------

test("tenancy: nordic-walls cannot read or mutate acme-glass's Room/sides", async () => {
  // (a) GET list, own org's URL, but a floorId belonging to acme-glass ->
  //     the DAL treats "floor not found in my org" as an empty result, not a
  //     leak of acme-glass's rooms.
  const listRes = await nordicPage.request.get(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/rooms?floorId=${floorId}`),
  );
  expect(listRes.status()).toBe(200);
  const { rooms } = (await listRes.json()) as { rooms: unknown[] };
  expect(rooms).toEqual([]);

  // (b) PATCH rename, own org's URL, acme-glass's room id -> 404 (not found
  //     in nordic-walls's org), not a silent success against acme's data.
  const renameRes = await nordicPage.request.patch(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/rooms/${roomAId}`),
    { data: { label: "Hijacked" } },
  );
  expect(renameRes.status()).toBe(404);

  // (c) PATCH sides, own org's URL, acme-glass's room id -> 404.
  const sidesRes = await nordicPage.request.patch(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/rooms/${roomAId}/sides`),
    { data: { sides: [] } },
  );
  expect(sidesRes.status()).toBe(404);

  // (d) DELETE, own org's URL, acme-glass's room id -> 404.
  const deleteRes = await nordicPage.request.delete(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/rooms/${roomAId}`),
  );
  expect(deleteRes.status()).toBe(404);

  // (e) Cross-tenant replay: nordic-walls's own session cookie against
  //     acme-glass's orgSlug in the URL -> 403 (getApiSession's cross-tenant
  //     guard), before any DAL/tenancy-guard-in-DAL logic even runs.
  const crossOrgRes = await nordicPage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  expect(crossOrgRes.status()).toBe(403);

  // Sanity: acme-glass's own session can still read the room fine (proves
  // the 404s above are a tenancy guard, not the room having vanished).
  const ownRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  expect(ownRes.status()).toBe(200);
  const { rooms: ownRooms } = (await ownRes.json()) as {
    rooms: { id: string; label: string }[];
  };
  expect(ownRooms.some((r) => r.id === roomAId)).toBe(true);
});

// ---------------------------------------------------------------------------
// 4 & 7. Ordering round-trip, reorder moving a PARTITION side's index
//        (the highest-value regression test in this file), adjacency read.
// 5. Convert correctness (forward direction; backward direction later).
// 9. lengthMm on a PARTITION element -> 400.
// ---------------------------------------------------------------------------

test("ordering round-trip, PARTITION-index reorder survives, and convert (PLAIN->PARTITION) creates exactly one Partition", async () => {
  // Label Room A's default 4 PLAIN sides so we can identify them by label
  // through reorders (PLAIN side ids are positional/not stable across a
  // reorder — see review-item2-round2.md MINOR 9 — so identity must be
  // asserted on label/kind/partitionId, never on a PLAIN side's id).
  const labelRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S1", lengthMm: 2000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(labelRes.status()).toBe(200);
  const labeled = (await labelRes.json()) as {
    room: { sides: { kind: string; label: string | null }[] };
  };
  expect(labeled.room.sides.map((s) => s.label)).toEqual(["S0", "S1", "S2", "S3"]);

  // Convert S1 (index 1) to PARTITION — a new convert (no partitionId), must
  // carry label/heightMm/widthMm to create the Partition row.
  const partitionsBefore = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  expect((await partitionsBefore.json()).partitions).toEqual([]);

  const convertRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          {
            kind: "PARTITION",
            turnDegrees: 90,
            label: "Wall-1",
            heightMm: 2400,
            widthMm: 1200,
          },
          { kind: "PLAIN", turnDegrees: 90, label: "S2", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(convertRes.status()).toBe(200);
  const converted = (await convertRes.json()) as {
    room: {
      sides: { kind: string; label: string | null; partitionId: string | null }[];
    };
  };
  expect(converted.room.sides.map((s) => s.kind)).toEqual([
    "PLAIN",
    "PARTITION",
    "PLAIN",
    "PLAIN",
  ]);
  const partitionIdP1 = converted.room.sides[1].partitionId;
  expect(partitionIdP1).toBeTruthy();

  // Convert correctness (forward): exactly one Partition row, right roomId.
  const partitionsAfterConvert = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  const { partitions: afterConvert } = (await partitionsAfterConvert.json()) as {
    partitions: { id: string; roomId: string; label: string }[];
  };
  expect(afterConvert).toHaveLength(1);
  expect(afterConvert[0].id).toBe(partitionIdP1);
  expect(afterConvert[0].roomId).toBe(roomAId);
  expect(afterConvert[0].label).toBe("Wall-1");

  // Read-after-write: a separate GET returns the same order as the PATCH response.
  const readBack = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  const { rooms: readRooms } = (await readBack.json()) as {
    rooms: {
      id: string;
      sides: { kind: string; label: string | null; partitionId: string | null }[];
    }[];
  };
  const roomAReadBack = readRooms.find((r) => r.id === roomAId)!;
  expect(roomAReadBack.sides.map((s) => s.kind)).toEqual(converted.room.sides.map((s) => s.kind));
  expect(roomAReadBack.sides.map((s) => s.label)).toEqual(converted.room.sides.map((s) => s.label));

  // 9. lengthMm on a PARTITION element -> 400 (Gate A / MINOR 3 resolution:
  // null is accepted since that's what round-trip reads carry, but a client
  // actually setting a numeric lengthMm on a PARTITION side is rejected).
  const badLengthRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PARTITION", turnDegrees: 90, partitionId: partitionIdP1, lengthMm: 1200 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(badLengthRes.status()).toBe(400);
  // The rejected PATCH must not have partially applied — Partition still exists, untouched.
  const partitionsAfterBadPatch = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  expect((await partitionsAfterBadPatch.json()).partitions).toHaveLength(1);

  // --- THE critical regression test: reorder that moves the PARTITION
  // side's array index (not just a PLAIN-only reorder, which would pass
  // against both the buggy and the fixed code — see review-item2.md
  // CRITICAL 1 / review-item2-round2.md). Move partitionIdP1 from index 1 to
  // index 0, while other sides also change (S2 relabeled), all in one PATCH.
  const reorderRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 80, partitionId: partitionIdP1 },
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2-renamed", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(reorderRes.status()).toBe(200);
  const reordered = (await reorderRes.json()) as {
    room: {
      isClosed: boolean;
      sides: { kind: string; label: string | null; partitionId: string | null }[];
    };
  };
  // (a) reorder succeeded and moved the PARTITION side to index 0.
  expect(reordered.room.sides[0]).toMatchObject({ kind: "PARTITION", partitionId: partitionIdP1 });
  expect(reordered.room.sides[1]).toMatchObject({ kind: "PLAIN", label: "S0" });
  expect(reordered.room.sides[2]).toMatchObject({ kind: "PLAIN", label: "S2-renamed" });
  expect(reordered.room.sides[3]).toMatchObject({ kind: "PLAIN", label: "S3" });

  // Adjacency read (item 7): with the array order now trustworthy (asserted
  // above), reading it front-to-back is a walk of the perimeter — side i is
  // adjacent to side i+1, wrapping last->first since isClosed. No dedicated
  // adjacency endpoint exists; the invariant this test protects is "the
  // array order returned is exactly the order intended", which the index
  // assertions above already establish for all 4 positions including the
  // wrap pair (index 3 <-> index 0).
  expect(reordered.room.isClosed).toBe(true);

  // (b) the underlying Partition row still exists — this is exactly what the
  // CRITICAL bug destroyed (a positional convert-back-delete fired on the
  // PARTITION side's old index because a PLAIN side now occupied it).
  const partitionsAfterReorder = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  const { partitions: afterReorder } = (await partitionsAfterReorder.json()) as {
    partitions: { id: string }[];
  };
  expect(afterReorder.map((p) => p.id)).toContain(partitionIdP1);

  // (c) the room is not "bricked" — a subsequent PATCH still works (the
  // buggy code left the room permanently un-patchable once the dangling
  // partitionId's re-check failed on every following request).
  const followUpRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 80, partitionId: partitionIdP1 },
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2-renamed", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(followUpRes.status()).toBe(200);
});

// ---------------------------------------------------------------------------
// 3. Partition.roomId agreement + the IMPORTANT-bug regression (unrecognized
//    partitionId must 400, not silently mint a duplicate Partition).
// ---------------------------------------------------------------------------

test("Partition.roomId agreement: unrecognized or foreign-room partitionId is rejected, not silently converted", async () => {
  // (a) A PARTITION element carrying a partitionId that doesn't resolve to
  // anything at all (not this room's, not any room's) -> 400, and no new
  // Partition row is created under this room as a side effect.
  const before = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  const { partitions: beforeList } = (await before.json()) as { partitions: unknown[] };
  const countBefore = beforeList.length;

  const bogusRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 80, partitionId: "00000000-0000-0000-0000-000000000000" },
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2-renamed", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(bogusRes.status()).toBe(400);

  const after = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  const { partitions: afterList } = (await after.json()) as { partitions: unknown[] };
  expect(afterList).toHaveLength(countBefore); // no duplicate Partition minted, no partitionNumber burned

  // (b) Convert a side of Room B to PARTITION, producing a Partition that
  // belongs to Room B — then try to attach that partitionId to Room A's
  // sides. Must 400 ("not a side of this room"), and Room B's Partition must
  // be completely unaffected.
  const roomBConvertRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomBId}/sides`),
    {
      data: {
        sides: [
          {
            kind: "PARTITION",
            turnDegrees: 90,
            label: "Wall-B1",
            heightMm: 2100,
            widthMm: 900,
          },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    },
  );
  expect(roomBConvertRes.status()).toBe(200);
  const roomBConverted = (await roomBConvertRes.json()) as {
    room: { sides: { kind: string; partitionId: string | null }[] };
  };
  const partitionIdP2 = roomBConverted.room.sides[0].partitionId;
  expect(partitionIdP2).toBeTruthy();

  const crossRoomRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 80, partitionId: partitionIdP2 },
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2-renamed", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(crossRoomRes.status()).toBe(400);

  // Room B's own partition is untouched: still exists, still owned by Room B.
  const roomBPartitions = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomBId}`),
  );
  const { partitions: roomBList } = (await roomBPartitions.json()) as {
    partitions: { id: string; roomId: string }[];
  };
  expect(roomBList).toHaveLength(1);
  expect(roomBList[0].id).toBe(partitionIdP2);
  expect(roomBList[0].roomId).toBe(roomBId);
});

// ---------------------------------------------------------------------------
// 2. No duplicate partitionId across a room's sides — the single most
//    important test the stage doc calls out (what a DB unique constraint
//    would have caught if `sides` were rows instead of JSONB).
// ---------------------------------------------------------------------------

test("no duplicate partitionId is allowed across a room's sides array", async () => {
  // Room B currently has 1 PARTITION (from the previous test) + 3 PLAIN.
  // Convert a second side to PARTITION, then attempt to place the SAME
  // partitionId on two elements in one PATCH.
  const currentRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  const { rooms } = (await currentRes.json()) as {
    rooms: { id: string; sides: { kind: string; partitionId: string | null }[] }[];
  };
  const roomB = rooms.find((r) => r.id === roomBId)!;
  const existingPartitionId = roomB.sides.find((s) => s.kind === "PARTITION")!.partitionId!;

  const convertSecondRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomBId}/sides`),
    {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 90, partitionId: existingPartitionId },
          {
            kind: "PARTITION",
            turnDegrees: 90,
            label: "Wall-B2",
            heightMm: 2200,
            widthMm: 1000,
          },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    },
  );
  expect(convertSecondRes.status()).toBe(200);
  const secondConverted = (await convertSecondRes.json()) as {
    room: { sides: { kind: string; partitionId: string | null }[] };
  };
  const secondPartitionId = secondConverted.room.sides[1].partitionId!;
  expect(secondPartitionId).not.toBe(existingPartitionId);

  // Now the actual duplicate attempt: both slots reference existingPartitionId.
  const dupRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomBId}/sides`),
    {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 90, partitionId: existingPartitionId },
          { kind: "PARTITION", turnDegrees: 90, partitionId: existingPartitionId },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    },
  );
  expect(dupRes.status()).toBe(400);

  // Rejected outright — both partitions from before the attempt still exist,
  // unmodified (the PATCH must not have partially applied).
  const partitionsAfterDup = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomBId}`),
  );
  const { partitions: afterDup } = (await partitionsAfterDup.json()) as {
    partitions: { id: string }[];
  };
  expect(afterDup.map((p) => p.id).sort()).toEqual(
    [existingPartitionId, secondPartitionId].sort(),
  );
});

// ---------------------------------------------------------------------------
// 5. Convert correctness (backward direction): converting a PARTITION side
//    back to PLAIN deletes the Partition row, no orphan, no dangling id.
// ---------------------------------------------------------------------------

test("convert-back (PARTITION -> PLAIN) deletes the Partition row, leaving no orphan or dangling partitionId", async () => {
  const beforeRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  const { partitions: beforeList } = (await beforeRes.json()) as {
    partitions: { id: string }[];
  };
  expect(beforeList).toHaveLength(1);
  const partitionIdP1 = beforeList[0].id;

  // Room A is currently [PARTITION(p1), PLAIN S0, PLAIN S2-renamed, PLAIN S3]
  // (per the reorder test above). Convert index 0 back to PLAIN.
  const convertBackRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PLAIN", turnDegrees: 90, label: "Wall-1-removed", lengthMm: 1200 },
          { kind: "PLAIN", turnDegrees: 90, label: "S0", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S2-renamed", lengthMm: 3000 },
          { kind: "PLAIN", turnDegrees: 90, label: "S3", lengthMm: 4000 },
        ],
      },
    },
  );
  expect(convertBackRes.status()).toBe(200);
  const convertedBack = (await convertBackRes.json()) as {
    room: { sides: { kind: string; partitionId: string | null }[] };
  };
  expect(convertedBack.room.sides[0]).toMatchObject({ kind: "PLAIN", partitionId: null });
  // No dangling partitionId anywhere in the array.
  expect(convertedBack.room.sides.every((s) => s.partitionId === null)).toBe(true);

  // No orphaned Partition row.
  const afterRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomAId}`),
  );
  const { partitions: afterList } = (await afterRes.json()) as {
    partitions: { id: string }[];
  };
  expect(afterList).toEqual([]);
  expect(afterList.map((p) => p.id)).not.toContain(partitionIdP1);
});

// ---------------------------------------------------------------------------
// 8. Below-3-sides validation applies only when isClosed: true.
// ---------------------------------------------------------------------------

test("below-3-sides is rejected only when isClosed: true; an open room has no minimum", async () => {
  // Room A is currently 4 PLAIN sides, isClosed: true (default from creation,
  // untouched by any isClosed-changing PATCH so far).
  const shrinkClosedRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        sides: [
          { kind: "PLAIN", turnDegrees: 90, label: "A", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "B", lengthMm: 1000 },
        ],
      },
    },
  );
  expect(shrinkClosedRes.status()).toBe(400);

  // Same 2-element array, but explicitly opening the room -> succeeds.
  const shrinkOpenRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomAId}/sides`),
    {
      data: {
        isClosed: false,
        sides: [
          { kind: "PLAIN", turnDegrees: 90, label: "A", lengthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90, label: "B", lengthMm: 1000 },
        ],
      },
    },
  );
  expect(shrinkOpenRes.status()).toBe(200);
  const opened = (await shrinkOpenRes.json()) as {
    room: { isClosed: boolean; sides: unknown[] };
  };
  expect(opened.room.isClosed).toBe(false);
  expect(opened.room.sides).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// 6. Cascade correctness: deleting a room removes its partitions.
//
// NOTE: "deleting a floor removes its rooms" (the other half of stage-18.md
// section 6's cascade bullet) is NOT covered here — there is no
// DELETE /api/v1/orgs/[orgSlug]/floors[/[id]] route in this stage's scope
// (confirmed by listing app/api/v1/orgs/[orgSlug]/floors/ — GET + POST only).
// Floor itself is explicitly untouched by Stage 18 (profile.md), so there is
// no API-level way to drive this half of the invariant without reaching for
// direct DB access, which would violate the API-level-only testing approach
// used throughout this file. Flagged in the worklog as a gap, not silently
// dropped.
// ---------------------------------------------------------------------------

test("cascade: deleting a room removes its partitions", async () => {
  // Room B has 2 Partitions at this point (Wall-B1, Wall-B2).
  const beforeRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomBId}`),
  );
  const { partitions: beforeList } = (await beforeRes.json()) as {
    partitions: { id: string }[];
  };
  expect(beforeList.length).toBeGreaterThan(0);

  const deleteRes = await acmePage.request.delete(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomBId}`),
  );
  expect(deleteRes.status()).toBe(200);

  const afterRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions?roomId=${roomBId}`),
  );
  const { partitions: afterList } = (await afterRes.json()) as {
    partitions: unknown[];
  };
  expect(afterList).toEqual([]);

  // The room itself is gone from the floor's room list.
  const roomsRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  const { rooms: roomsAfter } = (await roomsRes.json()) as {
    rooms: { id: string }[];
  };
  expect(roomsAfter.some((r) => r.id === roomBId)).toBe(false);
});
