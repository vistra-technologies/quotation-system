/**
 * Unit tests for lib/panel-freeze.ts (Stage 34 S34-3, Batch 4): the one freeze table the Design reducer
 * consults. Pure functions only. Run via `npm run test:unit`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { freezeCheck, type FreezePanel } from "../../lib/panel-freeze";

const P = (id: string, locked = false, selectionId: string | null = null): FreezePanel => ({
  id,
  selectionId,
  ...(locked ? { locked } : {}),
});
const wall = [P("a", true, "g1"), P("b"), P("c", true, "g2"), P("d", false, "g1")];

describe("freezeCheck: single-panel actions block on a locked panel", () => {
  for (const type of ["TOGGLE_DOOR", "SET_DOOR_HEIGHT", "SET_DOOR_HINGE", "SPLIT_PANEL"]) {
    test(type, () => {
      assert.deepEqual(freezeCheck(wall, { type, panelId: "a" }), { kind: "block", lockedIds: ["a"] });
      assert.deepEqual(freezeCheck(wall, { type, panelId: "b" }), { kind: "pass" });
      assert.deepEqual(freezeCheck(wall, { type, panelId: "missing" }), { kind: "pass" });
    });
  }
});

describe("freezeCheck: unite", () => {
  test("blocks whole when any panel in the range is locked (also as a neighbour)", () => {
    assert.deepEqual(freezeCheck(wall, { type: "UNITE_PANELS", panelIds: ["a", "b"] }), {
      kind: "block",
      lockedIds: ["a"],
    });
    assert.deepEqual(freezeCheck(wall, { type: "UNITE_PANELS", panelIds: ["b", "c"] }), {
      kind: "block",
      lockedIds: ["c"],
    });
    assert.deepEqual(freezeCheck(wall, { type: "UNITE_PANELS", panelIds: ["a", "b", "c"] }), {
      kind: "block",
      lockedIds: ["a", "c"],
    });
  });
  test("passes when none is locked", () => {
    assert.deepEqual(freezeCheck(wall, { type: "UNITE_PANELS", panelIds: ["b", "d"] }), { kind: "pass" });
  });
});

describe("freezeCheck: bulk actions skip locked panels", () => {
  for (const type of ["REMOVE_PANELS", "SET_PANEL_WIDTH"]) {
    test(`${type} narrows to the unlocked ids and counts the skipped`, () => {
      assert.deepEqual(freezeCheck(wall, { type, panelIds: ["a", "b", "c"] }), {
        kind: "narrow",
        panelIds: ["b"],
        skipped: ["a", "c"],
        total: 3,
        note: "SKIPPED",
        keptCount: 2,
      });
    });
    test(`${type} passes with no locked id`, () => {
      assert.deepEqual(freezeCheck(wall, { type, panelIds: ["b", "d"] }), { kind: "pass" });
    });
    test(`${type} degrades to block when every id is locked`, () => {
      assert.deepEqual(freezeCheck(wall, { type, panelIds: ["a", "c"] }), { kind: "block", lockedIds: ["a", "c"] });
    });
  }
});

describe("freezeCheck: glass change applies to unlocked panels only", () => {
  test("locked panels keep their glass; the count is the ones whose glass differs", () => {
    const v = freezeCheck(wall, { type: "SET_GLASS", panelIds: ["a", "b", "c", "d"], selectionId: "g1" });
    assert.deepEqual(v, {
      kind: "narrow",
      panelIds: ["b", "d"],
      skipped: ["a", "c"],
      total: 4,
      note: "GLASS_KEPT",
      keptCount: 1, // a already has g1, only c keeps a different glass
    });
  });
  test("all locked: nothing editable, still narrow (keeps their glass note, no mutation)", () => {
    const v = freezeCheck([P("a", true, "g1"), P("b", true, "g1")], {
      type: "SET_GLASS",
      panelIds: ["a", "b"],
      selectionId: "g2",
    });
    assert.deepEqual(v, {
      kind: "narrow",
      panelIds: [],
      skipped: ["a", "b"],
      total: 2,
      note: "GLASS_KEPT",
      keptCount: 2,
    });
  });
  test("a locked full-height door has no glass cell: it is not counted as kept; a door with a transom is", () => {
    const panels: FreezePanel[] = [
      { id: "door", locked: true, selectionId: null, hasGlass: false },
      { id: "transom", locked: true, selectionId: "g1", hasGlass: true },
      { id: "free" },
    ];
    const v = freezeCheck(panels, { type: "SET_GLASS", panelIds: ["door", "transom", "free"], selectionId: "g2" });
    assert.equal(v.kind === "narrow" && v.keptCount, 1);
    const onlyDoor = freezeCheck(panels, { type: "SET_GLASS", panelIds: ["door", "free"], selectionId: "g2" });
    assert.equal(onlyDoor.kind === "narrow" && onlyDoor.keptCount, 0);
  });
  test("no locked panel: pass", () => {
    assert.deepEqual(freezeCheck(wall, { type: "SET_GLASS", panelIds: ["b", "d"], selectionId: "g9" }), {
      kind: "pass",
    });
  });
});

describe("freezeCheck: divider width map", () => {
  test("blocks when it sets a locked panel; passes otherwise", () => {
    assert.deepEqual(freezeCheck(wall, { type: "SET_PANEL_WIDTHS_MAP", widths: { a: 100, b: 200 } }), {
      kind: "block",
      lockedIds: ["a"],
    });
    assert.deepEqual(freezeCheck(wall, { type: "SET_PANEL_WIDTHS_MAP", widths: { b: 100, d: 200 } }), { kind: "pass" });
  });
});

describe("freezeCheck: not frozen (explicit pins)", () => {
  const allLocked = [P("a", true), P("b", true)];
  for (const type of [
    "SET_PARTITION_HEIGHT", // D-5: the wall-height clamp on a locked door is the one allowed path
    "FILL_DEFAULT_GLASS",
    "SET_PARTITION_WIDTH",
    "ADD_PANEL",
    "MAKE_EQUAL_WIDTH",
    "SET_PANEL_LOCKED",
    "UNLOCK_ALL",
    "SET_STOPS",
    "SOMETHING_ELSE",
  ]) {
    test(`${type} passes even when every panel is locked`, () => {
      assert.deepEqual(freezeCheck(allLocked, { type, panelId: "a", panelIds: ["a", "b"] }), { kind: "pass" });
    });
  }
  test("inputs are not mutated", () => {
    const before = JSON.stringify(wall);
    const act = { type: "REMOVE_PANELS", panelIds: ["a", "b"] };
    const actBefore = JSON.stringify(act);
    freezeCheck(wall, act);
    assert.equal(JSON.stringify(wall), before);
    assert.equal(JSON.stringify(act), actBefore);
  });
});
