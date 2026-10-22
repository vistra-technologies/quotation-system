/**
 * Unit tests for the Stage 34 S34-4 convert options: `resolveConvertOptions` (lib/panel-widths.ts, D-22),
 * `seedDoorOnlyDesign` (lib/partition-design.ts) and `findFirstDoorSelectionId` (lib/data/default-glass.ts).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveConvertOptions } from "../../lib/panel-widths";
import { fillDefaultGlass, seedDoorOnlyDesign, seedSectionsDesign } from "../../lib/partition-design";
import { findFirstDoorSelectionId } from "../../lib/data/default-glass";

describe("resolveConvertOptions", () => {
  test("neither field: 3 panels and no width check (legacy body unchanged)", () => {
    assert.deepEqual(resolveConvertOptions({ widthMm: 150 }), { ok: true, count: 3, doorOnly: false });
  });

  test("panelCount 1, 5 and 20 are accepted", () => {
    for (const n of [1, 5, 20]) {
      assert.deepEqual(resolveConvertOptions({ panelCount: n, widthMm: 2000 }), { ok: true, count: n, doorOnly: false });
    }
  });

  test("0, 21, non-integer, string, null and NaN are refused", () => {
    for (const bad of [0, 21, 2.5, "3", null, NaN, -1]) {
      assert.equal(resolveConvertOptions({ panelCount: bad, widthMm: 2000 }).ok, false, String(bad));
    }
  });

  test("minimum width is exactly 100 mm per panel (D-22)", () => {
    assert.equal(resolveConvertOptions({ panelCount: 20, widthMm: 2000 }).ok, true); // 100 each
    assert.equal(resolveConvertOptions({ panelCount: 16, widthMm: 1500 }).ok, false); // 93 each
    assert.equal(resolveConvertOptions({ panelCount: 3, widthMm: 299 }).ok, false); // floor(99.67) = 99
    assert.equal(resolveConvertOptions({ panelCount: 1, widthMm: 99 }).ok, false);
  });

  test("doorOnly: one section; combined only with panelCount 1; must be a boolean", () => {
    assert.deepEqual(resolveConvertOptions({ doorOnly: true, widthMm: 900 }), { ok: true, count: 1, doorOnly: true });
    assert.deepEqual(resolveConvertOptions({ doorOnly: true, panelCount: 1, widthMm: 900 }), { ok: true, count: 1, doorOnly: true });
    assert.equal(resolveConvertOptions({ doorOnly: true, panelCount: 3, widthMm: 900 }).ok, false);
    assert.equal(resolveConvertOptions({ doorOnly: "yes", widthMm: 900 }).ok, false);
    assert.equal(resolveConvertOptions({ doorOnly: true, widthMm: 99 }).ok, false);
  });

  test("doorOnly false behaves as absent: panelCount applies", () => {
    assert.deepEqual(resolveConvertOptions({ doorOnly: false, panelCount: 7, widthMm: 2100 }), { ok: true, count: 7, doorOnly: false });
    assert.deepEqual(resolveConvertOptions({ doorOnly: false, widthMm: 900 }), { ok: true, count: 3, doorOnly: false });
  });
});

describe("seedDoorOnlyDesign", () => {
  test("one full-width section with one full-height door cell, hinged left", () => {
    let n = 0;
    const d = seedDoorOnlyDesign(1000, 2400, "door-1", () => `id${++n}`);
    assert.deepEqual(d, {
      schemaVersion: 2,
      sections: [{ id: "id1", widthMm: 1000, cells: [{ id: "id2", heightMm: 2400, selectionId: "door-1", hinging: "left" }] }],
    });
  });

  test("the default-glass fill never touches the door cell", () => {
    const d = seedDoorOnlyDesign(1000, 2400, "door-1", () => "x");
    const r = fillDefaultGlass(d.sections, "glass-1");
    assert.equal(r.changed, false);
    assert.equal(r.sections[0].cells[0].selectionId, "door-1");
  });

  test("panelCount sections: last absorbs the remainder", () => {
    const d = seedSectionsDesign(2000, 2400, 3, () => "x");
    assert.deepEqual(d.sections.map((s) => s.widthMm), [666, 666, 668]);
  });
});

describe("findFirstDoorSelectionId", () => {
  test("scoped by organizationId + projectId + DOOR, ordered orderIndex then createdAt", async () => {
    let args: unknown;
    const client = { selection: { findFirst: async (a: unknown) => ((args = a), { id: "d1" }) } };
    assert.equal(await findFirstDoorSelectionId(client as never, "org-1", "proj-1"), "d1");
    assert.deepEqual(args, {
      where: { organizationId: "org-1", projectId: "proj-1", componentType: { code: "DOOR" } },
      orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
  });

  test("no door Selection -> null", async () => {
    const client = { selection: { findFirst: async () => null } };
    assert.equal(await findFirstDoorSelectionId(client as never, "o", "p"), null);
  });
});
