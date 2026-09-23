/**
 * Unit tests for buildMaterials (Stage 24 Batch 4).
 *
 * Pure — no DB. Covers all cases from plan-b4.md's unit-test list:
 *  - door.md worked example (3-column table, width=2000, height=3000)
 *  - partition.md Scenario 1 (all 3 adjacency columns, widthMm=4000, heightMm=3000, no door)
 *  - Full-height vs transom door (doorWidthMmFullHeight behaviour)
 *  - doorConnector corner-door exclusion
 *  - Partition with no GLASS cell
 *  - MISSING_PARAM lazy semantics (tests 12–14)
 *  - Problem deduplication and exhaustiveness (tests 15–16)
 *  - Determinism (test 17)
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildMaterials } from "../../lib/materials/index";
import type { MaterialsInput } from "../../lib/materials/index";
import type { FormulaSetBody } from "../../lib/summary/types";
import type { ConfigSnapshot } from "../../lib/config-snapshot";
import type { RoomSide } from "../../lib/data/rooms";

// ─── Formula-set bodies (from door.md and partition.md) ───────────────────────

const DOOR_FORMULA_SET: FormulaSetBody = {
  schemaVersion: 2,
  slots: {
    DOOR: {
      role: "door",
      requiredParams: [
        { key: "hasFrame" }, { key: "hasLeaf" },
        { key: "frameCode" }, { key: "leafCode" },
        { key: "cornerConnBigCode" },
        { key: "cornerConnSmallFrameCode" }, { key: "cornerConnSmallLeafCode" },
        { key: "lAngleCode" }, { key: "hingeCode" },
        { key: "rubber25mmCode" },
        { key: "frameBumperGasketCode" }, { key: "frameBackGasketCode" },
        { key: "leafGlassGasket1Code" }, { key: "leafGlassGasket2Code" },
      ],
    },
  },
  formulas: [
    {
      id: "doorFrame", slot: "DOOR", grain: "CELL",
      condition: "param.hasFrame == 'Yes'",
      materialCode: "{param.frameCode}", unit: "metres",
      quantity: "(cell.widthMm + 2*cell.heightMm) / 1000",
    },
    {
      id: "doorLeaf", slot: "DOOR", grain: "CELL",
      condition: "param.hasLeaf == 'Yes'",
      materialCode: "{param.leafCode}", unit: "metres",
      quantity: "(2*(cell.widthMm + cell.heightMm)) / 1000",
    },
    {
      id: "cornerConnBig", slot: "DOOR", grain: "CELL",
      condition: "param.hasLeaf == 'Yes'",
      materialCode: "{param.cornerConnBigCode}", unit: "pieces",
      quantity: "3",
    },
    {
      id: "cornerConnSmallFrame", slot: "DOOR", grain: "CELL",
      condition: "param.hasFrame == 'Yes'",
      materialCode: "{param.cornerConnSmallFrameCode}", unit: "pieces",
      quantity: "2",
    },
    {
      id: "cornerConnSmallLeaf", slot: "DOOR", grain: "CELL",
      condition: "param.hasLeaf == 'Yes'",
      materialCode: "{param.cornerConnSmallLeafCode}", unit: "pieces",
      quantity: "1",
    },
    {
      id: "lAngle", slot: "DOOR", grain: "CELL",
      condition: "param.hasFrame == 'Yes'",
      materialCode: "{param.lAngleCode}", unit: "pieces",
      quantity: "4",
    },
    {
      id: "hinges", slot: "DOOR", grain: "CELL",
      condition: "param.hasFrame == 'Yes'",
      materialCode: "{param.hingeCode}", unit: "pieces",
      quantity: "4",
    },
    {
      id: "rubber25mm", slot: "DOOR", grain: "CELL",
      // NOTE: expr-eval uses `or` for logical OR; `||` is string concatenation in this library.
      // door.md writes `||` but the correct expr-eval operator is `or`.
      // Batch 3 seed data must use `or` here (DONE_WITH_CONCERNS flag in Batch 4 worklog).
      condition: "param.hasFrame == 'Yes' or param.hasLeaf == 'Yes'",
      materialCode: "{param.rubber25mmCode}", unit: "metres",
      quantity: "(param.hasFrame == 'Yes' ? calc.doorFrame : 0) + (param.hasLeaf == 'Yes' ? calc.doorLeaf : 0)",
    },
    {
      id: "frameBumperGasket", slot: "DOOR", grain: "CELL",
      condition: "param.hasFrame == 'Yes'",
      materialCode: "{param.frameBumperGasketCode}", unit: "metres",
      quantity: "calc.doorFrame",
    },
    {
      id: "frameBackGasket", slot: "DOOR", grain: "CELL",
      condition: "param.hasFrame == 'Yes'",
      materialCode: "{param.frameBackGasketCode}", unit: "metres",
      quantity: "(cell.heightMm * 4) / 1000",
    },
    {
      id: "leafGlassGasket1", slot: "DOOR", grain: "CELL",
      condition: "param.hasLeaf == 'Yes'",
      materialCode: "{param.leafGlassGasket1Code}", unit: "metres",
      quantity: "calc.doorLeaf",
    },
    {
      id: "leafGlassGasket2", slot: "DOOR", grain: "CELL",
      condition: "param.hasLeaf == 'Yes'",
      materialCode: "{param.leafGlassGasket2Code}", unit: "metres",
      quantity: "calc.doorLeaf",
    },
  ],
};

const GLASS_FORMULA_SET: FormulaSetBody = {
  schemaVersion: 2,
  slots: {
    GLASS: {
      role: "glass",
      requiredParams: [
        { key: "u_profile" }, { key: "i_profile" }, { key: "l_profile" },
        { key: "acousticGasketCode" }, { key: "whiteSealCode" }, { key: "woodWedgeCode" },
        { key: "lConnectorCode" }, { key: "degreeConnectorCode" }, { key: "doorConnectorCode" },
        { key: "straightConnectorCode" },
      ],
    },
  },
  formulas: [
    {
      id: "profileU", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.u_profile}", unit: "metres",
      quantity: "(partition.widthMm - partition.doorWidthMmFullHeight) / 1000",
    },
    {
      id: "profileL", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.l_profile}", unit: "metres",
      quantity: "(partition.widthMm + partition.heightMm*(partition.leftWallLike + partition.rightWallLike) - partition.doorWidthMmFullHeight) / 1000",
    },
    {
      id: "profileI", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.i_profile}", unit: "metres",
      quantity: "(partition.widthMm + partition.heightMm*(partition.leftWallLike + partition.rightWallLike) - partition.doorWidthMmFullHeight) / 1000",
    },
    {
      id: "acousticGasket", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.acousticGasketCode}", unit: "metres",
      quantity: "2*calc.profileU + calc.profileL + calc.profileI",
    },
    {
      id: "whiteSeal", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.whiteSealCode}", unit: "metres",
      quantity: "calc.profileU + calc.profileL",
    },
    {
      id: "woodWedge", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.woodWedgeCode}", unit: "metres",
      quantity: "(partition.widthMm / 1000) * 2",
    },
    {
      id: "lConnector", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.lConnectorCode}", unit: "pieces",
      quantity: "2*partition.leftWallLike + 2*partition.rightWallLike",
    },
    {
      id: "degreeConnector", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.degreeConnectorCode}", unit: "pieces",
      quantity: "partition.leftDegree + partition.rightDegree",
    },
    {
      id: "doorConnector", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.doorConnectorCode}", unit: "pieces",
      quantity: "4 * partition.nonCornerDoorCount",
    },
    {
      id: "straightConnector", slot: "GLASS", grain: "PARTITION",
      materialCode: "{param.straightConnectorCode}", unit: "pieces",
      quantity: "2*(ceil(partition.heightMm/3000) - 1) + 2*(ceil(partition.widthMm/3000) - 1)",
    },
  ],
};

// ─── Snapshot and side helpers ────────────────────────────────────────────────

function makeSnapshot(types: Array<{ id: string; code: string }>): ConfigSnapshot {
  return {
    takenAt: "2026-09-23T00:00:00.000Z",
    componentTypes: types.map(t => ({
      id: t.id,
      code: t.code,
      name: t.code,
      active: true,
      fieldsSchema: [],
      fieldOptionsConfig: {},
    })),
  };
}

const DOOR_SNAPSHOT = makeSnapshot([{ id: "ct-door", code: "DOOR" }]);
const GLASS_SNAPSHOT = makeSnapshot([{ id: "ct-glass", code: "GLASS" }]);

function plainSide(id: string): RoomSide {
  return { id, kind: "PLAIN", partitionId: null, turnDegrees: 0, lengthMm: null, label: null };
}

function partitionSide(id: string, partitionId: string): RoomSide {
  return { id, kind: "PARTITION", partitionId, turnDegrees: 0, lengthMm: null, label: null };
}

// ─── Full door config (all fields populated) ──────────────────────────────────

function doorConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hasFrame: "Yes", hasLeaf: "Yes",
    frameCode: "FRAME-001", leafCode: "LEAF-001",
    cornerConnBigCode: "CCB-001",
    cornerConnSmallFrameCode: "CCSF-001", cornerConnSmallLeafCode: "CCSL-001",
    lAngleCode: "LA-001", hingeCode: "HINGE-001",
    rubber25mmCode: "RUBBER-001",
    frameBumperGasketCode: "FBG-001", frameBackGasketCode: "FBKG-001",
    leafGlassGasket1Code: "LGG1-001", leafGlassGasket2Code: "LGG2-001",
    ...overrides,
  };
}

/** Full glass config for GLASS slot — Scenario 1 param values */
function glassConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    u_profile: "U-LUF-01", i_profile: "I-LUF-01", l_profile: "L-LUF-01",
    acousticGasketCode: "AGASK-001", whiteSealCode: "WSEAL-001", woodWedgeCode: "WWEDGE-001",
    lConnectorCode: "LCON-001", degreeConnectorCode: "DEGCON-001", doorConnectorCode: "DCON-001",
    straightConnectorCode: "STRCON-001",
    ...overrides,
  };
}

// ─── Simple input builders ────────────────────────────────────────────────────

/** Single-partition room input for DOOR CELL-grain tests. */
function makeDoorInput(
  config: Record<string, unknown>,
  design: unknown = {
    schemaVersion: 2,
    sections: [{ widthMm: 2000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] }],
  },
): MaterialsInput {
  return {
    formulaSetBody: DOOR_FORMULA_SET,
    snapshot: DOOR_SNAPSHOT,
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{
        id: "r1", label: "Room 1",
        isClosed: true,
        sides: [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")],
        partitions: [{
          id: "p1", label: "Wall 1",
          widthMm: 2000, heightMm: 3000,
          design,
        }],
      }],
    }],
    selections: [{ id: "sel-door", componentTypeId: "ct-door", config }],
  };
}

/** Single-partition room input for GLASS PARTITION-grain tests with specified adjacency. */
function makeGlassInput(
  sides: RoomSide[],
  partitions: Array<{ id: string; label: string; widthMm: number; heightMm: number; design: unknown }>,
  selections: MaterialsInput["selections"],
): MaterialsInput {
  return {
    formulaSetBody: GLASS_FORMULA_SET,
    snapshot: GLASS_SNAPSHOT,
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{
        id: "r1", label: "Room 1",
        isClosed: true,
        sides,
        partitions,
      }],
    }],
    selections,
  };
}

/** Build a 4-section all-GLASS design (4000mm wide, 3000mm tall). */
function glassDesign4Panel(): unknown {
  return {
    schemaVersion: 2,
    sections: [
      { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
    ],
  };
}

/** Extract requirement from rawLines by formulaId. Returns undefined if not found. */
function req(lines: { formulaId: string; requirement: number; unit: string }[], formulaId: string) {
  return lines.find(l => l.formulaId === formulaId)?.requirement;
}

// ─── Door worked example (door.md 3-column table, width=2000, height=3000) ───

describe("door.md worked example — frame + leaf", () => {
  const input = makeDoorInput(doorConfig());
  const result = buildMaterials(input);
  const lines = result.rawLines;

  test("doorFrame = 8m", () => assert.equal(req(lines, "doorFrame"), 8));
  test("doorLeaf = 10m", () => assert.equal(req(lines, "doorLeaf"), 10));
  test("cornerConnBig = 3 pcs", () => assert.equal(req(lines, "cornerConnBig"), 3));
  test("cornerConnSmallFrame = 2 pcs", () => assert.equal(req(lines, "cornerConnSmallFrame"), 2));
  test("cornerConnSmallLeaf = 1 pc", () => assert.equal(req(lines, "cornerConnSmallLeaf"), 1));
  test("lAngle = 4 pcs", () => assert.equal(req(lines, "lAngle"), 4));
  test("hinges = 4 pcs", () => assert.equal(req(lines, "hinges"), 4));
  test("rubber25mm = 18m (frame+leaf)", () => assert.equal(req(lines, "rubber25mm"), 18));
  test("frameBumperGasket = 8m", () => assert.equal(req(lines, "frameBumperGasket"), 8));
  test("frameBackGasket = 12m", () => assert.equal(req(lines, "frameBackGasket"), 12));
  test("leafGlassGasket1 = 10m", () => assert.equal(req(lines, "leafGlassGasket1"), 10));
  test("leafGlassGasket2 = 10m", () => assert.equal(req(lines, "leafGlassGasket2"), 10));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

describe("door.md worked example — frame only (hasLeaf=No)", () => {
  const input = makeDoorInput(doorConfig({ hasLeaf: "No" }));
  const result = buildMaterials(input);
  const lines = result.rawLines;

  test("doorFrame = 8m", () => assert.equal(req(lines, "doorFrame"), 8));
  test("doorLeaf not fired", () => assert.equal(req(lines, "doorLeaf"), undefined));
  test("cornerConnSmallFrame = 2 pcs", () => assert.equal(req(lines, "cornerConnSmallFrame"), 2));
  test("cornerConnBig not fired", () => assert.equal(req(lines, "cornerConnBig"), undefined));
  test("cornerConnSmallLeaf not fired", () => assert.equal(req(lines, "cornerConnSmallLeaf"), undefined));
  test("lAngle = 4 pcs", () => assert.equal(req(lines, "lAngle"), 4));
  test("hinges = 4 pcs", () => assert.equal(req(lines, "hinges"), 4));
  // rubber25mm conditional calc re-check (test 4): frame-only → 8m (reads calc.doorFrame=8, not NaN)
  test("rubber25mm = 8m (frame only)", () => assert.equal(req(lines, "rubber25mm"), 8));
  test("frameBumperGasket = 8m", () => assert.equal(req(lines, "frameBumperGasket"), 8));
  test("frameBackGasket = 12m", () => assert.equal(req(lines, "frameBackGasket"), 12));
  test("leafGlassGasket1 not fired", () => assert.equal(req(lines, "leafGlassGasket1"), undefined));
  test("leafGlassGasket2 not fired", () => assert.equal(req(lines, "leafGlassGasket2"), undefined));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

describe("door.md worked example — neither (hasFrame=No, hasLeaf=No)", () => {
  const input = makeDoorInput(doorConfig({ hasFrame: "No", hasLeaf: "No" }));
  const result = buildMaterials(input);

  test("no lines at all", () => assert.equal(result.rawLines.length, 0));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

// ─── partition.md Scenario 1 (widthMm=4000, heightMm=3000, no door, 3 adjacency columns) ───

describe("partition Scenario 1 — wall/wall (leftWallLike=1, rightWallLike=1)", () => {
  // Sides: PLAIN, p1, PLAIN — both ends wall
  const sides: RoomSide[] = [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")];
  const input = makeGlassInput(
    sides,
    [{ id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() }],
    [{ id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() }],
  );
  const result = buildMaterials(input);
  const lines = result.rawLines;

  test("profileU = 4m", () => assert.equal(req(lines, "profileU"), 4));
  test("profileL = 10m", () => assert.equal(req(lines, "profileL"), 10));
  test("profileI = 10m", () => assert.equal(req(lines, "profileI"), 10));
  test("acousticGasket = 28m", () => assert.equal(req(lines, "acousticGasket"), 28));
  test("whiteSeal = 14m", () => assert.equal(req(lines, "whiteSeal"), 14));
  test("woodWedge = 8m", () => assert.equal(req(lines, "woodWedge"), 8));
  test("lConnector = 4", () => assert.equal(req(lines, "lConnector"), 4));
  test("degreeConnector = 0", () => assert.equal(req(lines, "degreeConnector"), 0));
  test("doorConnector = 0", () => assert.equal(req(lines, "doorConnector"), 0));
  test("straightConnector = 2", () => assert.equal(req(lines, "straightConnector"), 2));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

describe("partition Scenario 1 — wall/partition (leftWallLike=1, rightWallLike=0, rightDegree=1)", () => {
  // Room: PLAIN, p1, p2. p1's right neighbor is p2 (glass); p2's left neighbor is p1 (glass).
  // p1: leftWallLike=1, rightWallLike=0, rightDegree=1
  const sides: RoomSide[] = [
    plainSide("s0"),
    partitionSide("s1", "p1"),
    partitionSide("s2", "p2"),
  ];
  // Both partitions have the same all-glass design
  const input = makeGlassInput(
    sides,
    [
      { id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() },
      { id: "p2", label: "Wall 2", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() },
    ],
    [{ id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() }],
  );
  const result = buildMaterials(input);
  // Filter to p1's lines only
  const p1Lines = result.rawLines.filter(l => l.partitionId === "p1");

  test("p1: profileU = 4m", () => assert.equal(req(p1Lines, "profileU"), 4));
  test("p1: profileL = 7m", () => assert.equal(req(p1Lines, "profileL"), 7));
  test("p1: profileI = 7m", () => assert.equal(req(p1Lines, "profileI"), 7));
  test("p1: acousticGasket = 22m", () => assert.equal(req(p1Lines, "acousticGasket"), 22));
  test("p1: whiteSeal = 11m", () => assert.equal(req(p1Lines, "whiteSeal"), 11));
  test("p1: lConnector = 2", () => assert.equal(req(p1Lines, "lConnector"), 2));
  test("p1: degreeConnector = 1", () => assert.equal(req(p1Lines, "degreeConnector"), 1));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

describe("partition Scenario 1 — partition/partition (leftDegree=1, rightDegree=1)", () => {
  // Room: p1, p2, p3 (closed). p2 has both neighbors as partitions with glass ends.
  const sides: RoomSide[] = [
    partitionSide("s0", "p1"),
    partitionSide("s1", "p2"),
    partitionSide("s2", "p3"),
  ];
  const input = makeGlassInput(
    sides,
    [
      { id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() },
      { id: "p2", label: "Wall 2", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() },
      { id: "p3", label: "Wall 3", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() },
    ],
    [{ id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() }],
  );
  const result = buildMaterials(input);
  const p2Lines = result.rawLines.filter(l => l.partitionId === "p2");

  test("p2: profileU = 4m", () => assert.equal(req(p2Lines, "profileU"), 4));
  test("p2: profileL = 4m", () => assert.equal(req(p2Lines, "profileL"), 4));
  test("p2: profileI = 4m", () => assert.equal(req(p2Lines, "profileI"), 4));
  test("p2: acousticGasket = 16m", () => assert.equal(req(p2Lines, "acousticGasket"), 16));
  test("p2: whiteSeal = 8m", () => assert.equal(req(p2Lines, "whiteSeal"), 8));
  test("p2: lConnector = 0", () => assert.equal(req(p2Lines, "lConnector"), 0));
  test("p2: degreeConnector = 2", () => assert.equal(req(p2Lines, "degreeConnector"), 2));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

// ─── Full-height vs transom door (test 8 and 9) ───────────────────────────────

describe("profileU: full-height door reduces doorWidthMmFullHeight", () => {
  // Partition: 4m wide, 3m tall. One section has a full-height door (900mm wide).
  // profileU = (4000 - 900) / 1000 = 3.1m
  const sides: RoomSide[] = [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")];
  const design: unknown = {
    schemaVersion: 2,
    sections: [
      { widthMm: 900, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
      { widthMm: 1100, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
    ],
  };
  const input: MaterialsInput = {
    formulaSetBody: GLASS_FORMULA_SET,
    snapshot: makeSnapshot([{ id: "ct-glass", code: "GLASS" }, { id: "ct-door", code: "DOOR" }]),
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{ id: "r1", label: "Room 1", isClosed: true, sides, partitions: [{ id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design }] }],
    }],
    selections: [
      { id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() },
      { id: "sel-door", componentTypeId: "ct-door", config: doorConfig() },
    ],
  };
  const result = buildMaterials(input);
  const p1Lines = result.rawLines.filter(l => l.partitionId === "p1");

  test("profileU = 3.1m (full-height door reduces it)", () => assert.equal(req(p1Lines, "profileU"), 3.1));
});

describe("profileU: transom door does NOT reduce doorWidthMmFullHeight", () => {
  // Partition: 4m wide, 3m tall. One section has a transom door (900mm wide, 2000mm tall).
  // The section has a glass transom above (1000mm) and the door below (2000mm).
  // doorWidthMmFullHeight = 0 (door cell heightMm=2000 ≠ partition heightMm=3000)
  // profileU = (4000 - 0) / 1000 = 4m
  const sides: RoomSide[] = [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")];
  const design: unknown = {
    schemaVersion: 2,
    sections: [
      {
        widthMm: 900,
        cells: [
          { heightMm: 1000, selectionId: "sel-glass" }, // transom above
          { heightMm: 2000, selectionId: "sel-door" },  // door below
        ],
      },
      { widthMm: 1033, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1033, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1034, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
    ],
  };
  const input: MaterialsInput = {
    formulaSetBody: GLASS_FORMULA_SET,
    snapshot: makeSnapshot([{ id: "ct-glass", code: "GLASS" }, { id: "ct-door", code: "DOOR" }]),
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{ id: "r1", label: "Room 1", isClosed: true, sides, partitions: [{ id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design }] }],
    }],
    selections: [
      { id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() },
      { id: "sel-door", componentTypeId: "ct-door", config: doorConfig() },
    ],
  };
  const result = buildMaterials(input);
  const p1Lines = result.rawLines.filter(l => l.partitionId === "p1");

  test("profileU = 4m (transom door unchanged)", () => assert.equal(req(p1Lines, "profileU"), 4));
});

// ─── doorConnector corner-door exclusion (test 10) ───────────────────────────

describe("doorConnector excludes corner door (test 10)", () => {
  // Partition with left end = DOOR (corner door). No other doors.
  // nonCornerDoorCount = doorCount - leftEndIsDoor - rightEndIsDoor = 1 - 1 - 0 = 0
  // doorConnector = 4 * 0 = 0
  const sides: RoomSide[] = [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")];
  const design: unknown = {
    schemaVersion: 2,
    sections: [
      { widthMm: 900, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },   // corner door on left
      { widthMm: 1033, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1033, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
      { widthMm: 1034, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
    ],
  };
  const input: MaterialsInput = {
    formulaSetBody: GLASS_FORMULA_SET,
    snapshot: makeSnapshot([{ id: "ct-glass", code: "GLASS" }, { id: "ct-door", code: "DOOR" }]),
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{ id: "r1", label: "Room 1", isClosed: true, sides, partitions: [{ id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design }] }],
    }],
    selections: [
      { id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() },
      { id: "sel-door", componentTypeId: "ct-door", config: doorConfig() },
    ],
  };
  const result = buildMaterials(input);
  const p1Lines = result.rawLines.filter(l => l.partitionId === "p1");

  test("doorConnector = 0 (corner door excluded)", () => assert.equal(req(p1Lines, "doorConnector"), 0));
});

// ─── Partition with no GLASS cell (test 11) ───────────────────────────────────

describe("partition with no GLASS cell fires no PARTITION-grain GLASS formula", () => {
  // A partition with only DOOR cells — GLASS PARTITION-grain formulas should not fire
  const sides: RoomSide[] = [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")];
  const design: unknown = {
    schemaVersion: 2,
    sections: [{ widthMm: 2000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] }],
  };
  const input: MaterialsInput = {
    formulaSetBody: GLASS_FORMULA_SET,
    snapshot: makeSnapshot([{ id: "ct-door", code: "DOOR" }]),
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{ id: "r1", label: "Room 1", isClosed: true, sides, partitions: [{ id: "p1", label: "Wall 1", widthMm: 2000, heightMm: 3000, design }] }],
    }],
    selections: [{ id: "sel-door", componentTypeId: "ct-door", config: doorConfig() }],
  };
  const result = buildMaterials(input);

  test("no GLASS PARTITION-grain lines emitted", () => assert.equal(result.rawLines.length, 0));
  test("no problems", () => assert.equal(result.collector.hasAny(), false));
});

// ─── MISSING_PARAM tests (decision 10b) ──────────────────────────────────────

describe("MISSING_PARAM — test 12: blank materialCode param → MISSING_PARAM, no line", () => {
  // frameCode is blank → MISSING_PARAM for "frameCode" recorded; doorFrame line not emitted
  const input = makeDoorInput(doorConfig({ frameCode: "" }));
  const result = buildMaterials(input);

  test("doorFrame line is not emitted (blank frameCode)", () => {
    assert.equal(result.rawLines.find(l => l.formulaId === "doorFrame"), undefined);
  });
  test("MISSING_PARAM problem recorded for frameCode", () => {
    const report = result.collector.report();
    const mp = report.problems.find(p => p.kind === "MISSING_PARAM" && p.locus?.fieldKey === "frameCode");
    assert.ok(mp, "expected a MISSING_PARAM problem for frameCode");
  });
});

describe("MISSING_PARAM — test 13: hasFrame='No', blank frameCode → zero problems", () => {
  // hasFrame='No' → doorFrame condition false → frameCode never dereferenced → no problems
  const input = makeDoorInput(doorConfig({ hasFrame: "No", hasLeaf: "No", frameCode: "" }));
  const result = buildMaterials(input);

  test("no lines", () => assert.equal(result.rawLines.length, 0));
  test("zero MISSING_PARAM problems", () => {
    const report = result.collector.report();
    const mp = report.problems.filter(p => p.kind === "MISSING_PARAM");
    assert.equal(mp.length, 0);
  });
});

describe("MISSING_PARAM — test 14: blank hasFrame → MISSING_PARAM naming 'hasFrame'", () => {
  // hasFrame is blank → condition reads it (proxy returns "", records MISSING_PARAM for hasFrame)
  // condition `"" == 'Yes'` = false → formula skipped
  const input = makeDoorInput(doorConfig({ hasFrame: "" }));
  const result = buildMaterials(input);

  test("MISSING_PARAM recorded for hasFrame", () => {
    const report = result.collector.report();
    const mp = report.problems.find(p => p.kind === "MISSING_PARAM" && p.locus?.fieldKey === "hasFrame");
    assert.ok(mp, "expected a MISSING_PARAM problem naming hasFrame");
  });
});

// ─── Deduplication and exhaustiveness (tests 15–16) ──────────────────────────

describe("MISSING_PARAM deduplication — test 15: three cells same blank field → occurrenceCount=3", () => {
  // Three cells all pointing to the same DOOR selection with blank hasFrame.
  // All three deduplicate to the same problem → occurrenceCount=3.
  const input: MaterialsInput = {
    formulaSetBody: DOOR_FORMULA_SET,
    snapshot: DOOR_SNAPSHOT,
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{
        id: "r1", label: "Room 1",
        isClosed: true,
        sides: [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")],
        partitions: [{
          id: "p1", label: "Wall 1",
          widthMm: 6000, heightMm: 3000,
          design: {
            schemaVersion: 2,
            sections: [
              { widthMm: 2000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
              { widthMm: 2000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
              { widthMm: 2000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
            ],
          },
        }],
      }],
    }],
    selections: [{ id: "sel-door", componentTypeId: "ct-door", config: doorConfig({ hasFrame: "" }) }],
  };
  const result = buildMaterials(input);
  const report = result.collector.report();
  const mp = report.problems.filter(p => p.kind === "MISSING_PARAM" && p.locus?.fieldKey === "hasFrame");

  test("exactly one deduplicated MISSING_PARAM problem for hasFrame", () => {
    assert.equal(mp.length, 1);
  });
  test("occurrenceCount = 3 (three cells, same selection, same blank field)", () => {
    assert.equal(mp[0]?.occurrenceCount, 3);
  });
});

describe("problem exhaustiveness — test 16: two blank fields + non-finite quantity → all three problems", () => {
  // Two blank fields (hasFrame, hasLeaf) + a formula with non-finite quantity (inject via a fake formula set)
  // Use a formula set where one formula divides by zero (quantity = "0/0") — unconditional
  const nonFiniteFormulaSet: FormulaSetBody = {
    schemaVersion: 2,
    slots: {
      DOOR: {
        role: "door",
        requiredParams: [{ key: "hasFrame" }, { key: "hasLeaf" }, { key: "frameCode" }],
      },
    },
    formulas: [
      // Formula 1: blank param read in materialCode (hasFrame is blank)
      {
        id: "f1", slot: "DOOR", grain: "CELL",
        materialCode: "{param.hasFrame}", unit: "metres",
        quantity: "1",
      },
      // Formula 2: blank param read in materialCode (hasLeaf is blank)
      {
        id: "f2", slot: "DOOR", grain: "CELL",
        materialCode: "{param.hasLeaf}", unit: "metres",
        quantity: "1",
      },
      // Formula 3: non-finite quantity
      {
        id: "f3", slot: "DOOR", grain: "CELL",
        materialCode: "{param.frameCode}", unit: "metres",
        quantity: "0/0",
      },
    ],
  };
  const input = makeDoorInput({ hasFrame: "", hasLeaf: "", frameCode: "FRAME-001" }, {
    schemaVersion: 2,
    sections: [{ widthMm: 2000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] }],
  });
  const inputPatched: MaterialsInput = { ...input, formulaSetBody: nonFiniteFormulaSet };
  const result = buildMaterials(inputPatched);
  const report = result.collector.report();

  test("MISSING_PARAM for hasFrame recorded", () => {
    assert.ok(report.problems.find(p => p.kind === "MISSING_PARAM" && p.locus?.fieldKey === "hasFrame"));
  });
  test("MISSING_PARAM for hasLeaf recorded", () => {
    assert.ok(report.problems.find(p => p.kind === "MISSING_PARAM" && p.locus?.fieldKey === "hasLeaf"));
  });
  test("NON_FINITE_QUANTITY recorded", () => {
    assert.ok(report.problems.find(p => p.kind === "NON_FINITE_QUANTITY"));
  });
  test("all three problems collected (not short-circuited)", () => {
    assert.equal(report.problems.length, 3);
  });
});

// ─── Determinism (test 17) ────────────────────────────────────────────────────

describe("determinism", () => {
  test("same input twice → identical rawLines order and collector.report()", () => {
    const input = makeDoorInput(doorConfig());
    const r1 = buildMaterials(input);
    const r2 = buildMaterials(input);

    assert.deepEqual(
      r1.rawLines.map(l => `${l.formulaId}:${l.code}:${l.requirement}:${l.unit}`),
      r2.rawLines.map(l => `${l.formulaId}:${l.code}:${l.requirement}:${l.unit}`),
    );
    assert.deepEqual(r1.collector.report(), r2.collector.report());
  });
});

// ─── Bug-fix tests (review-b4-1 findings) ────────────────────────────────────

describe("IMPORTANT #2 — condition that throws records a FORMULA_SET problem, not a silent skip", () => {
  // A typo'd namespace ("parm" instead of "param") causes expr-eval to throw.
  // Before the fix: caught → null → isConditionTrue(null)=false → formula silently skipped.
  // After the fix: caught → onThrow callback → NON_FINITE_QUANTITY recorded → formula skipped with problem.
  const throwingFormulaSet: FormulaSetBody = {
    schemaVersion: 2,
    slots: {
      DOOR: {
        role: "door",
        requiredParams: [{ key: "hasFrame" }, { key: "frameCode" }],
      },
    },
    formulas: [
      {
        id: "doorFrame",
        slot: "DOOR", grain: "CELL",
        // "parm" is not a valid scope variable — expr-eval will throw "undefined variable: parm"
        condition: "parm.hasFrame == 'Yes'",
        materialCode: "{param.frameCode}", unit: "metres",
        quantity: "1",
      },
    ],
  };
  const input = makeDoorInput(doorConfig());
  const inputPatched: MaterialsInput = { ...input, formulaSetBody: throwingFormulaSet };
  const result = buildMaterials(inputPatched);
  const report = result.collector.report();

  test("formula with throwing condition is skipped (no line emitted)", () => {
    assert.equal(result.rawLines.find(l => l.formulaId === "doorFrame"), undefined);
  });
  test("NON_FINITE_QUANTITY problem recorded naming the formula id", () => {
    const p = report.problems.find(p => p.kind === "NON_FINITE_QUANTITY" && p.locus?.formulaId === "doorFrame");
    assert.ok(p, `expected NON_FINITE_QUANTITY for doorFrame; got: ${JSON.stringify(report.problems)}`);
  });
  test("problem scope is FORMULA_SET", () => {
    const p = report.problems.find(p => p.kind === "NON_FINITE_QUANTITY" && p.locus?.formulaId === "doorFrame");
    assert.equal(p?.scope, "FORMULA_SET");
  });
});

describe("IMPORTANT #3 — arithmetic on missing calc.* yields NON_FINITE_QUANTITY, not a 0-quantity line", () => {
  // "calc.nonexistent" is undefined in the scope; expr-eval's "2*calc.nonexistent" returns null.
  // Before the fix: Number(null)=0 → finite → silent zero-quantity line emitted.
  // After the fix: null result → NaN → NON_FINITE_QUANTITY recorded.
  const missingCalcFormulaSet: FormulaSetBody = {
    schemaVersion: 2,
    slots: {
      DOOR: {
        role: "door",
        requiredParams: [{ key: "frameCode" }],
      },
    },
    formulas: [
      {
        id: "derived",
        slot: "DOOR", grain: "CELL",
        materialCode: "{param.frameCode}", unit: "metres",
        // "calc.nonexistent" is not a prior formula id → undefined in scope
        // expr-eval: 2 * undefined → null (not NaN); Number(null)=0 was the silent bug
        quantity: "2 * calc.nonexistent",
      },
    ],
  };
  const input = makeDoorInput(doorConfig());
  const inputPatched: MaterialsInput = { ...input, formulaSetBody: missingCalcFormulaSet };
  const result = buildMaterials(inputPatched);
  const report = result.collector.report();

  test("no line emitted for formula with missing calc.*", () => {
    assert.equal(result.rawLines.find(l => l.formulaId === "derived"), undefined);
  });
  test("NON_FINITE_QUANTITY problem recorded (not a 0-quantity line)", () => {
    const p = report.problems.find(p => p.kind === "NON_FINITE_QUANTITY" && p.locus?.formulaId === "derived");
    assert.ok(p, `expected NON_FINITE_QUANTITY for derived; got: ${JSON.stringify(report.problems)}`);
  });
});

// ─── PARTITION-grain onThrow (review-b4-2 MINOR) ────────────────────────────
// Covers the PARTITION pass's condition-throw wiring (review-b4-2 noted both
// prior throw tests were CELL-grain only).

describe("PARTITION-grain — condition that throws records a FORMULA_SET problem", () => {
  // A PARTITION-grain formula whose condition contains "parm" (typo; undefined variable in
  // expr-eval). Before the fix this would be a silent skip. After the fix it must produce a
  // NON_FINITE_QUANTITY problem with scope FORMULA_SET.
  const throwingPartitionFormulaSet: FormulaSetBody = {
    schemaVersion: 2,
    slots: {
      GLASS: {
        role: "glass",
        requiredParams: [{ key: "u_profile" }],
      },
    },
    formulas: [
      {
        id: "profileU",
        slot: "GLASS",
        grain: "PARTITION",
        // "parm" is not defined in the scope → expr-eval will throw "undefined variable: parm"
        condition: "parm.u_profile == 'Yes'",
        materialCode: "{param.u_profile}",
        unit: "metres",
        quantity: "partition.widthMm / 1000",
      },
    ],
  };

  const sides: RoomSide[] = [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")];
  const input: MaterialsInput = {
    formulaSetBody: throwingPartitionFormulaSet,
    snapshot: makeSnapshot([{ id: "ct-glass", code: "GLASS" }]),
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{
        id: "r1", label: "Room 1",
        isClosed: true,
        sides,
        partitions: [{ id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() }],
      }],
    }],
    selections: [{ id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() }],
  };
  const result = buildMaterials(input);
  const report = result.collector.report();

  test("PARTITION-grain formula with throwing condition is skipped (no line emitted)", () => {
    assert.equal(result.rawLines.find(l => l.formulaId === "profileU"), undefined);
  });
  test("PARTITION-grain: NON_FINITE_QUANTITY problem recorded naming the formula id", () => {
    const p = report.problems.find(p => p.kind === "NON_FINITE_QUANTITY" && p.locus?.formulaId === "profileU");
    assert.ok(p, `expected NON_FINITE_QUANTITY for PARTITION-grain profileU; got: ${JSON.stringify(report.problems)}`);
  });
  test("PARTITION-grain: problem scope is FORMULA_SET", () => {
    const p = report.problems.find(p => p.kind === "NON_FINITE_QUANTITY" && p.locus?.formulaId === "profileU");
    assert.equal(p?.scope, "FORMULA_SET");
  });
  test("PARTITION-grain: problem locus includes partitionId", () => {
    const p = report.problems.find(p => p.kind === "NON_FINITE_QUANTITY" && p.locus?.formulaId === "profileU");
    assert.equal(p?.locus?.partitionId, "p1");
  });
});

// ─── v1 fast-path ─────────────────────────────────────────────────────────────

describe("v1 fast-path", () => {
  test("v1 formula set returns empty rawLines and empty byRoom lines", () => {
    const v1Input: MaterialsInput = {
      formulaSetBody: { schemaVersion: 1, slots: { GLASS: { role: "glass" } } },
      snapshot: GLASS_SNAPSHOT,
      floors: [{
        id: "f1", label: "Floor 1",
        rooms: [{
          id: "r1", label: "Room 1",
          isClosed: true,
          sides: [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")],
          partitions: [{ id: "p1", label: "Wall 1", widthMm: 4000, heightMm: 3000, design: glassDesign4Panel() }],
        }],
      }],
      selections: [{ id: "sel-glass", componentTypeId: "ct-glass", config: glassConfig() }],
    };
    const result = buildMaterials(v1Input);
    assert.equal(result.rawLines.length, 0);
    // v1 fast-path returns byRoom: [] (not per-room empty entries) to match Stage 23's prior behavior
    // (formula-engine.md + stage-24.md step 6: "v1 must be byte-identical to Stage 23 which wrote []").
    assert.deepEqual(result.byRoom, []);
    assert.equal(result.collector.hasAny(), false);
  });
});
