/**
 * Unit tests for diffFormulaSetBodies() / highlightChange() — the "Changes vs vN" panel on the SuperAdmin
 * new-version draft page (hotfix 2026-10-02, item 5). Pure — no DB, no DOM.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diffFormulaSetBodies, highlightChange } from "../../lib/formula-set/diff";
import type { BodyDiffOk } from "../../lib/formula-set/diff";

const BASE = {
  slots: {
    DOOR: { role: "door", requiredParams: [{ key: "hasFrame" }, { key: "frameCode" }] },
    GLASS: { role: "glass", summaryParams: { glassType: "glassType" }, requiredParams: [{ key: "u_profile" }] },
  },
  formulas: [
    { id: "doorFrame", slot: "DOOR", unit: "metres", grain: "CELL", quantity: "(cell.widthMm + 2*cell.heightMm) / 1000", condition: "param.hasFrame == 'Yes'", materialCode: "{param.frameCode}" },
    { id: "profileU", slot: "GLASS", unit: "metres", grain: "PARTITION", quantity: "(partition.widthMm - partition.doorWidthMmFullHeight) / 1000", materialCode: "{param.u_profile}" },
  ],
  schemaVersion: 2,
};
const baseJson = JSON.stringify(BASE);
const clone = () => JSON.parse(baseJson) as typeof BASE;

function ok(draft: unknown): BodyDiffOk {
  const d = diffFormulaSetBodies(baseJson, JSON.stringify(draft));
  assert.equal(d.ok, true);
  return d as BodyDiffOk;
}

describe("diffFormulaSetBodies: basics", () => {
  test("identical bodies → identical, nothing listed", () => {
    const d = ok(BASE);
    assert.equal(d.identical, true);
    assert.deepEqual(d.counts, { changed: 0, added: 0, removed: 0, unchanged: 2 });
  });

  test("formatting and key order alone are not a change", () => {
    const d = diffFormulaSetBodies(baseJson, JSON.stringify({ schemaVersion: 2, formulas: BASE.formulas.map(f => ({ ...f })), slots: BASE.slots }, null, 4));
    assert.equal(d.ok && d.identical, true);
  });

  test("reordering formulas is not a change", () => {
    const draft = clone();
    draft.formulas.reverse();
    assert.equal(ok(draft).identical, true);
  });

  test("changed quantity → one changed formula with a quantity field change", () => {
    const draft = clone();
    draft.formulas[1].quantity = "(partition.widthMm - partition.doorWidthMm) / 1000";
    const d = ok(draft);
    assert.equal(d.identical, false);
    assert.deepEqual(d.counts, { changed: 1, added: 0, removed: 0, unchanged: 1 });
    assert.equal(d.formulas[0].id, "profileU");
    assert.equal(d.formulas[0].kind, "changed");
    assert.deepEqual(d.formulas[0].fields.map(f => f.field), ["quantity"]);
    assert.deepEqual(d.unchangedIds, ["doorFrame"]);
  });

  test("removing a condition shows before and after undefined", () => {
    const draft = clone();
    delete (draft.formulas[0] as Record<string, unknown>).condition;
    const f = ok(draft).formulas[0];
    assert.equal(f.kind, "changed");
    assert.equal(f.fields[0].field, "condition");
    assert.equal(f.fields[0].before, "param.hasFrame == 'Yes'");
    assert.equal(f.fields[0].after, undefined);
  });

  test("changed fields are ordered quantity first", () => {
    const draft = clone();
    Object.assign(draft.formulas[0], { unit: "pieces", quantity: "3" });
    assert.deepEqual(ok(draft).formulas[0].fields.map(f => f.field), ["quantity", "unit"]);
  });

  test("added formula lists every field except id", () => {
    const draft = clone();
    draft.formulas.push({ id: "woodWedge", slot: "GLASS", unit: "metres", grain: "PARTITION", quantity: "1", materialCode: "{param.u_profile}" } as never);
    const d = ok(draft);
    assert.deepEqual(d.counts, { changed: 0, added: 1, removed: 0, unchanged: 2 });
    const f = d.formulas[0];
    assert.equal(f.kind, "added");
    assert.equal(f.id, "woodWedge");
    assert.deepEqual(f.meta, { slot: "GLASS", grain: "PARTITION", unit: "metres" });
    assert.ok(f.fields.every(x => x.before === undefined && x.after !== undefined));
    assert.ok(!f.fields.some(x => x.field === "id"));
  });

  test("removed formula", () => {
    const draft = clone();
    draft.formulas.pop();
    const d = ok(draft);
    assert.deepEqual(d.counts, { changed: 0, added: 0, removed: 1, unchanged: 1 });
    assert.equal(d.formulas[0].kind, "removed");
    assert.equal(d.formulas[0].id, "profileU");
    assert.ok(d.formulas[0].fields.every(x => x.after === undefined));
  });
});

describe("diffFormulaSetBodies: slots and top-level", () => {
  test("added / removed requiredParams keys", () => {
    const draft = clone();
    draft.slots.GLASS.requiredParams = [{ key: "i_profile" }];
    const d = ok(draft);
    assert.equal(d.slots.length, 1);
    assert.equal(d.slots[0].slot, "GLASS");
    assert.equal(d.slots[0].kind, "changed");
    assert.deepEqual(d.slots[0].details, ["requiredParams: + i_profile", "requiredParams: − u_profile"]);
    assert.equal(d.identical, false);
  });

  test("changed summaryParams / role are reported", () => {
    const draft = clone();
    draft.slots.GLASS.summaryParams = { glassType: "thickness" };
    const d = ok(draft);
    assert.equal(d.slots[0].details.length, 1);
    assert.match(d.slots[0].details[0], /^summaryParams: /);
  });

  test("new and removed slots", () => {
    const draft = clone() as Record<string, unknown> & typeof BASE;
    delete (draft.slots as Record<string, unknown>).DOOR;
    (draft.slots as Record<string, unknown>).EXTRA = { role: "x", requiredParams: [{ key: "a" }] };
    const kinds = Object.fromEntries(ok(draft).slots.map(s => [s.slot, s.kind]));
    assert.deepEqual(kinds, { EXTRA: "added", DOOR: "removed" });
  });

  test("top-level field change (schemaVersion) is reported under other", () => {
    const draft = clone();
    draft.schemaVersion = 3;
    const d = ok(draft);
    assert.equal(d.other.length, 1);
    assert.equal(d.other[0].field, "schemaVersion");
    assert.equal(d.identical, false);
  });
});

describe("diffFormulaSetBodies: bad input", () => {
  test("invalid draft JSON → ok:false, side draft, no throw", () => {
    const d = diffFormulaSetBodies(baseJson, '{"formulas": [');
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.side, "draft");
  });

  test("non-object draft → ok:false", () => {
    const d = diffFormulaSetBodies(baseJson, "[]");
    assert.equal(d.ok, false);
  });

  test("invalid base JSON → ok:false, side base", () => {
    const d = diffFormulaSetBodies("nope", baseJson);
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.side, "base");
  });

  test("formula without a string id is skipped, not fatal", () => {
    const draft = clone() as { formulas: unknown[] };
    draft.formulas.push({ slot: "GLASS" }, "junk", null);
    assert.equal(ok(draft).identical, true);
  });
});

describe("cloisons v1 → v2 (the real hotfix change)", () => {
  const seed = JSON.parse(readFileSync(join(__dirname, "../../prisma/formula-sets/cloisons-formula-set-v1.json"), "utf8"));
  const v1 = JSON.stringify({ slots: seed.slots, formulas: seed.formulas, schemaVersion: 2 });
  const v2Body = JSON.parse(v1) as { formulas: { id: string; quantity: string }[] };
  for (const f of v2Body.formulas) {
    if (f.id === "profileL" || f.id === "profileI") f.quantity = f.quantity.replace("doorWidthMmFullHeight", "doorWidthMm");
  }
  const d = diffFormulaSetBodies(v1, JSON.stringify(v2Body)) as BodyDiffOk;

  test("exactly profileL and profileI changed, 20 unchanged, nothing else", () => {
    assert.equal(d.ok, true);
    assert.deepEqual(d.formulas.map(f => f.id).sort(), ["profileI", "profileL"]);
    assert.deepEqual(d.counts, { changed: 2, added: 0, removed: 0, unchanged: 20 });
    assert.deepEqual(d.slots, []);
    assert.deepEqual(d.other, []);
    assert.ok(d.formulas.every(f => f.fields.length === 1 && f.fields[0].field === "quantity"));
  });

  test("highlight isolates the renamed variable", () => {
    const q = d.formulas[0].fields[0];
    const h = highlightChange(q.before as string, q.after as string);
    assert.equal(h.beforeMid, "doorWidthMmFullHeight");
    assert.equal(h.afterMid, "doorWidthMm");
    assert.equal(h.prefix + h.beforeMid + h.suffix, q.before);
    assert.equal(h.prefix + h.afterMid + h.suffix, q.after);
  });
});

describe("highlightChange", () => {
  test("parts always reassemble to both strings", () => {
    const cases: [string, string][] = [
      ["abc", "abc"], ["", "x"], ["x", ""], ["a + b", "a - b"], ["foo.bar", "foo.baz"],
      ["2*x", "2*x + 1"], ["calc.profileU", "calc.profileL"],
    ];
    for (const [a, b] of cases) {
      const h = highlightChange(a, b);
      assert.equal(h.prefix + h.beforeMid + h.suffix, a, `before for ${a}→${b}`);
      assert.equal(h.prefix + h.afterMid + h.suffix, b, `after for ${a}→${b}`);
    }
  });

  test("snaps to whole identifiers", () => {
    const h = highlightChange("calc.profileU", "calc.profileL");
    assert.equal(h.beforeMid, "profileU");
    assert.equal(h.afterMid, "profileL");
  });

  test("appended text highlights only the addition", () => {
    const h = highlightChange("2*x", "2*x + 1");
    assert.equal(h.beforeMid, "");
    assert.equal(h.afterMid, " + 1");
  });
});
