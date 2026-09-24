/**
 * Unit tests for lib/summary/view.ts (Stage 26 Batch 1). Pure — no DB, no server.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rebuildDoorKpis,
  buildMaterialSections,
  formatGlassLabel,
  formatThickness,
  formatAreaM2,
  formatUnit,
  SHARED_MATERIALS_TITLE,
} from "../../lib/summary/view";
import type { Summary } from "../../lib/summary/types";
import type { ConfigSnapshot } from "../../lib/config-snapshot";
import type { MaterialListLine } from "../../lib/summary/types";

// ─── rebuildDoorKpis ────────────────────────────────────────────────────────

function summaryWithDoors(
  doors: Array<{ category: string | null; doorType: string | null; quantity: number }>,
): Summary {
  return {
    floors: [
      {
        floorId: "f1",
        floorLabel: "Ground",
        rooms: [
          {
            roomId: "r1",
            roomLabel: "Room A",
            walls: doors.map((d, i) => ({
              partitionId: `w${i}`,
              wallLabel: `Wall ${i}`,
              glass: [],
              doors: [{ widthMm: 900, heightMm: 2100, handing: "RH" as const, ...d }],
            })),
          },
        ],
      },
    ],
    kpis: { totalPartitionSqm: 0, sqmByGlassType: [], doorsByType: [] },
  };
}

describe("rebuildDoorKpis", () => {
  test("groups by (category, doorType), summing quantity, including a merged same-doorType-different-category case", () => {
    const summary = summaryWithDoors([
      { category: "Single", doorType: "Simple Glass", quantity: 1 },
      { category: "Single", doorType: "Simple Glass", quantity: 2 },
      { category: "Double", doorType: "Simple Glass", quantity: 3 },
      { category: null, doorType: null, quantity: 1 },
    ]);

    const rows = rebuildDoorKpis(summary);

    // Invariant: sum of all returned quantities equals the sum of all door quantities in the fixture.
    const totalIn = summary.floors[0].rooms[0].walls.reduce(
      (sum, w) => sum + w.doors.reduce((s, d) => s + d.quantity, 0),
      0,
    );
    const totalOut = rows.reduce((sum, r) => sum + r.quantity, 0);
    assert.equal(totalOut, totalIn);

    const single = rows.find((r) => r.category === "Single" && r.doorType === "Simple Glass");
    assert.ok(single);
    assert.equal(single!.quantity, 3);

    const double = rows.find((r) => r.category === "Double" && r.doorType === "Simple Glass");
    assert.ok(double);
    assert.equal(double!.quantity, 3);

    const nullGroup = rows.find((r) => r.category === null && r.doorType === null);
    assert.ok(nullGroup);
    assert.equal(nullGroup!.quantity, 1);
  });

  test("empty summary produces no rows", () => {
    const summary = summaryWithDoors([]);
    assert.deepEqual(rebuildDoorKpis(summary), []);
  });
});

// ─── buildMaterialSections ──────────────────────────────────────────────────

function snapshot(): ConfigSnapshot {
  return {
    takenAt: "2026-09-24T00:00:00.000Z",
    componentTypes: [
      { id: "t-glass", code: "GLASS", name: "Partition Glass", active: true, fieldsSchema: [], fieldOptionsConfig: {} },
      { id: "t-door", code: "DOOR", name: "Door", active: true, fieldsSchema: [], fieldOptionsConfig: {} },
    ],
  };
}

function line(over: Partial<MaterialListLine>): MaterialListLine {
  return {
    code: "ITEM",
    name: "Item",
    slot: "GLASS",
    unit: "metres",
    requirement: 1,
    perUnitQuantity: 1,
    quantity: 1,
    ...over,
  };
}

describe("buildMaterialSections", () => {
  test("sections a snapshot-matched slot, a slot absent from the snapshot, and an array-slot line", () => {
    const materialList: MaterialListLine[] = [
      line({ code: "GLASS-CLR-12", slot: "GLASS" }),
      line({ code: "SEAL-1", slot: "SEALANT" }), // absent from snapshot
      line({ code: "GASKET-1", slot: ["GLASS", "DOOR"] }), // array slot -> Shared materials
    ];

    const sections = buildMaterialSections(materialList, snapshot());

    // Invariant: total lines across all sections === materialList.length.
    const totalLines = sections.reduce((n, s) => n + s.lines.length, 0);
    assert.equal(totalLines, materialList.length);

    const glassSection = sections.find((s) => s.code === "GLASS");
    assert.ok(glassSection);
    assert.equal(glassSection!.title, "Partition Glass");
    assert.equal(glassSection!.lines.length, 1);

    const sealantSection = sections.find((s) => s.code === "SEALANT");
    assert.ok(sealantSection);
    assert.equal(sealantSection!.title, "SEALANT"); // no snapshot match -> raw code as title

    const shared = sections.find((s) => s.code === "shared");
    assert.ok(shared);
    assert.equal(shared!.title, SHARED_MATERIALS_TITLE);
    assert.equal(shared!.lines.length, 1);
    assert.deepEqual(shared!.lines[0].slot, ["GLASS", "DOOR"]);
  });

  test("no array-slot lines -> no Shared materials section", () => {
    const sections = buildMaterialSections([line({ slot: "GLASS" })], snapshot());
    assert.equal(sections.find((s) => s.code === "shared"), undefined);
  });

  test("snapshot order is respected for matched slots", () => {
    const materialList: MaterialListLine[] = [
      line({ code: "D1", slot: "DOOR" }),
      line({ code: "G1", slot: "GLASS" }),
    ];
    const sections = buildMaterialSections(materialList, snapshot());
    assert.deepEqual(sections.map((s) => s.code), ["GLASS", "DOOR"]);
  });
});

// ─── Formatting helpers ─────────────────────────────────────────────────────

describe("formatGlassLabel", () => {
  test("passes through a real value", () => assert.equal(formatGlassLabel("ID1"), "ID1"));
  test("null -> em dash", () => assert.equal(formatGlassLabel(null), "—"));
});

describe("formatThickness", () => {
  test("numeric -> appends ' mm'", () => assert.equal(formatThickness("12"), "12 mm"));
  test("already-unit string untouched", () => assert.equal(formatThickness("12mm"), "12mm"));
  test("null -> em dash", () => assert.equal(formatThickness(null), "—"));
});

describe("formatAreaM2", () => {
  test("formats to 2 decimals", () => assert.equal(formatAreaM2(2.4), "2.40"));
  test("rounds to 2 decimals", () => assert.equal(formatAreaM2(2.006), "2.01"));
});

describe("formatUnit", () => {
  test("metres -> m", () => assert.equal(formatUnit("metres"), "m"));
  test("pieces, quantity 1 -> pc", () => assert.equal(formatUnit("pieces", 1), "pc"));
  test("pieces, quantity != 1 -> pcs", () => assert.equal(formatUnit("pieces", 3), "pcs"));
  test("pieces, quantity omitted -> pcs (plural default)", () => assert.equal(formatUnit("pieces"), "pcs"));
  test("other unit passes through unchanged", () => assert.equal(formatUnit("sqm"), "sqm"));
});
