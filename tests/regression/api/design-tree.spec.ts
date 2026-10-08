/**
 * Design tree: floors (GET/POST, PATCH/DELETE by id), rooms (GET/POST, collection PATCH = reorder,
 * PATCH/DELETE by id, PATCH sides), partitions (GET list, GET/PATCH by id).
 *
 * Gates (route source): every verb is "any authenticated org member" — no permission. Tenancy: each DAL
 * call scopes by the session's organizationId (+ the owning project's company for external users); list routes return [] for an unknown / foreign parent
 * id (no existence leak), by-id routes 404, create routes 400 ("… not found or access denied").
 * Floors/rooms/partitions are NOT DRAFT-gated (DECISION NEEDED pin) but ARE company-scoped for external
 * users through the owning project (Hotfix 2026-10-05: a foreign project's tree answers like a missing one). Calculation invalidation (Stage 23 D-17…D-20, Stage 25 B2 route audit): partition
 * design/heightMm PATCH, a sides PATCH that adds or removes a partition, floor DELETE and room DELETE
 * clear `designSubmittedAt` and delete the ProjectCalculation; label-only edits, renames, creates and a
 * sides PATCH that keeps the same partitions do not.
 *
 * Test-Org rows hang off projects created by `f.project` / `f.wall` (ledgered kind `project`; children
 * cascade). Org-B rows (foreign-id probes) go with org B at teardown.
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import type { Guarded } from "../fixtures/clients";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { orgApi, tag, foreignProjectId, distributorCompanyId, createLedgered } from "./project-helpers";
import {
  ok,
  rejected,
  design,
  sharedWall,
  foreignTree,
  PLAIN3,
  plain4,
  type Floor,
  type Room,
  type Partition,
} from "./design-helpers";
import {
  rgrInsertCalculation,
  readPartitionRow,
  readProjectState,
  rgrSeedV1Design,
  rgrSetDesignSubmittedAt,
  rgrSetProjectStatus,
} from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/floors");
covers("POST /api/v1/orgs/[orgSlug]/floors");
covers("PATCH /api/v1/orgs/[orgSlug]/floors/[id]");
covers("DELETE /api/v1/orgs/[orgSlug]/floors/[id]");
covers("GET /api/v1/orgs/[orgSlug]/rooms");
covers("POST /api/v1/orgs/[orgSlug]/rooms");
covers("PATCH /api/v1/orgs/[orgSlug]/rooms");
covers("PATCH /api/v1/orgs/[orgSlug]/rooms/[id]");
covers("DELETE /api/v1/orgs/[orgSlug]/rooms/[id]");
covers("PATCH /api/v1/orgs/[orgSlug]/rooms/[id]/sides");
covers("GET /api/v1/orgs/[orgSlug]/partitions");
covers("GET /api/v1/orgs/[orgSlug]/partitions/[id]");
covers("PATCH /api/v1/orgs/[orgSlug]/partitions/[id]");

const nm = (c: Pick<Ctx, "run">, what: string) => `${c.run.prefix}${what}-${tag()}`;
const wall = async (c: Ctx) => sharedWall(c.f);
const newSide = (label: string, heightMm = 2400, widthMm = 2000) => ({ kind: "PARTITION", turnDegrees: 90, label, heightMm, widthMm });

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/floors", method: "GET", path: () => `/floors?projectId=${GHOST}` },
  {
    key: "POST /api/v1/orgs/[orgSlug]/floors",
    method: "POST",
    path: () => "/floors",
    body: (c) => ({ projectId: GHOST, label: nm(c, "negF") }),
    invalid: [
      { name: "{} (projectId and label are required)", body: {}, status: 400 },
      { name: "missing label", body: async (c: Ctx) => ({ projectId: (await wall(c)).projectId }), status: 400 },
      { name: "blank label", body: async (c: Ctx) => ({ projectId: (await wall(c)).projectId, label: "   " }), status: 400 },
      { name: "non-string projectId", body: (c: Ctx) => ({ projectId: 1, label: nm(c, "negF") }), status: 400 },
      { name: "unknown projectId", body: (c: Ctx) => ({ projectId: GHOST, label: nm(c, "negF") }), status: 400 },
      { name: "org-B projectId", body: async (c: Ctx) => ({ projectId: await foreignProjectId(c), label: nm(c, "negF") }), status: 400 },
    ],
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/floors/[id]",
    method: "PATCH",
    path: () => `/floors/${GHOST}`,
    body: (c) => ({ label: nm(c, "negF") }),
    unknownId: () => `/floors/${GHOST}`,
    foreignId: async (c) => `/floors/${(await foreignTree(c)).floorId}`,
    invalid: [
      { name: "{} (label is required)", body: {}, status: 400 },
      { name: "blank label", body: { label: "  " }, status: 400 },
      { name: "non-string label", body: { label: 5 }, status: 400 },
    ],
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/floors/[id]",
    method: "DELETE",
    path: () => `/floors/${GHOST}`,
    unknownId: () => `/floors/${GHOST}`,
    foreignId: async (c) => `/floors/${(await foreignTree(c)).floorId}`,
  },
  { key: "GET /api/v1/orgs/[orgSlug]/rooms", method: "GET", path: () => `/rooms?floorId=${GHOST}` },
  {
    key: "POST /api/v1/orgs/[orgSlug]/rooms",
    method: "POST",
    path: () => "/rooms",
    body: (c) => ({ floorId: GHOST, label: nm(c, "negR") }),
    invalid: [
      { name: "{} (floorId and label are required)", body: {}, status: 400 },
      { name: "missing label", body: async (c: Ctx) => ({ floorId: (await wall(c)).floorId }), status: 400 },
      { name: "blank label", body: async (c: Ctx) => ({ floorId: (await wall(c)).floorId, label: " " }), status: 400 },
      { name: "unknown floorId", body: (c: Ctx) => ({ floorId: GHOST, label: nm(c, "negR") }), status: 400 },
      { name: "org-B floorId", body: async (c: Ctx) => ({ floorId: (await foreignTree(c)).floorId, label: nm(c, "negR") }), status: 400 },
    ],
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/rooms",
    method: "PATCH",
    path: () => "/rooms",
    body: () => ({ floorId: GHOST, orderedRoomIds: [] }),
    invalid: [
      { name: "{} (floorId and orderedRoomIds are required)", body: {}, status: 400 },
      { name: "orderedRoomIds not an array", body: async (c: Ctx) => ({ floorId: (await wall(c)).floorId, orderedRoomIds: "x" }), status: 400 },
      { name: "missing floorId", body: async (c: Ctx) => ({ orderedRoomIds: [(await wall(c)).roomId] }), status: 400 },
      { name: "unknown floorId", body: { floorId: GHOST, orderedRoomIds: [] }, status: 400 },
      { name: "org-B floor with its own room", body: async (c: Ctx) => { const t = await foreignTree(c); return { floorId: t.floorId, orderedRoomIds: [t.roomId] }; }, status: 400 },
      { name: "a set that is not the floor's rooms (empty)", body: async (c: Ctx) => ({ floorId: (await wall(c)).floorId, orderedRoomIds: [] }), status: 400 },
      { name: "a set with an extra unknown id", body: async (c: Ctx) => { const w = await wall(c); return { floorId: w.floorId, orderedRoomIds: [w.roomId, GHOST] }; }, status: 400 },
    ],
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/rooms/[id]",
    method: "PATCH",
    path: () => `/rooms/${GHOST}`,
    body: (c) => ({ label: nm(c, "negR") }),
    unknownId: () => `/rooms/${GHOST}`,
    foreignId: async (c) => `/rooms/${(await foreignTree(c)).roomId}`,
    invalid: [
      { name: "{} (label is required)", body: {}, status: 400 },
      { name: "blank label", body: { label: "   " }, status: 400 },
    ],
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/rooms/[id]",
    method: "DELETE",
    path: () => `/rooms/${GHOST}`,
    unknownId: () => `/rooms/${GHOST}`,
    foreignId: async (c) => `/rooms/${(await foreignTree(c)).roomId}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/rooms/[id]/sides",
    method: "PATCH",
    // a REAL Test-Org room: invariant checks run only after the room lookup
    path: async (c) => `/rooms/${(await wall(c)).roomId}/sides`,
    body: () => ({ sides: plain4() }),
    unknownId: () => `/rooms/${GHOST}/sides`,
    foreignId: async (c) => `/rooms/${(await foreignTree(c)).roomId}/sides`,
    invalid: [
      { name: "{} (sides array is required)", body: {}, status: 400 },
      { name: "sides not an array", body: { sides: "x" }, status: 400 },
      { name: "sides: [] on a closed room", body: { sides: [] }, status: 400 },
      { name: "2 sides with isClosed: true", body: { sides: [PLAIN3[0], PLAIN3[1]], isClosed: true }, status: 400 },
      { name: "a non-object side", body: { sides: [1, 2, 3] }, status: 400 },
      { name: 'kind "WALL"', body: { sides: [{ kind: "WALL", turnDegrees: 90 }, ...PLAIN3] }, status: 400 },
      { name: "lengthMm on a PARTITION side", body: (c: Ctx) => ({ sides: [{ ...newSide(nm(c, "negW")), lengthMm: 100 }, ...PLAIN3] }), status: 400 },
      { name: "new PARTITION without heightMm", body: (c: Ctx) => ({ sides: [{ kind: "PARTITION", turnDegrees: 90, label: nm(c, "negW"), widthMm: 2000 }, ...PLAIN3] }), status: 400 },
      { name: "new PARTITION without label", body: { sides: [{ kind: "PARTITION", turnDegrees: 90, heightMm: 2400, widthMm: 2000 }, ...PLAIN3] }, status: 400 },
      { name: "partitionId that is not a side of this room (unknown)", body: { sides: [{ kind: "PARTITION", turnDegrees: 90, partitionId: GHOST }, ...PLAIN3] }, status: 400 },
      { name: "partitionId of an org-B partition", body: async (c: Ctx) => ({ sides: [{ kind: "PARTITION", turnDegrees: 90, partitionId: (await foreignTree(c)).partitionId }, ...PLAIN3] }), status: 400 },
      {
        name: "duplicate partitionId",
        body: async (c: Ctx) => {
          const p = (await wall(c)).partitionId;
          return { sides: [{ kind: "PARTITION", turnDegrees: 90, partitionId: p }, { kind: "PARTITION", turnDegrees: 90, partitionId: p }, ...PLAIN3] };
        },
        status: 400,
      },
    ],
  },
  { key: "GET /api/v1/orgs/[orgSlug]/partitions", method: "GET", path: () => `/partitions?roomId=${GHOST}` },
  {
    key: "GET /api/v1/orgs/[orgSlug]/partitions/[id]",
    method: "GET",
    path: () => `/partitions/${GHOST}`,
    unknownId: () => `/partitions/${GHOST}`,
    foreignId: async (c) => `/partitions/${(await foreignTree(c)).partitionId}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/partitions/[id]",
    method: "PATCH",
    // structural validation runs before the lookup, so the matrix needs no real partition
    path: () => `/partitions/${GHOST}`,
    body: (c) => ({ label: nm(c, "negP") }),
    unknownId: () => `/partitions/${GHOST}`,
    foreignId: async (c) => `/partitions/${(await foreignTree(c)).partitionId}`,
    invalid: [
      { name: "v1 { panels } design (Stage 22 D-8)", body: { design: { panels: [{ id: "p1", type: "glass", widthMm: 2000, heightMm: 2400, selectionId: null }] } }, status: 400 },
      { name: "blank label", body: { label: "  " }, status: 400 },
      { name: "heightMm 0", body: { heightMm: 0 }, status: 400 },
      { name: "heightMm non-integer", body: { heightMm: 2400.5 }, status: 400 },
      { name: "heightMm above 100000", body: { heightMm: 100001 }, status: 400 },
      { name: "design not an object", body: { design: [] }, status: 400 },
      { name: "schemaVersion 1", body: { design: { schemaVersion: 1, sections: [] } }, status: 400 },
      { name: "sections without schemaVersion", body: { design: { sections: design([{ w: 2000, cells: [[2400, null]] }]).sections } }, status: 400 },
      { name: "schemaVersion 2 without sections", body: { design: { schemaVersion: 2 } }, status: 400 },
      { name: "sections not an array", body: { design: { schemaVersion: 2, sections: {} } }, status: 400 },
      { name: "a section with no cells", body: { design: { schemaVersion: 2, sections: [{ id: "s0", widthMm: 2000, cells: [] }] } }, status: 400 },
      { name: "a section without id", body: { design: { schemaVersion: 2, sections: [{ widthMm: 2000, cells: [{ id: "c", heightMm: 2400, selectionId: null }] }] } }, status: 400 },
      { name: "section widthMm 0", body: { design: design([{ w: 0, cells: [[2400, null]] }]) }, status: 400 },
      { name: "cell heightMm negative", body: { design: design([{ w: 2000, cells: [[-1, null]] }]) }, status: 400 },
      { name: "duplicate section/cell ids", body: { design: { schemaVersion: 2, sections: [{ id: "x", widthMm: 2000, cells: [{ id: "x", heightMm: 2400, selectionId: null }] }] } }, status: 400 },
      { name: "widths summing above 100000", body: { design: design([{ w: 60000, cells: [[2400, null]] }, { w: 60000, cells: [[2400, null]] }]) }, status: 400 },
      { name: "cell selectionId not a string", body: { design: design([{ w: 2000, cells: [[2400, 7 as unknown as string]] }]) }, status: 400 },
      { name: 'cell hinging "up"', body: { design: { schemaVersion: 2, sections: [{ id: "s", widthMm: 2000, cells: [{ id: "c", heightMm: 2400, selectionId: null, hinging: "up" }] }] } }, status: 400 },
      { name: "stops not an object", body: { design: { stops: "top" } }, status: 400 },
      { name: "stops.top a number", body: { design: { stops: { top: 1 } } }, status: 400 },
      { name: "defaults.glassSelectionId a number", body: { design: { defaults: { glassSelectionId: 1 } } }, status: 400 },
    ],
  },
]);

const wallAt = (admin: Guarded, url: (p: string) => string) => ({
  floor: async (projectId: string, label: string) => (await ok<{ floor: Floor }>(await admin.post(url("/floors"), { data: { projectId, label } }), 201)).floor,
  room: async (floorId: string, label: string) => (await ok<{ room: Room }>(await admin.post(url("/rooms"), { data: { floorId, label } }), 201)).room,
  sides: async (roomId: string, sides: unknown[], isClosed?: boolean) =>
    (await ok<{ room: Room }>(await admin.patch(url(`/rooms/${roomId}/sides`), { data: { sides, ...(isClosed === undefined ? {} : { isClosed }) } }))).room,
  partition: async (id: string) => (await ok<{ partition: Partition }>(await admin.get(url(`/partitions/${id}`)))).partition,
});

/** Stamp designSubmittedAt + insert a calculation, so the next write's invalidation is observable. */
async function armSubmitted(projectId: string) {
  await rgrSetDesignSubmittedAt(projectId);
  await rgrInsertCalculation(projectId);
  expect(await readProjectState(projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });
}

test.describe("floors", () => {
  test("create assigns MAX+1 orderIndex; same label is idempotent (201, same row); list ordered; rename; duplicate rename → 400", async ({ as, f, run, url }) => {
    const p = await f.project();
    const L = nm({ run }, "F");
    const mk = (label: string) => as.member.post(url("/floors"), { data: { projectId: ` ${p.id} `, label } });
    const a = (await ok<{ floor: Floor }>(await mk(` ${L}-1 `), 201)).floor;
    expect(a).toMatchObject({ projectId: p.id, label: `${L}-1`, orderIndex: 0, organizationId: run.testOrg.id });
    const b = (await ok<{ floor: Floor }>(await mk(`${L}-2`), 201)).floor;
    const c = (await ok<{ floor: Floor }>(await mk(`${L}-3`), 201)).floor;
    expect([b.orderIndex, c.orderIndex]).toEqual([1, 2]);
    const again = (await ok<{ floor: Floor }>(await mk(`${L}-2`), 201)).floor; // idempotent by (projectId, label)
    expect(again).toMatchObject({ id: b.id, orderIndex: 1 });

    const list = async () => (await ok<{ floors: Floor[] }>(await as.member.get(url(`/floors?projectId=${p.id}`)))).floors;
    expect((await list()).map((x) => [x.id, x.orderIndex])).toEqual([[a.id, 0], [b.id, 1], [c.id, 2]]);

    const r = (await ok<{ floor: Floor }>(await as.member.patch(url(`/floors/${c.id}`), { data: { label: ` ${L}-3x ` } }))).floor;
    expect(r).toMatchObject({ id: c.id, label: `${L}-3x`, orderIndex: 2 });
    await rejected(await as.admin.patch(url(`/floors/${c.id}`), { data: { label: `${L}-1` } }), 400, "A floor with this name already exists in this project.");

    expect(await ok(await as.admin.delete(url(`/floors/${a.id}`)))).toEqual({ ok: true });
    const d = (await ok<{ floor: Floor }>(await mk(`${L}-4`), 201)).floor;
    expect(d.orderIndex).toBe(3); // MAX + 1 — a deleted slot is not reused
    expect((await list()).map((x) => x.id)).toEqual([b.id, c.id, d.id]);
  });

  test("DELETE cascades rooms + partitions (selections stay), clears designSubmittedAt + calculation; then 404", async ({ as, f, url }) => {
    const w = await f.wall();
    const sel = await f.selection(w.projectId, "GLASS", { category: "Single" });
    await ok(await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { design: design([{ w: 2000, cells: [[2400, sel.id]] }]) } }));
    await armSubmitted(w.projectId);

    expect(await ok(await as.member.delete(url(`/floors/${w.floorId}`)))).toEqual({ ok: true });
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
    expect((await ok<{ floors: Floor[] }>(await as.admin.get(url(`/floors?projectId=${w.projectId}`)))).floors).toEqual([]);
    expect((await ok<{ rooms: Room[] }>(await as.admin.get(url(`/rooms?floorId=${w.floorId}`)))).rooms).toEqual([]);
    expect((await ok<{ partitions: Partition[] }>(await as.admin.get(url(`/partitions?roomId=${w.roomId}`)))).partitions).toEqual([]);
    await rejected(await as.admin.get(url(`/partitions/${w.partitionId}`)), 404, "Partition not found or access denied");
    await rejected(await as.admin.patch(url(`/rooms/${w.roomId}`), { data: { label: "rgr-gone" } }), 404, "Room not found or access denied");
    await rejected(await as.admin.delete(url(`/floors/${w.floorId}`)), 404, "Floor not found or access denied");
    await rejected(await as.admin.patch(url(`/floors/${w.floorId}`), { data: { label: "rgr-gone" } }), 404, "Floor not found or access denied");
    // selections are project-level: still listed, and now deletable (no partition references them)
    const sels = (await ok<{ selections: { id: string }[] }>(await as.admin.get(url(`/selections?projectId=${w.projectId}`)))).selections;
    expect(sels.map((s) => s.id)).toEqual([sel.id]);
    expect(await ok(await as.admin.delete(url(`/selections/${sel.id}`)))).toEqual({ id: sel.id });
  });
});

test.describe("rooms", () => {
  test("create: default closed 4-side PLAIN rectangle, MAX+1 orderIndex; duplicate label → 400; same label on another floor → 201", async ({ as, f, run, url }) => {
    const p = await f.project();
    const t = wallAt(as.admin, url);
    const fl = await t.floor(p.id, nm({ run }, "F"));
    const fl2 = await t.floor(p.id, nm({ run }, "F2"));
    const L = nm({ run }, "R");
    const r1 = (await ok<{ room: Room }>(await as.member.post(url("/rooms"), { data: { floorId: ` ${fl.id} `, label: ` ${L}-a ` } }), 201)).room;
    expect(r1).toMatchObject({ floorId: fl.id, label: `${L}-a`, orderIndex: 0, isClosed: true, organizationId: run.testOrg.id });
    expect(r1.sides).toHaveLength(4);
    for (const s of r1.sides) expect(s).toMatchObject({ kind: "PLAIN", partitionId: null, turnDegrees: 90, lengthMm: null, label: null, id: expect.any(String) });
    expect(new Set(r1.sides.map((s) => s.id)).size).toBe(4);
    const r2 = await t.room(fl.id, `${L}-b`);
    expect(r2.orderIndex).toBe(1);
    await rejected(await as.admin.post(url("/rooms"), { data: { floorId: fl.id, label: `${L}-a` } }), 400, "Room label conflict — please try again.");
    expect((await t.room(fl2.id, `${L}-a`)).orderIndex).toBe(0); // unique per floor only
    expect((await ok<{ partitions: Partition[] }>(await as.admin.get(url(`/partitions?roomId=${r1.id}`)))).partitions).toEqual([]);
  });

  test("rename (trimmed; duplicate → 400) and collection-PATCH reorder (exact set only; another floor's room → 400)", async ({ as, f, run, url }) => {
    const p = await f.project();
    const t = wallAt(as.admin, url);
    const fl = await t.floor(p.id, nm({ run }, "F"));
    const other = await t.floor(p.id, nm({ run }, "F2"));
    const L = nm({ run }, "R");
    const [r1, r2, r3] = [await t.room(fl.id, `${L}-1`), await t.room(fl.id, `${L}-2`), await t.room(fl.id, `${L}-3`)];
    const elsewhere = await t.room(other.id, `${L}-x`);

    const rn = (await ok<{ room: Room }>(await as.member.patch(url(`/rooms/${r2.id}`), { data: { label: ` ${L}-2b ` } }))).room;
    expect(rn).toMatchObject({ id: r2.id, label: `${L}-2b`, orderIndex: 1 });
    await rejected(await as.admin.patch(url(`/rooms/${r2.id}`), { data: { label: `${L}-1` } }), 400, "A room with this name already exists on this floor.");

    const ro = (await ok<{ rooms: Room[] }>(await as.member.patch(url("/rooms"), { data: { floorId: fl.id, orderedRoomIds: [r3.id, r1.id, r2.id] } }))).rooms;
    expect(ro.map((r) => [r.id, r.orderIndex])).toEqual([[r3.id, 0], [r1.id, 1], [r2.id, 2]]);
    const listed = (await ok<{ rooms: Room[] }>(await as.member.get(url(`/rooms?floorId=${fl.id}`)))).rooms;
    expect(listed.map((r) => r.id)).toEqual([r3.id, r1.id, r2.id]);

    const exact = "orderedRoomIds must contain exactly the rooms currently on this floor.";
    await rejected(await as.admin.patch(url("/rooms"), { data: { floorId: fl.id, orderedRoomIds: [r1.id, r2.id] } }), 400, exact);
    await rejected(await as.admin.patch(url("/rooms"), { data: { floorId: fl.id, orderedRoomIds: [r1.id, r2.id, elsewhere.id] } }), 400, exact);
    // unchanged after the rejected reorders
    expect((await ok<{ rooms: Room[] }>(await as.admin.get(url(`/rooms?floorId=${fl.id}`)))).rooms.map((r) => r.id)).toEqual([r3.id, r1.id, r2.id]);
    expect((await ok<{ rooms: Room[] }>(await as.admin.get(url(`/rooms?floorId=${other.id}`)))).rooms.map((r) => [r.id, r.orderIndex])).toEqual([[elsewhere.id, 0]]);
  });

  test("KNOWN BUG: a reorder with a duplicated room id is accepted (set equality ignores multiplicity)", async ({ as, f, run, url }) => {
    const p = await f.project();
    const t = wallAt(as.admin, url);
    const fl = await t.floor(p.id, nm({ run }, "F"));
    const [r1, r2] = [await t.room(fl.id, nm({ run }, "R1")), await t.room(fl.id, nm({ run }, "R2"))];
    // KNOWN BUG — reorderRooms compares Sets, so [r1, r1, r2] passes the "exact set" check and writes
    // orderIndex 0 and 1 to r1; when fixed, change this to 400 with the "must contain exactly" message.
    const r = await as.admin.patch(url("/rooms"), { data: { floorId: fl.id, orderedRoomIds: [r1.id, r1.id, r2.id] } });
    expect(r.status(), await r.text()).toBe(200);
    expect(((await r.json()) as { rooms: Room[] }).rooms.map((x) => x.id).sort()).toEqual([r1.id, r2.id].sort());
  });

  test("DELETE cascades its partitions, clears designSubmittedAt + calculation, leaves sibling rooms; then 404", async ({ as, f, run, url }) => {
    const w = await f.wall();
    const t = wallAt(as.admin, url);
    const sibling = await t.room(w.floorId, nm({ run }, "R2"));
    await armSubmitted(w.projectId);
    expect(await ok(await as.member.delete(url(`/rooms/${w.roomId}`)))).toEqual({ ok: true });
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
    await rejected(await as.admin.get(url(`/partitions/${w.partitionId}`)), 404, "Partition not found or access denied");
    expect((await ok<{ rooms: Room[] }>(await as.admin.get(url(`/rooms?floorId=${w.floorId}`)))).rooms.map((r) => r.id)).toEqual([sibling.id]);
    await rejected(await as.admin.delete(url(`/rooms/${w.roomId}`)), 404, "Room not found or access denied");
    await rejected(await as.admin.patch(url(`/rooms/${w.roomId}/sides`), { data: { sides: plain4() } }), 404, "Room not found or access denied");
  });
});

test.describe("rooms/:id/sides topology", () => {
  test("PARTITION sides create partitions with the declared label/height/width and a seeded 3-section v2 design", async ({ as, f, run, url }) => {
    const p = await f.project();
    const t = wallAt(as.admin, url);
    const fl = await t.floor(p.id, nm({ run }, "F"));
    const room = await t.room(fl.id, nm({ run }, "R"));
    const [L1, L2] = [nm({ run }, "W1"), nm({ run }, "W2")];
    const r = await t.sides(room.id, [
      newSide(L1, 2400, 3000),
      { kind: "PLAIN", turnDegrees: 90, lengthMm: 1500, label: "rgr-plain" },
      { ...newSide(L2, 2700, 1000), turnDegrees: 270 },
      { kind: "PLAIN" }, // turnDegrees defaults to 90
    ]);
    expect(r.sides.map((s) => [s.kind, s.turnDegrees, s.lengthMm, s.label])).toEqual([
      ["PARTITION", 90, null, null],
      ["PLAIN", 90, 1500, "rgr-plain"],
      ["PARTITION", 270, null, null],
      ["PLAIN", 90, null, null],
    ]);
    const [p1, p2] = [r.sides[0].partitionId!, r.sides[2].partitionId!];
    expect(p1).toEqual(expect.any(String));
    expect(p2).toEqual(expect.any(String));

    const listed = (await ok<{ partitions: Partition[] }>(await as.member.get(url(`/partitions?roomId=${room.id}`)))).partitions;
    expect(listed.map((x) => x.id)).toEqual([p1, p2]); // ordered by partitionNumber
    expect(listed[1].partitionNumber).toBeGreaterThan(listed[0].partitionNumber);
    const a = await t.partition(p1);
    expect(a).toMatchObject({ roomId: room.id, label: L1, heightMm: 2400, widthMm: 3000, status: "DRAFT", organizationId: run.testOrg.id });
    expect(a.design!.schemaVersion).toBe(2);
    expect(a.design!.sections!.map((s) => s.widthMm)).toEqual([1000, 1000, 1000]);
    for (const s of a.design!.sections!) expect(s.cells).toEqual([{ id: expect.any(String), heightMm: 2400, selectionId: null }]);
    const b = await t.partition(p2);
    expect(b).toMatchObject({ label: L2, heightMm: 2700, widthMm: 1000 });
    expect(b.design!.sections!.map((s) => s.widthMm)).toEqual([333, 333, 334]); // last absorbs the remainder
    expect(b.design!.sections!.reduce((n, s) => n + s.widthMm, 0)).toBe(b.widthMm);
  });

  test("keep-by-partitionId: reorder/relabel keeps partitions + side ids and does NOT invalidate; removing one deletes it and invalidates; adding one invalidates", async ({ as, f, run, url }) => {
    const w = await f.wall();
    const t = wallAt(as.admin, url);
    const r0 = await t.sides(w.roomId, [newSide(nm({ run }, "W1")), PLAIN3[0], newSide(nm({ run }, "W2"), 2400, 1500), PLAIN3[1]]);
    // f.wall's own partition is not in this array → it was removed; the two new ones were created
    await rejected(await as.admin.get(url(`/partitions/${w.partitionId}`)), 404, "Partition not found or access denied");
    const [s0, s2] = [r0.sides[0], r0.sides[2]];

    await armSubmitted(w.projectId);
    const r1 = await t.sides(w.roomId, [
      { kind: "PARTITION", turnDegrees: 90, partitionId: s2.partitionId },
      { kind: "PLAIN", turnDegrees: 90, lengthMm: 900, label: "rgr-relabelled" },
      { kind: "PARTITION", turnDegrees: 180, partitionId: s0.partitionId },
      { kind: "PLAIN", turnDegrees: 90 },
    ]);
    expect(r1.sides.map((s) => [s.id, s.partitionId])).toEqual([[s2.id, s2.partitionId], [expect.any(String), null], [s0.id, s0.partitionId], [expect.any(String), null]]);
    expect(r1.sides[2].turnDegrees).toBe(180);
    expect((await t.partition(s0.partitionId!)).id).toBe(s0.partitionId);
    expect((await t.partition(s2.partitionId!)).id).toBe(s2.partitionId);
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });

    // convert s0's partition back to PLAIN → deleted + invalidated
    await t.sides(w.roomId, [{ kind: "PARTITION", turnDegrees: 90, partitionId: s2.partitionId }, ...PLAIN3]);
    await rejected(await as.admin.get(url(`/partitions/${s0.partitionId}`)), 404, "Partition not found or access denied");
    expect((await ok<{ partitions: Partition[] }>(await as.admin.get(url(`/partitions?roomId=${w.roomId}`)))).partitions.map((x) => x.id)).toEqual([s2.partitionId]);
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });

    // adding a partition invalidates too
    await armSubmitted(w.projectId);
    const r3 = await t.sides(w.roomId, [{ kind: "PARTITION", turnDegrees: 90, partitionId: s2.partitionId }, newSide(nm({ run }, "W3")), PLAIN3[0], PLAIN3[1]]);
    expect(r3.sides[1].partitionId).toEqual(expect.any(String));
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
  });

  test("open rooms: isClosed false allows < 3 sides; closing it again with < 3 sides → 400; a partition from another room of the same org → 400", async ({ as, f, url }) => {
    const w = await f.wall();
    const other = await f.wall();
    const t = wallAt(as.admin, url);
    const open = await t.sides(w.roomId, [{ kind: "PARTITION", turnDegrees: 90, partitionId: w.partitionId }], false);
    expect(open.isClosed).toBe(false);
    expect(open.sides).toHaveLength(1);
    await rejected(await as.admin.patch(url(`/rooms/${w.roomId}/sides`), { data: { sides: [{ kind: "PARTITION", turnDegrees: 90, partitionId: w.partitionId }], isClosed: true } }), 400, "A closed room must have at least 3 sides.");
    await rejected(
      await as.admin.patch(url(`/rooms/${w.roomId}/sides`), { data: { sides: [{ kind: "PARTITION", turnDegrees: 90, partitionId: other.partitionId }, ...PLAIN3] } }),
      400,
      `partitionId ${other.partitionId} is not a side of this room.`,
    );
    // all-or-nothing: the rejected PATCHes changed nothing; the other room's partition is intact
    const listed = (await ok<{ partitions: Partition[] }>(await as.admin.get(url(`/partitions?roomId=${w.roomId}`)))).partitions;
    expect(listed.map((x) => x.id)).toEqual([w.partitionId]);
    expect((await t.partition(other.partitionId)).roomId).toBe(other.roomId);
  });

  test("KNOWN BUG: a new PARTITION side's heightMm/widthMm are not range-checked (negative stored; fractional width → inconsistent row)", async ({ as, f, run, url }) => {
    const w = await f.wall();
    // KNOWN BUG — the sides route only checks `typeof === "number"` and replaceSides only truthiness, so
    // a negative height creates a partition with heightMm -5; when fixed, change this to 400.
    const neg = await as.admin.patch(url(`/rooms/${w.roomId}/sides`), { data: { sides: [newSide(nm({ run }, "Wneg"), -5, 2000), ...PLAIN3] } });
    expect(neg.status(), await neg.text()).toBe(200);
    const pid = ((await neg.json()) as { room: Room }).room.sides[0].partitionId!;
    expect((await ok<{ partition: Partition }>(await as.admin.get(url(`/partitions/${pid}`)))).partition.heightMm).toBe(-5);
    // KNOWN BUG — a fractional widthMm is truncated on the Int column (1500) while the seeded design keeps
    // the fraction (500 + 500 + 500.5 = 1500.5): the stored row breaks the "section widths sum to widthMm"
    // invariant that parseStoredDesign enforces on read. When fixed, change this to 400.
    const frac = await as.admin.patch(url(`/rooms/${w.roomId}/sides`), { data: { sides: [newSide(nm({ run }, "Wfrac"), 2400, 1500.5), ...PLAIN3] } });
    expect(frac.status(), await frac.text()).toBe(200);
    const fp = ((await frac.json()) as { room: Room }).room.sides[0].partitionId!;
    const row = await readPartitionRow(fp);
    expect(row.widthMm).toBe(1500);
    const widths = (row.design as { sections: { widthMm: number }[] }).sections.map((s) => s.widthMm);
    expect(widths).toEqual([500, 500, 500.5]);
  });
});

test.describe("partitions: design v2", () => {
  test("accepted design: widthMm derived from section widths (any sum), cells/hinging stored; height-sum mismatch → 400 and nothing written", async ({ as, f, url }) => {
    const w = await f.wall(); // 2000 x 2400
    const sel = await f.selection(w.projectId, "GLASS", { category: "Single" });
    const P = url(`/partitions/${w.partitionId}`);
    const d1 = {
      schemaVersion: 2,
      sections: [
        { id: "a", widthMm: 1200, cells: [{ id: "a0", heightMm: 2400, selectionId: sel.id }] },
        { id: "b", widthMm: 800, cells: [{ id: "b0", heightMm: 1000, selectionId: null }, { id: "b1", heightMm: 1400, selectionId: sel.id, hinging: "right" }] },
      ],
    };
    const p1 = (await ok<{ partition: Partition }>(await as.member.patch(P, { data: { design: d1 } }))).partition;
    expect(p1.widthMm).toBe(2000);
    expect(p1.design).toEqual(d1);
    // Partition.widthMm is DERIVED from the sections (Stage 18 invariant 3) — no "must equal the wall" rule
    const p2 = (await ok<{ partition: Partition }>(await as.admin.patch(P, { data: { design: design([{ w: 1500, cells: [[2400, sel.id]] }, { w: 1000, cells: [[2400, null]] }]) } }))).partition;
    expect(p2.widthMm).toBe(2500);

    await rejected(await as.admin.patch(P, { data: { design: design([{ w: 2000, cells: [[1000, null], [1300, null]] }]) } }), 400, "design.sections[0] cell heights sum to 2300mm but the partition height is 2400mm");
    // D-9: a heightMm-only PATCH on a v2 row whose cells don't sum to it is a 400
    await rejected(await as.admin.patch(P, { data: { heightMm: 2700 } }), 400, "design.sections[0] cell heights sum to 2400mm but the partition height is 2700mm");
    const row = await readPartitionRow(w.partitionId);
    expect(row).toMatchObject({ widthMm: 2500, heightMm: 2400 });
    // height + matching sections together → accepted
    const p3 = (await ok<{ partition: Partition }>(await as.admin.patch(P, { data: { heightMm: 2700, design: design([{ w: 2000, cells: [[2700, sel.id]] }]) } }))).partition;
    expect(p3).toMatchObject({ heightMm: 2700, widthMm: 2000 });
  });

  test("selection references must be in the same project: another project's / org B's / unknown selectionId → 400 (cells and stops)", async ({ as, f, url, run, orgB }) => {
    const w = await f.wall();
    const otherProj = await f.project();
    const mine = await f.selection(w.projectId, "GLASS", { category: "Single" });
    const theirs = await f.selection(otherProj.id, "GLASS", { category: "Single" });
    const foreign = (await foreignTree({ run, orgB })).selectionId;
    const P = url(`/partitions/${w.partitionId}`);
    const msg = (ids: string[]) => `The following selectionId(s) do not belong to this project: ${ids.join(", ")}`;
    for (const bad of [theirs.id, foreign, GHOST]) {
      await rejected(await as.admin.patch(P, { data: { design: design([{ w: 2000, cells: [[2400, bad]] }]) } }), 400, msg([bad]));
      await rejected(await as.admin.patch(P, { data: { design: { stops: { top: bad } } } }), 400, msg([bad]));
    }
    // defaults.glassSelectionId is editor-only and deliberately not checked
    await ok(await as.admin.patch(P, { data: { design: { defaults: { glassSelectionId: GHOST } } } }));
    await ok(await as.admin.patch(P, { data: { design: { ...design([{ w: 2000, cells: [[2400, mine.id]] }]), stops: { top: mine.id, left: null } } } }));
  });

  test("partial-replace: stops/defaults-only and label-only PATCHes keep the stored sections; label is trimmed", async ({ as, f, run, url }) => {
    const w = await f.wall();
    const sel = await f.selection(w.projectId, "GLASS", { category: "Single" });
    const P = url(`/partitions/${w.partitionId}`);
    const d = design([{ w: 2000, cells: [[2400, sel.id]] }]);
    await ok(await as.admin.patch(P, { data: { design: { ...d, measurements: { rgr: 1 } } } }));
    const s = (await ok<{ partition: Partition }>(await as.admin.patch(P, { data: { design: { stops: { bottom: sel.id } } } }))).partition;
    expect(s.design).toEqual({ ...d, measurements: { rgr: 1 }, stops: { bottom: sel.id } });
    const L = nm({ run }, "relabel");
    const l = (await ok<{ partition: Partition }>(await as.member.patch(P, { data: { label: ` ${L} ` } }))).partition;
    expect(l).toMatchObject({ label: L, widthMm: 2000, heightMm: 2400 });
    expect(l.design).toEqual(s.design);
  });

  test("a stored v1 (panels) row: label-only PATCH keeps it; a v2 sections PATCH replaces panels and stamps schemaVersion 2", async ({ as, f, url }) => {
    const w = await f.wall();
    await rgrSeedV1Design(w.partitionId, { panels: [{ id: "p1", type: "glass", widthMm: 2000, heightMm: 2400, selectionId: null }], stops: { top: null } });
    const P = url(`/partitions/${w.partitionId}`);
    const g = (await ok<{ partition: Partition }>(await as.admin.get(P))).partition;
    expect(g.design).toMatchObject({ panels: [expect.objectContaining({ id: "p1" })] });
    await ok(await as.admin.patch(P, { data: { label: "rgr-v1-label" } }));
    expect((await readPartitionRow(w.partitionId)).design).toMatchObject({ panels: expect.any(Array) });
    const d = design([{ w: 1000, cells: [[2400, null]] }, { w: 1000, cells: [[2400, null]] }]);
    const p = (await ok<{ partition: Partition }>(await as.admin.patch(P, { data: { design: d } }))).partition;
    expect(p.design).toEqual({ ...d, stops: { top: null } });
    expect(p.design).not.toHaveProperty("panels");
  });

  test("invalidation: label-only PATCH keeps designSubmittedAt + calculation; design PATCH and heightMm PATCH clear both", async ({ as, f, url }) => {
    const w = await f.wall();
    const P = url(`/partitions/${w.partitionId}`);
    await armSubmitted(w.projectId);
    await ok(await as.admin.patch(P, { data: { label: "rgr-label-only" } }));
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });

    await ok(await as.admin.patch(P, { data: { design: { stops: { top: null } } } })); // any `design` key counts
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });

    await armSubmitted(w.projectId);
    await ok(await as.admin.patch(P, { data: { heightMm: 2500, design: design([{ w: 2000, cells: [[2500, null]] }]) } }));
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
  });
});

test.describe("design tree: invalidation audit, tenancy, roles, status", () => {
  test("non-invalidating writes (Stage 25 B2 audit): floor/room create + rename, plain-side edits keep designSubmittedAt + calculation", async ({ as, f, run, url }) => {
    const w = await f.wall();
    const t = wallAt(as.admin, url);
    await armSubmitted(w.projectId);
    const fl2 = await t.floor(w.projectId, nm({ run }, "F2"));
    await ok(await as.admin.patch(url(`/floors/${fl2.id}`), { data: { label: nm({ run }, "F2b") } }));
    await ok(await as.admin.patch(url(`/floors/${w.floorId}`), { data: { label: nm({ run }, "F1b") } }));
    const r2 = await t.room(w.floorId, nm({ run }, "R2"));
    await ok(await as.admin.patch(url(`/rooms/${r2.id}`), { data: { label: nm({ run }, "R2b") } }));
    await ok(await as.admin.patch(url("/rooms"), { data: { floorId: w.floorId, orderedRoomIds: [r2.id, w.roomId] } }));
    await t.sides(r2.id, [{ kind: "PLAIN", turnDegrees: 45, lengthMm: 10 }, ...PLAIN3]);
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });
    // deleting an EMPTY floor still invalidates (deleteFloor does not check for partitions)
    await ok(await as.admin.delete(url(`/floors/${fl2.id}`)));
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
  });

  test("cross-tenant: org B's floor/room/partition under the Test-Org slug → 404 / [] / 400 for every verb; org B's rows are untouched", async ({ as, run, orgB, url }) => {
    const t = await foreignTree({ run, orgB });
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const before = (await ok<{ partition: Partition }>(await orgB.get(B(`/partitions/${t.partitionId}`)))).partition;
    const notFound: Array<[string, () => Promise<APIResponse>, string]> = [
      ["GET partition", () => as.admin.get(url(`/partitions/${t.partitionId}`)), "Partition not found or access denied"],
      ["PATCH partition", () => as.admin.patch(url(`/partitions/${t.partitionId}`), { data: { label: `${run.prefix}hijack` } }), "Partition not found or access denied"],
      ["PATCH floor", () => as.admin.patch(url(`/floors/${t.floorId}`), { data: { label: `${run.prefix}hijack` } }), "Floor not found or access denied"],
      ["DELETE floor", () => as.admin.delete(url(`/floors/${t.floorId}`)), "Floor not found or access denied"],
      ["PATCH room", () => as.admin.patch(url(`/rooms/${t.roomId}`), { data: { label: `${run.prefix}hijack` } }), "Room not found or access denied"],
      ["DELETE room", () => as.admin.delete(url(`/rooms/${t.roomId}`)), "Room not found or access denied"],
      ["PATCH sides", () => as.admin.patch(url(`/rooms/${t.roomId}/sides`), { data: { sides: plain4() } }), "Room not found or access denied"],
    ];
    for (const [what, call, error] of notFound) {
      const r = await call();
      expect(r.status(), what).toBe(404);
      expect(await r.json(), what).toEqual({ error });
    }
    expect((await ok<{ floors: unknown[] }>(await as.admin.get(url(`/floors?projectId=${t.projectId}`)))).floors).toEqual([]);
    expect((await ok<{ rooms: unknown[] }>(await as.admin.get(url(`/rooms?floorId=${t.floorId}`)))).rooms).toEqual([]);
    expect((await ok<{ partitions: unknown[] }>(await as.admin.get(url(`/partitions?roomId=${t.roomId}`)))).partitions).toEqual([]);
    await rejected(await as.admin.post(url("/floors"), { data: { projectId: t.projectId, label: `${run.prefix}hijack` } }), 400, "Project not found or access denied.");
    await rejected(await as.admin.post(url("/rooms"), { data: { floorId: t.floorId, label: `${run.prefix}hijack` } }), 400, "Floor not found or access denied.");
    await rejected(await as.admin.patch(url("/rooms"), { data: { floorId: t.floorId, orderedRoomIds: [t.roomId] } }), 400, "Floor not found or access denied.");

    const after = (await ok<{ partition: Partition }>(await orgB.get(B(`/partitions/${t.partitionId}`)))).partition;
    expect(after).toEqual(before);
    const fl = (await ok<{ floors: Floor[] }>(await orgB.get(B(`/floors?projectId=${t.projectId}`)))).floors;
    expect(fl.map((x) => x.id)).toContain(t.floorId);
    const rm = (await ok<{ rooms: Room[] }>(await orgB.get(B(`/rooms?floorId=${t.floorId}`)))).rooms;
    expect(rm.find((x) => x.id === t.roomId)!.sides[0].partitionId).toBe(t.partitionId);
  });

  test("org B cannot see or modify a Test-Org design tree through its own slug (404 / [] / 400)", async ({ f, run, orgB }) => {
    const w = await f.wall();
    const B = (p: string) => orgApi(run.orgB.slug, p);
    expect((await ok<{ floors: unknown[] }>(await orgB.get(B(`/floors?projectId=${w.projectId}`)))).floors).toEqual([]);
    expect((await ok<{ rooms: unknown[] }>(await orgB.get(B(`/rooms?floorId=${w.floorId}`)))).rooms).toEqual([]);
    expect((await ok<{ partitions: unknown[] }>(await orgB.get(B(`/partitions?roomId=${w.roomId}`)))).partitions).toEqual([]);
    await rejected(await orgB.get(B(`/partitions/${w.partitionId}`)), 404, "Partition not found or access denied");
    await rejected(await orgB.patch(B(`/partitions/${w.partitionId}`), { data: { design: design([{ w: 100, cells: [[2400, null]] }]) } }), 404, "Partition not found or access denied");
    await rejected(await orgB.delete(B(`/floors/${w.floorId}`)), 404, "Floor not found or access denied");
    await rejected(await orgB.delete(B(`/rooms/${w.roomId}`)), 404, "Room not found or access denied");
    await rejected(await orgB.patch(B(`/rooms/${w.roomId}/sides`), { data: { sides: plain4() } }), 404, "Room not found or access denied");
    await rejected(await orgB.post(B("/floors"), { data: { projectId: w.projectId, label: `${run.prefix}hijack` } }), 400, "Project not found or access denied.");
    const row = await readPartitionRow(w.partitionId);
    expect(row).toMatchObject({ widthMm: 2000, heightMm: 2400 });
  });

  test("any org member builds the tree: distributor and architect on their own company's project", async ({ as, run, ledger, url }) => {
    const co = await distributorCompanyId({ run, as });
    for (const who of ["distributor", "architect"] as const) {
      const g = as[who];
      const { id: projectId, body } = await createLedgered(g, { run, ledger }, "project", { name: nm({ run }, `p-${who}`), currency: "AED" });
      expect(projectId, JSON.stringify(body)).not.toBeNull();
      expect((body.project as { externalCompanyId: string }).externalCompanyId).toBe(co);
      const t = wallAt(g, url);
      const fl = await t.floor(projectId!, nm({ run }, "F"));
      const rm = await t.room(fl.id, nm({ run }, "R"));
      const r = await t.sides(rm.id, [newSide(nm({ run }, "W")), ...PLAIN3]);
      const pid = r.sides[0].partitionId!;
      await ok(await g.patch(url(`/partitions/${pid}`), { data: { design: design([{ w: 2000, cells: [[2400, null]] }]) } }));
      // positive reads/writes for the rightful owner: a filter that matched nothing for owners would fail here
      const rm2 = await t.room(fl.id, nm({ run }, "R-b"));
      expect((await ok<{ floors: Floor[] }>(await g.get(url(`/floors?projectId=${projectId}`)))).floors.map((x) => x.id), who).toEqual([fl.id]);
      expect((await ok<{ rooms: Room[] }>(await g.get(url(`/rooms?floorId=${fl.id}`)))).rooms.map((x) => x.id).sort(), who).toEqual([rm.id, rm2.id].sort());
      expect((await ok<{ partitions: Partition[] }>(await g.get(url(`/partitions?roomId=${rm.id}`)))).partitions.map((x) => x.id), who).toEqual([pid]);
      expect((await ok<{ partition: Partition }>(await g.get(url(`/partitions/${pid}`)))).partition.id, who).toBe(pid);
      await ok(await g.patch(url(`/floors/${fl.id}`), { data: { label: nm({ run }, "F-ren") } }));
      await ok(await g.patch(url("/rooms"), { data: { floorId: fl.id, orderedRoomIds: [rm2.id, rm.id] } }));
      expect((await ok<{ rooms: Room[] }>(await g.get(url(`/rooms?floorId=${fl.id}`)))).rooms.map((x) => x.id), who).toEqual([rm2.id, rm.id]);
      await ok(await g.patch(url(`/rooms/${rm.id}`), { data: { label: nm({ run }, "R2") } }));
      await ok(await g.delete(url(`/rooms/${rm2.id}`)));
      await ok(await g.delete(url(`/rooms/${rm.id}`)));
      await ok(await g.delete(url(`/floors/${fl.id}`)));
    }
  });

  test("an external user cannot read or write the design tree of another company's project (foreign parent looks like a missing one)", async ({ as, f, run, ledger, url }) => {
    // Fixed by Hotfix 2026-10-05 (HF-3/HF-4, backlog 2026-10-04 "Cross-company access by id"): floors/rooms/
    // partitions are scoped through the owning project's company. Every foreign request must answer exactly
    // like the same request against a random UUID.
    const otherCo = await f.externalCompany();
    const { id: projectId, body } = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "p-idor"), currency: "AED", externalCompanyId: otherCo.id });
    expect(projectId, JSON.stringify(body)).not.toBeNull();
    const t = wallAt(as.admin, url);
    const fl = await t.floor(projectId!, nm({ run }, "F"));
    const rm = await t.room(fl.id, nm({ run }, "R"));
    const sd = await t.sides(rm.id, [newSide(nm({ run }, "W")), ...PLAIN3]);
    const pid = sd.sides[0].partitionId!;
    const before = await t.partition(pid);

    // [method, path against the foreign tree, body, same path against a random UUID, body]
    type Call = [method: "get" | "post" | "patch" | "delete", foreign: string, ghost: string, foreignBody?: object, ghostBody?: object];
    const calls: Call[] = [
      ["get", `/floors?projectId=${projectId}`, `/floors?projectId=${GHOST}`],
      ["post", "/floors", "/floors", { projectId, label: nm({ run }, "F-x") }, { projectId: GHOST, label: nm({ run }, "F-x") }],
      ["patch", `/floors/${fl.id}`, `/floors/${GHOST}`, { label: nm({ run }, "F-ren") }, { label: nm({ run }, "F-ren") }],
      ["delete", `/floors/${fl.id}`, `/floors/${GHOST}`],
      ["get", `/rooms?floorId=${fl.id}`, `/rooms?floorId=${GHOST}`],
      ["post", "/rooms", "/rooms", { floorId: fl.id, label: nm({ run }, "R-x") }, { floorId: GHOST, label: nm({ run }, "R-x") }],
      ["patch", "/rooms", "/rooms", { floorId: fl.id, orderedRoomIds: [rm.id] }, { floorId: GHOST, orderedRoomIds: [rm.id] }],
      ["patch", `/rooms/${rm.id}`, `/rooms/${GHOST}`, { label: nm({ run }, "R-ren") }, { label: nm({ run }, "R-ren") }],
      ["patch", `/rooms/${rm.id}/sides`, `/rooms/${GHOST}/sides`, { sides: PLAIN3 }, { sides: PLAIN3 }],
      ["delete", `/rooms/${rm.id}`, `/rooms/${GHOST}`],
      ["get", `/partitions?roomId=${rm.id}`, `/partitions?roomId=${GHOST}`],
      ["get", `/partitions/${pid}`, `/partitions/${GHOST}`],
      ["patch", `/partitions/${pid}`, `/partitions/${GHOST}`, { label: nm({ run }, "W-ren") }, { label: nm({ run }, "W-ren") }],
    ];
    for (const who of ["distributor", "architect"] as const) {
      for (const [method, foreign, ghost, foreignBody, ghostBody] of calls) {
        const rf = await as[who][method](url(foreign), foreignBody ? { data: foreignBody } : undefined);
        const rg = await as[who][method](url(ghost), ghostBody ? { data: ghostBody } : undefined);
        const label = `${who} ${method} ${foreign}`;
        expect([rf.status(), await rf.text()], label).toEqual([rg.status(), await rg.text()]);
        if (method !== "get") expect(rf.status(), label).toBeGreaterThanOrEqual(400);
      }
    }
    // ... and nothing was written: the owner-side tree is exactly as built.
    expect((await ok<{ floors: Floor[] }>(await as.admin.get(url(`/floors?projectId=${projectId}`)))).floors.map((x) => [x.id, x.label])).toEqual([[fl.id, fl.label]]);
    expect((await ok<{ rooms: Room[] }>(await as.admin.get(url(`/rooms?floorId=${fl.id}`)))).rooms.map((x) => [x.id, x.label])).toEqual([[rm.id, rm.label]]);
    expect(await t.partition(pid)).toEqual(before);
  });

  test("DECISION NEEDED: design-tree writes are not DRAFT-gated — a SUBMITTED project still accepts floor/room/side/partition edits", async ({ as, f, run, url }) => {
    const w = await f.wall();
    try {
      await rgrSetProjectStatus(w.projectId, "SUBMITTED");
      // the project header itself is locked ...
      await rejected(await as.admin.patch(url(`/projects/${w.projectId}`), { data: { currency: "USD" } }), 409, "This project cannot be edited — only DRAFT projects are editable.");
      // DECISION NEEDED (not a confirmed bug) — none of the design-tree routes checks Project.status (only
      // project PATCH/DELETE/reset/recompute/config-update are DRAFT-only); Stage 19 deliberately gave floor
      // DELETE no gate. This pins today's behaviour; if design edits are made DRAFT-only, change each
      // expectation below to 409.
      const fl = (await ok<{ floor: Floor }>(await as.admin.post(url("/floors"), { data: { projectId: w.projectId, label: nm({ run }, "F2") } }), 201)).floor;
      await ok(await as.admin.patch(url(`/floors/${w.floorId}`), { data: { label: nm({ run }, "F1b") } }));
      const rm = (await ok<{ room: Room }>(await as.admin.post(url("/rooms"), { data: { floorId: fl.id, label: nm({ run }, "R") } }), 201)).room;
      await ok(await as.admin.patch(url(`/rooms/${w.roomId}/sides`), { data: { sides: [{ kind: "PARTITION", turnDegrees: 90, partitionId: w.partitionId }, ...PLAIN3] } }));
      await ok(await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { design: design([{ w: 1800, cells: [[2400, null]] }]) } }));
      await ok(await as.admin.delete(url(`/rooms/${rm.id}`)));
      await ok(await as.admin.delete(url(`/floors/${fl.id}`)));
      expect((await readPartitionRow(w.partitionId)).widthMm).toBe(1800);
    } finally {
      await rgrSetProjectStatus(w.projectId, "DRAFT"); // teardown deletes through the DRAFT-only route
    }
  });

  test("list routes: missing parent query parameter → 400", async ({ as, url }) => {
    await rejected(await as.admin.get(url("/floors")), 400, "projectId query parameter is required");
    await rejected(await as.admin.get(url("/rooms")), 400, "floorId query parameter is required");
    await rejected(await as.admin.get(url("/partitions")), 400, "roomId query parameter is required");
    await rejected(await as.admin.get(url("/floors?projectId=")), 400, "projectId query parameter is required");
  });
});
