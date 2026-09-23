/**
 * Unit tests for derivePartitionGeometry (Stage 24 Batch 4).
 *
 * Pure — no DB. Covers the 5-row corner-junction table (both left and right ends) and
 * all adjacency edge cases from plan-b4.md's unit-test list.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { derivePartitionGeometry } from "../../lib/materials/geometry";
import type {
  DerivePartitionGeometryArgs,
  ParsedDesign,
  PartitionGeometry,
} from "../../lib/materials/geometry";
import type { RoomSide } from "../../lib/data/rooms";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function plainSide(id: string): RoomSide {
  return { id, kind: "PLAIN", partitionId: null, turnDegrees: 0, lengthMm: null, label: null };
}

function partitionSide(id: string, partitionId: string): RoomSide {
  return { id, kind: "PARTITION", partitionId, turnDegrees: 0, lengthMm: null, label: null };
}

/** A design with one section, one GLASS cell (full-height by default). */
function glassDesign(widthMm: number, heightMm: number, selectionId = "sel-glass"): ParsedDesign {
  return { sections: [{ widthMm, cells: [{ heightMm, selectionId }] }] };
}

/** A design with one section, one DOOR cell (full-height by default). */
function doorDesign(widthMm: number, heightMm: number, selectionId = "sel-door"): ParsedDesign {
  return { sections: [{ widthMm, cells: [{ heightMm, selectionId }] }] };
}

/** Simple slot resolver: sel-glass → GLASS, sel-door → DOOR, anything else → null. */
const simpleSlotResolver = (selId: string): string | null => {
  if (selId === "sel-glass") return "GLASS";
  if (selId === "sel-door") return "DOOR";
  return null;
};

const noNeighborDesign: (partitionId: string) => ParsedDesign | null = () => null;

function derive(args: DerivePartitionGeometryArgs): PartitionGeometry {
  return derivePartitionGeometry(args);
}

// ─── Corner-junction table (all 5 rows, tested for both left and right ends) ─

describe("corner-junction table — left end", () => {
  // Row 1: Door | Wall → wallLike=0, degree=0
  test("Door | Wall → leftWallLike=0, leftDegree=0", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: doorDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.leftEndIsDoor, 1);
    assert.equal(g.leftIsPartition, 0);
    assert.equal(g.leftWallLike, 0);
    assert.equal(g.leftDegree, 0);
  });

  // Row 2: Door | Partition → wallLike=0, degree=0
  test("Door | Partition → leftWallLike=0, leftDegree=0", () => {
    const sides: RoomSide[] = [
      partitionSide("s0", "p0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const designs = new Map([
      ["p0", glassDesign(2000, 3000)],
      ["p1", doorDesign(2000, 3000)],
    ]);
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: doorDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    assert.equal(g.leftEndIsDoor, 1);
    assert.equal(g.leftIsPartition, 1);
    assert.equal(g.leftWallLike, 0);
    assert.equal(g.leftDegree, 0);
  });

  // Row 3: Glass | Wall → wallLike=1, degree=0
  test("Glass | Wall → leftWallLike=1, leftDegree=0", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.leftEndIsDoor, 0);
    assert.equal(g.leftIsPartition, 0);
    assert.equal(g.leftWallLike, 1);
    assert.equal(g.leftDegree, 0);
  });

  // Row 4: Glass | Partition, neighbor's end is glass → wallLike=0, degree=1
  test("Glass | Partition (neighbor glass end) → leftWallLike=0, leftDegree=1", () => {
    const sides: RoomSide[] = [
      partitionSide("s0", "p0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const designs = new Map([
      // p0's right end (sections[last].cells[last]) is GLASS
      ["p0", glassDesign(2000, 3000)],
    ]);
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    assert.equal(g.leftEndIsDoor, 0);
    assert.equal(g.leftIsPartition, 1);
    assert.equal(g.leftNeighborEndIsDoor, 0);
    assert.equal(g.leftWallLike, 0);
    assert.equal(g.leftDegree, 1);
  });

  // Row 5: Glass | Partition, neighbor's end is a door → wallLike=1, degree=0
  test("Glass | Partition (neighbor door end) → leftWallLike=1, leftDegree=0", () => {
    const sides: RoomSide[] = [
      partitionSide("s0", "p0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const designs = new Map([
      // p0's right end (sections[last].cells[last]) is DOOR
      ["p0", doorDesign(2000, 3000)],
    ]);
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    assert.equal(g.leftEndIsDoor, 0);
    assert.equal(g.leftIsPartition, 1);
    assert.equal(g.leftNeighborEndIsDoor, 1);
    assert.equal(g.leftWallLike, 1);
    assert.equal(g.leftDegree, 0);
  });
});

describe("corner-junction table — right end", () => {
  // Row 1: Door | Wall → wallLike=0, degree=0
  test("Door | Wall → rightWallLike=0, rightDegree=0", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: doorDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.rightEndIsDoor, 1);
    assert.equal(g.rightIsPartition, 0);
    assert.equal(g.rightWallLike, 0);
    assert.equal(g.rightDegree, 0);
  });

  // Row 2: Door | Partition → wallLike=0, degree=0
  test("Door | Partition → rightWallLike=0, rightDegree=0", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      partitionSide("s2", "p2"),
    ];
    const designs = new Map([
      ["p2", glassDesign(2000, 3000)],
    ]);
    // p1 has a door at its right end: last section last cell = DOOR
    const p1Design: ParsedDesign = {
      sections: [
        { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
        { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
      ],
    };
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: p1Design,
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    assert.equal(g.rightEndIsDoor, 1);
    assert.equal(g.rightIsPartition, 1);
    assert.equal(g.rightWallLike, 0);
    assert.equal(g.rightDegree, 0);
  });

  // Row 3: Glass | Wall → wallLike=1, degree=0
  test("Glass | Wall → rightWallLike=1, rightDegree=0", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      plainSide("s2"),
    ];
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.rightEndIsDoor, 0);
    assert.equal(g.rightIsPartition, 0);
    assert.equal(g.rightWallLike, 1);
    assert.equal(g.rightDegree, 0);
  });

  // Row 4: Glass | Partition, neighbor glass end → wallLike=0, degree=1
  test("Glass | Partition (neighbor glass end) → rightWallLike=0, rightDegree=1", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      partitionSide("s2", "p2"),
    ];
    const designs = new Map([
      // p2's left end (sections[0].cells[0]) is GLASS
      ["p2", glassDesign(2000, 3000)],
    ]);
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    assert.equal(g.rightEndIsDoor, 0);
    assert.equal(g.rightIsPartition, 1);
    assert.equal(g.rightNeighborEndIsDoor, 0);
    assert.equal(g.rightWallLike, 0);
    assert.equal(g.rightDegree, 1);
  });

  // Row 5: Glass | Partition, neighbor door end → wallLike=1, degree=0
  test("Glass | Partition (neighbor door end) → rightWallLike=1, rightDegree=0", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
      partitionSide("s2", "p2"),
    ];
    const designs = new Map([
      // p2's left end (sections[0].cells[0]) is DOOR
      ["p2", doorDesign(2000, 3000)],
    ]);
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    assert.equal(g.rightEndIsDoor, 0);
    assert.equal(g.rightIsPartition, 1);
    assert.equal(g.rightNeighborEndIsDoor, 1);
    assert.equal(g.rightWallLike, 1);
    assert.equal(g.rightDegree, 0);
  });
});

// ─── Open-room edge cases ─────────────────────────────────────────────────────

describe("open-room adjacency", () => {
  test("open room: partition at position 0 → left end treated as wall (leftIsPartition=0)", () => {
    // sides[0] = p1, no left neighbor in an open room
    const sides: RoomSide[] = [
      partitionSide("s0", "p1"),
      plainSide("s1"),
    ];
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: false,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.leftIsPartition, 0);
    assert.equal(g.leftWallLike, 1); // glass meets open end (treated as wall)
    assert.equal(g.leftDegree, 0);
  });

  test("open room: partition at last position → right end treated as wall (rightIsPartition=0)", () => {
    const sides: RoomSide[] = [
      plainSide("s0"),
      partitionSide("s1", "p1"),
    ];
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: false,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.rightIsPartition, 0);
    assert.equal(g.rightWallLike, 1);
    assert.equal(g.rightDegree, 0);
  });
});

// ─── Closed room, single partition (wraps to itself) ─────────────────────────

describe("closed room, single partition", () => {
  test("wraps to itself: both neighbors are the same partition — adjacency resolved", () => {
    const sides: RoomSide[] = [partitionSide("s0", "p1")];
    // p1 is its own left and right neighbor (n=1, idx=0, closed)
    const design = glassDesign(2000, 3000);
    const designs = new Map([["p1", design]]);
    const g = derive({
      partitionId: "p1",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: design,
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    // Both neighbors are p1 itself (glass on both ends of p1's own design)
    assert.equal(g.leftIsPartition, 1);
    assert.equal(g.rightIsPartition, 1);
    // p1's right end (facing left neighbor = itself) = GLASS → leftNeighborEndIsDoor=0
    // p1's left end (facing right neighbor = itself) = GLASS → rightNeighborEndIsDoor=0
    assert.equal(g.leftNeighborEndIsDoor, 0);
    assert.equal(g.rightNeighborEndIsDoor, 0);
    assert.equal(g.leftDegree, 1);
    assert.equal(g.rightDegree, 1);
    assert.equal(g.leftWallLike, 0);
    assert.equal(g.rightWallLike, 0);
  });
});

// ─── Degree Connector halving test ────────────────────────────────────────────

describe("degree connector — halving", () => {
  test("glass-to-glass junction: partition A has rightDegree=1, partition B has leftDegree=1; sum = 2", () => {
    // Room: [p_a, p_b, PLAIN] (closed). p_a and p_b both have GLASS at their touching ends.
    const sides: RoomSide[] = [
      partitionSide("s0", "p_a"),
      partitionSide("s1", "p_b"),
      plainSide("s2"),
    ];
    const designs = new Map([
      ["p_a", glassDesign(2000, 3000)],
      ["p_b", glassDesign(2000, 3000)],
    ]);

    const gA = derive({
      partitionId: "p_a",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });
    const gB = derive({
      partitionId: "p_b",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });

    // p_a's right end meets p_b's left end — both glass
    assert.equal(gA.rightDegree, 1, "p_a.rightDegree should be 1 (glass-to-glass junction)");
    assert.equal(gB.leftDegree, 1, "p_b.leftDegree should be 1 (glass-to-glass junction)");

    // degreeConnector formula = leftDegree + rightDegree
    // p_a: leftDegree=0 (plain wall on left), rightDegree=1 → contributes 1
    // p_b: leftDegree=1, rightDegree=0 (plain wall on right) → contributes 1
    const totalDegreeConnector = (gA.leftDegree + gA.rightDegree) + (gB.leftDegree + gB.rightDegree);
    assert.equal(totalDegreeConnector, 2, "total degreeConnector across both partitions should be 2 (not 4)");
  });

  test("right neighbor's right end is door: second partition's leftNeighborEndIsDoor=1 → wallLike=1", () => {
    // Room: [p_a, p_b, PLAIN]. p_a's right end is a DOOR.
    // p_b's left neighbor is p_a, whose right end (sections[last].cells[last]) is DOOR.
    // → p_b should get leftNeighborEndIsDoor=1 → leftWallLike=1 (treated as wall)
    const sides: RoomSide[] = [
      partitionSide("s0", "p_a"),
      partitionSide("s1", "p_b"),
      plainSide("s2"),
    ];
    // p_a: left=GLASS, right=DOOR
    const p_aDesign: ParsedDesign = {
      sections: [
        { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
        { widthMm: 1000, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
      ],
    };
    const designs = new Map([
      ["p_a", p_aDesign],
      ["p_b", glassDesign(2000, 3000)],
    ]);

    const gB = derive({
      partitionId: "p_b",
      widthMm: 2000, heightMm: 3000,
      parsedDesign: glassDesign(2000, 3000),
      sides, isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: id => designs.get(id) ?? null,
    });

    assert.equal(gB.leftIsPartition, 1);
    assert.equal(gB.leftNeighborEndIsDoor, 1, "p_a's right end is DOOR → p_b.leftNeighborEndIsDoor=1");
    assert.equal(gB.leftWallLike, 1, "neighbor end is door → treated as wall");
    assert.equal(gB.leftDegree, 0);
  });
});

// ─── Door-count metrics ───────────────────────────────────────────────────────

describe("door-count metrics", () => {
  test("full-height door: single cell in section, heightMm === partitionHeightMm → reduces doorWidthMmFullHeight", () => {
    const design: ParsedDesign = {
      sections: [{ widthMm: 900, cells: [{ heightMm: 3000, selectionId: "sel-door" }] }],
    };
    const g = derive({
      partitionId: "p1",
      widthMm: 900, heightMm: 3000,
      parsedDesign: design,
      sides: [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")],
      isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.doorWidthMmFullHeight, 900);
    assert.equal(g.doorCount, 1);
  });

  test("transom door: door cell in section with glass above → heightMm < partitionHeightMm → NOT full-height", () => {
    // Door cell is 2000mm tall, partition is 3000mm, glass transom above it (1000mm)
    const design: ParsedDesign = {
      sections: [
        {
          widthMm: 900,
          cells: [
            { heightMm: 1000, selectionId: "sel-glass" }, // transom above
            { heightMm: 2000, selectionId: "sel-door" },  // door below
          ],
        },
      ],
    };
    const g = derive({
      partitionId: "p1",
      widthMm: 900, heightMm: 3000,
      parsedDesign: design,
      sides: [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")],
      isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    // Door is not full-height (cell.heightMm=2000 ≠ partition.heightMm=3000), and section has 2 cells
    assert.equal(g.doorWidthMmFullHeight, 0, "transom door should not count as full-height");
    assert.equal(g.doorCount, 1);
  });

  test("nonCornerDoorCount excludes left and right corner doors", () => {
    // Partition with 3 sections: [DOOR, GLASS, DOOR]. Two corner doors, zero non-corner.
    const design: ParsedDesign = {
      sections: [
        { widthMm: 900, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
        { widthMm: 2200, cells: [{ heightMm: 3000, selectionId: "sel-glass" }] },
        { widthMm: 900, cells: [{ heightMm: 3000, selectionId: "sel-door" }] },
      ],
    };
    const g = derive({
      partitionId: "p1",
      widthMm: 4000, heightMm: 3000,
      parsedDesign: design,
      sides: [plainSide("s0"), partitionSide("s1", "p1"), plainSide("s2")],
      isClosed: true,
      cellSlotResolver: simpleSlotResolver,
      neighborDesignResolver: noNeighborDesign,
    });
    assert.equal(g.doorCount, 2);
    assert.equal(g.leftEndIsDoor, 1);
    assert.equal(g.rightEndIsDoor, 1);
    assert.equal(g.nonCornerDoorCount, 0, "both doors are corner doors");
  });
});
