/**
 * Unit tests for lib/summary/pdf-rows.ts (Stage 26 Batch 4). Pure — no DB, no jsPDF import anywhere in
 * this file (lib/summary/pdf.ts is the sole jsPDF import site; nothing here needs a DOM/jsPDF stub).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildKpiPdfTables, buildMaterialPdfTables, resolveClientField } from "../../lib/summary/pdf-rows";
import { buildSummary } from "../../lib/summary";
import { formatAreaM2 } from "../../lib/summary/view";
import type { Summary, SummaryInput, MaterialListLine } from "../../lib/summary/types";
import type { ConfigSnapshot } from "../../lib/config-snapshot";

// ─── buildKpiPdfTables ──────────────────────────────────────────────────────

function summaryFixture(): Summary {
  return {
    floors: [
      {
        floorId: "f1",
        floorLabel: "Ground",
        rooms: [
          {
            roomId: "r1",
            roomLabel: "Room A",
            walls: [
              {
                partitionId: "w1",
                wallLabel: "Wall 1",
                glass: [],
                doors: [
                  { widthMm: 900, heightMm: 2100, handing: "RH", category: "Single", doorType: "Simple Glass", quantity: 2 },
                  { widthMm: 900, heightMm: 2100, handing: "LH", category: "Double", doorType: "Simple Glass", quantity: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
    kpis: {
      totalPartitionSqm: 12.345,
      sqmByGlassType: [
        { glassType: "ID1", thickness: "12", areaM2: 6.123 },
        { glassType: "ID2", thickness: "10", areaM2: 6.222 },
      ],
      doorsByType: [{ doorType: "Simple Glass", quantity: 3 }],
    },
  };
}

describe("buildKpiPdfTables", () => {
  test("glass table: one row per sqmByGlassType entry, in incoming order", () => {
    const { glass } = buildKpiPdfTables(summaryFixture());
    assert.equal(glass.body.length, 2);
    assert.equal(glass.head.length, 3);
    assert.equal(glass.body[0][0], "ID1");
    assert.equal(glass.body[1][0], "ID2");
  });

  test("glass Total row equals formatAreaM2(totalPartitionSqm), not a sum of the (rounded) body rows", () => {
    // Deliberately mismatched from the sum of sqmByGlassType (6.123 + 6.222 = 12.345, same here) —
    // change totalPartitionSqm independently to prove the Total row reads the stored KPI, not a sum.
    const summary = { ...summaryFixture(), kpis: { ...summaryFixture().kpis, totalPartitionSqm: 20 } };
    const { glass } = buildKpiPdfTables(summary);
    assert.ok(glass.totalRow);
    assert.equal(glass.totalRow![2], "20.00 m²");
    const naiveSum = summary.kpis.sqmByGlassType.reduce((s, r) => s + r.areaM2, 0);
    assert.notEqual(formatAreaM2(naiveSum), "20.00");
  });

  test("doors table: row order/count matches rebuildDoorKpis() directly (no PDF-only resort)", () => {
    const { doors } = buildKpiPdfTables(summaryFixture());
    assert.equal(doors.body.length, 2);
    const categories = doors.body.map((r) => r[1]);
    assert.deepEqual(categories.sort(), ["Double", "Single"]);
  });

  test("doors Total row sums quantity (integer, matches on-screen Total rule)", () => {
    const { doors } = buildKpiPdfTables(summaryFixture());
    assert.ok(doors.totalRow);
    assert.equal(doors.totalRow![2], "3 pcs");
  });
});

// ─── buildMaterialPdfTables ─────────────────────────────────────────────────

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

describe("buildMaterialPdfTables", () => {
  test("total body rows across all tables equals materialList.length; no Total row on any table", () => {
    const materialList: MaterialListLine[] = [
      line({ code: "G1", slot: "GLASS" }),
      line({ code: "D1", slot: "DOOR" }),
      line({ code: "S1", slot: ["GLASS", "DOOR"] }),
    ];
    const tables = buildMaterialPdfTables(materialList, snapshot());
    const totalRows = tables.reduce((n, t) => n + t.body.length, 0);
    assert.equal(totalRows, materialList.length);
    for (const t of tables) assert.equal(t.totalRow, undefined);
  });

  test("section order matches buildMaterialSections() order (snapshot order, then unmatched, then Shared)", () => {
    const materialList: MaterialListLine[] = [
      line({ code: "SEAL-1", slot: "SEALANT" }),
      line({ code: "SHARED-1", slot: ["GLASS", "DOOR"] }),
      line({ code: "D1", slot: "DOOR" }),
      line({ code: "G1", slot: "GLASS" }),
    ];
    const tables = buildMaterialPdfTables(materialList, snapshot());
    assert.deepEqual(
      tables.map((t) => t.title),
      ["Partition Glass", "Door", "SEALANT", "Shared materials"],
    );
  });

  test("real buildSummary() fixture (integration sanity): materialList row count survives into PDF tables", () => {
    const snap: ConfigSnapshot = {
      takenAt: "2026-09-24T00:00:00.000Z",
      componentTypes: [
        { id: "t-door", code: "DOOR", name: "Door", active: true, fieldsSchema: [], fieldOptionsConfig: {} },
      ],
    };
    const formulaSetBody = {
      slots: {
        DOOR: { role: "door", requiredParams: [], summaryParams: { category: "category", doorType: "doorType" } },
      },
      formulas: [],
    };
    const selections = [
      { id: "d-single", componentTypeId: "t-door", config: { category: "Single", doorType: "Simple Glass" } },
    ];
    const input: SummaryInput = {
      formulaSetBody,
      snapshot: snap,
      floors: [
        {
          id: "f1",
          label: "Ground",
          rooms: [
            {
              id: "r1",
              label: "Room A",
              partitions: [
                {
                  id: "p1",
                  label: "Wall 1",
                  widthMm: 0,
                  heightMm: 0,
                  design: {
                    schemaVersion: 2,
                    sections: [{ id: "s1", widthMm: 900, cells: [{ id: "c1", heightMm: 2800, selectionId: "d-single" }] }],
                  },
                },
              ],
            },
          ],
        },
      ],
      selections,
    };
    const r = buildSummary(input);
    assert.equal(r.status, "OK", r.errorDetail);
    const tables = buildMaterialPdfTables(r.materialList, snap);
    const totalRows = tables.reduce((n, t) => n + t.body.length, 0);
    assert.equal(totalRows, r.materialList.length);
  });
});

// ─── resolveClientField ─────────────────────────────────────────────────────

describe("resolveClientField", () => {
  test("external company only", () => {
    const r = resolveClientField("Acme Distributors", null);
    assert.deepEqual(r, { label: "External Company", value: "Acme Distributors" });
  });

  test("end client only", () => {
    const r = resolveClientField(null, "Some End Client");
    assert.deepEqual(r, { label: "End Client", value: "Some End Client" });
  });

  test("neither set -> em dash", () => {
    const r = resolveClientField(null, null);
    assert.deepEqual(r, { label: "End Client", value: "—" });
  });

  test("both set -> external company wins (deviation note #2)", () => {
    const r = resolveClientField("Acme Distributors", "Some End Client");
    assert.deepEqual(r, { label: "External Company", value: "Acme Distributors" });
  });
});
