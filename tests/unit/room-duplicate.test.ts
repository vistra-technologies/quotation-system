/**
 * Unit tests for the Stage 34 S34-5 duplicate-room helpers: `cloneDesignWithFreshIds`
 * (lib/partition-design.ts) and `copySides` (lib/room-sides-copy.ts). Pure, no DB.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cloneDesignWithFreshIds } from "../../lib/partition-design";
import { copySides } from "../../lib/room-sides-copy";
import type { RoomSide } from "../../lib/data/rooms";

function counter(prefix = "new") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const SOURCE = () => ({
  schemaVersion: 2,
  defaults: { glassSelectionId: "g1" },
  stops: { top: "s1", bottom: null },
  measurements: { a: [1, 2] },
  distribution: { mode: "x" },
  sections: [
    { id: "sec-a", widthMm: 1000, locked: true, cells: [{ id: "c-a", heightMm: 2400, selectionId: "g1" }] },
    {
      id: "sec-b",
      widthMm: 900,
      cells: [
        { id: "c-b0", heightMm: 400, selectionId: "g1" },
        { id: "c-b1", heightMm: 2000, selectionId: "d1", hinging: "right" },
      ],
    },
  ],
});

describe("cloneDesignWithFreshIds", () => {
  test("every section and cell gets a fresh unique id; nothing else changes", () => {
    const src = SOURCE();
    const copy = cloneDesignWithFreshIds(src, counter()) as ReturnType<typeof SOURCE>;
    const ids = copy.sections.flatMap((s) => [s.id, ...s.cells.map((c) => c.id)]);
    assert.deepEqual(ids, ["new-1", "new-2", "new-3", "new-4", "new-5"]);
    const oldIds = new Set(["sec-a", "c-a", "sec-b", "c-b0", "c-b1"]);
    assert.ok(ids.every((id) => !oldIds.has(id)));
    // normalising ids away, the copy equals the source (locked, hinging, selectionIds, stops, etc. kept)
    const strip = (d: ReturnType<typeof SOURCE>) => ({
      ...d,
      sections: d.sections.map((s) => ({ ...s, id: "-", cells: s.cells.map((c) => ({ ...c, id: "-" })) })),
    });
    assert.deepEqual(strip(copy), strip(SOURCE()));
    assert.equal(copy.sections[0].locked, true);
    assert.equal((copy.sections[1].cells[1] as { hinging?: string }).hinging, "right");
  });

  test("does not mutate the input and shares no object with it", () => {
    const src = SOURCE();
    const copy = cloneDesignWithFreshIds(src, counter()) as ReturnType<typeof SOURCE>;
    assert.deepEqual(src, SOURCE());
    copy.stops.top = "changed";
    (copy.measurements as { a: number[] }).a.push(3);
    copy.sections[0].cells[0].selectionId = "changed";
    assert.deepEqual(src, SOURCE());
  });

  test("null / non-object input is returned as is", () => {
    assert.equal(cloneDesignWithFreshIds(null, counter()), null);
    assert.equal(cloneDesignWithFreshIds("x", counter()), "x");
    assert.deepEqual(cloneDesignWithFreshIds([1], counter()), [1]);
  });

  test("a v1 panels doc and malformed sections are cloned without throwing", () => {
    const v1 = { panels: [{ id: "p1", type: "glass" }] };
    assert.deepEqual(cloneDesignWithFreshIds(v1, counter()), v1);
    const odd = { schemaVersion: 2, sections: [null, { id: "s", widthMm: 1 }, { id: "t", cells: [7, { id: "c" }] }] };
    assert.deepEqual(cloneDesignWithFreshIds(odd, counter()), {
      schemaVersion: 2,
      sections: [null, { id: "new-1", widthMm: 1 }, { id: "new-2", cells: [7, { id: "new-3" }] }],
    });
  });
});

describe("copySides", () => {
  const sides: RoomSide[] = [
    { id: "s1", kind: "PARTITION", partitionId: "p1", turnDegrees: 90, lengthMm: null, label: null },
    { id: "s2", kind: "PLAIN", partitionId: null, turnDegrees: 270, lengthMm: 1500, label: "Desk" },
    { id: "s3", kind: "PARTITION", partitionId: "p2", turnDegrees: 180, lengthMm: null, label: null },
    { id: "s4", kind: "PLAIN", partitionId: null, turnDegrees: 90, lengthMm: null, label: null },
  ];

  test("same order and kinds, partition ids remapped, every side id fresh and unique", () => {
    const out = copySides(sides, new Map([["p1", "q1"], ["p2", "q2"]]), counter("side"));
    assert.deepEqual(out, [
      { id: "side-1", kind: "PARTITION", partitionId: "q1", turnDegrees: 90, lengthMm: null, label: null },
      { id: "side-2", kind: "PLAIN", partitionId: null, turnDegrees: 270, lengthMm: 1500, label: "Desk" },
      { id: "side-3", kind: "PARTITION", partitionId: "q2", turnDegrees: 180, lengthMm: null, label: null },
      { id: "side-4", kind: "PLAIN", partitionId: null, turnDegrees: 90, lengthMm: null, label: null },
    ]);
    assert.equal(sides[0].id, "s1"); // source untouched
  });

  test("a PARTITION side without a mapping throws", () => {
    assert.throws(() => copySides(sides, new Map([["p1", "q1"]]), counter()), /No copied partition/);
  });
});
