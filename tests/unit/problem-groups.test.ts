/**
 * Unit tests for the problem popup grouping (Stage 34 Batch 7, S34-7 / D-33, D-34, D-37).
 * Pure — no DB, no React.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { groupDesignProblems, roomSummary, wallSummary } from "../../lib/materials/problem-groups";
import type { CalculationProblem } from "../../lib/materials/problems";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function p(
  roomId: string,
  partitionId: string,
  over: Partial<CalculationProblem> = {},
  names: { floor?: string; room?: string; wall?: string; floorId?: string } = {},
): CalculationProblem {
  return {
    kind: "CELL_UNASSIGNED",
    scope: "DESIGN",
    reason: "GLASS_CELL",
    message: "same message for everyone",
    locus: {
      floorId: names.floorId ?? "f1",
      floorName: names.floor ?? "Ground",
      roomId,
      roomName: names.room ?? `Room ${roomId}`,
      partitionId,
      partitionLabel: names.wall ?? `Wall ${partitionId}`,
      sectionIndex: 0,
      cellIndex: 0,
    },
    ...over,
  };
}

describe("groupDesignProblems", () => {
  test("interleaved input (collector sorts by kind) still groups by ids, in first-appearance order", () => {
    const input = [
      p("r1", "p1"),
      p("r2", "p3"),
      p("r1", "p2"),
      p("r2", "p4"),
      p("r1", "p1"),
      p("r2", "p3", { kind: "SELECTION_MISSING", reason: undefined }),
    ];
    const g = groupDesignProblems(input);
    assert.deepEqual(g.rooms.map((r) => r.roomId), ["r1", "r2"]);
    assert.deepEqual(g.rooms[0].walls.map((w) => w.partitionId), ["p1", "p2"]);
    assert.deepEqual(g.rooms[1].walls.map((w) => w.partitionId), ["p3", "p4"]);
    assert.equal(g.rooms[0].walls[0].noGlass, 2);
    assert.equal(g.rooms[1].walls[0].noGlass, 1);
    assert.equal(g.rooms[1].walls[0].deleted, 1);
    assert.equal(g.total, input.length);
    assert.equal(g.rooms.reduce((n, r) => n + r.count, 0), input.length);
  });

  test("same room name on two floors and same wall label stay separate (ids, not names)", () => {
    const g = groupDesignProblems([
      p("r1", "p1", {}, { room: "Room 1", wall: "Top wall", floorId: "f1", floor: "Ground" }),
      p("r2", "p2", {}, { room: "Room 1", wall: "Top wall", floorId: "f2", floor: "First" }),
    ]);
    assert.equal(g.rooms.length, 2);
    assert.equal(g.rooms[0].walls.length, 1);
    assert.equal(g.rooms[1].walls.length, 1);
  });

  test("the message is never read: identical, empty or UUID-bearing messages group the same", () => {
    const a = groupDesignProblems([p("r1", "p1", { message: "" }), p("r1", "p1", { message: "x 123e4567-e89b-12d3-a456-426614174000" })]);
    assert.equal(a.rooms.length, 1);
    assert.equal(a.rooms[0].walls.length, 1);
    assert.equal(a.rooms[0].walls[0].count, 2);
  });

  test("problems with no partition or no room locus are kept and counted, never dropped", () => {
    const noLocus: CalculationProblem = { kind: "CELL_UNASSIGNED", scope: "DESIGN", message: "somewhere" };
    const roomOnly = p("r1", "p1", { locus: { floorId: "f1", floorName: "Ground", roomId: "r1", roomName: "Room r1" } });
    const g = groupDesignProblems([p("r1", "p1"), roomOnly, noLocus]);
    assert.equal(g.total, 3);
    assert.equal(g.loose.length, 1);
    assert.equal(g.rooms[0].loose.length, 1);
    assert.equal(g.rooms[0].walls.length, 1);
    assert.equal(g.rooms[0].count, 2);
  });

  test("non-DESIGN problems are ignored", () => {
    const g = groupDesignProblems([p("r1", "p1", { scope: "SELECTION" }), p("r1", "p1")]);
    assert.equal(g.total, 1);
  });

  test("showFloor: one floor false; two floors true; floorCount overrides", () => {
    const one = [p("r1", "p1"), p("r2", "p2")];
    const two = [p("r1", "p1"), p("r2", "p2", {}, { floorId: "f2", floor: "First" })];
    assert.equal(groupDesignProblems(one).showFloor, false);
    assert.equal(groupDesignProblems(two).showFloor, true);
    assert.equal(groupDesignProblems(one, { floorCount: 2 }).showFloor, true);
    assert.equal(groupDesignProblems(two, { floorCount: 1 }).showFloor, false);
  });

  test("with floors shown, rooms of one floor stay together in first-appearance floor order", () => {
    const g = groupDesignProblems([
      p("r1", "p1", {}, { floorId: "f1" }),
      p("r2", "p2", {}, { floorId: "f2", floor: "First" }),
      p("r3", "p3", {}, { floorId: "f1" }),
    ]);
    assert.deepEqual(g.rooms.map((r) => r.roomId), ["r1", "r3", "r2"]);
  });

  test("missing names fall back to generic labels, never an id", () => {
    const g = groupDesignProblems([
      { kind: "CELL_UNASSIGNED", scope: "DESIGN", message: "m", locus: { roomId: "123e4567-e89b-12d3-a456-426614174000", partitionId: "223e4567-e89b-12d3-a456-426614174000" } },
    ]);
    assert.equal(g.rooms[0].name, "Room");
    assert.equal(g.rooms[0].walls[0].label, "Wall");
    assert.doesNotMatch(roomSummary(g.rooms[0]) + wallSummary(g.rooms[0].walls[0]), UUID);
  });
});

describe("summaries", () => {
  test("wall summary words each cause and pluralises", () => {
    const g = groupDesignProblems([
      p("r1", "p1"),
      p("r1", "p1"),
      p("r1", "p1", { reason: "DOOR_CELL" }),
      p("r1", "p1", { kind: "SELECTION_MISSING", reason: undefined }),
      p("r1", "p1", { kind: "SELECTION_TYPE_UNKNOWN", reason: undefined }),
      p("r1", "p1", { reason: undefined }),
    ]);
    assert.equal(
      wallSummary(g.rooms[0].walls[0]),
      "2 panels without glass · 1 door without a component · 1 cell without a component · 1 panel uses a deleted component · 1 panel uses a retired component type",
    );
  });

  test("not started and malformed", () => {
    const g = groupDesignProblems([p("r1", "p1", { reason: "NOT_STARTED" }), p("r1", "p2", { reason: "MALFORMED" })]);
    assert.equal(wallSummary(g.rooms[0].walls[0]), "Design not started");
    assert.equal(wallSummary(g.rooms[0].walls[1]), "Design is incomplete");
  });

  test("room summary: single wall, glass-only many walls, mixed", () => {
    const single = groupDesignProblems([p("r1", "p1"), p("r1", "p1")]);
    assert.equal(roomSummary(single.rooms[0]), "1 wall · 2 panels without glass");
    const one = groupDesignProblems([p("r1", "p1")]);
    assert.equal(roomSummary(one.rooms[0]), "1 wall · 1 panel without glass");
    const oneMixed = groupDesignProblems([p("r1", "p1"), p("r1", "p1", { reason: "DOOR_CELL" })]);
    assert.equal(roomSummary(oneMixed.rooms[0]), "1 wall · 2 problems");
    const oneDoor = groupDesignProblems([p("r1", "p1", { reason: "DOOR_CELL" })]);
    assert.equal(roomSummary(oneDoor.rooms[0]), "1 wall · 1 door without a component");
    const glassOnly = groupDesignProblems([p("r1", "p1"), p("r1", "p2"), p("r1", "p2")]);
    assert.equal(roomSummary(glassOnly.rooms[0]), "2 walls · 3 panels without glass");
    const mixed = groupDesignProblems([p("r1", "p1"), p("r1", "p2", { reason: "NOT_STARTED" })]);
    assert.equal(roomSummary(mixed.rooms[0]), "2 walls · 2 problems");
  });

  test("no summary string contains a UUID when only labels are given", () => {
    const g = groupDesignProblems([p("123e4567-e89b-12d3-a456-426614174000", "223e4567-e89b-12d3-a456-426614174000", {}, { room: "Meeting", wall: "Top" })]);
    assert.doesNotMatch(roomSummary(g.rooms[0]) + wallSummary(g.rooms[0].walls[0]) + g.rooms[0].name + g.rooms[0].walls[0].label, UUID);
  });
});
