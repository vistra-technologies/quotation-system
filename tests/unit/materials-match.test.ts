/**
 * Unit tests for the Stage 37 Batch 2 `materialMatch` engine: matcher (AC1), evaluator placement, resolver S37-4,
 * and UNRESOLVED_MATCH dedupe. Pure, no DB.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchItems, matchCandidatesFrom } from "../../lib/materials/match";
import type { MatchCandidate } from "../../lib/materials/match";
import { buildMaterials } from "../../lib/materials/index";
import type { MaterialsInput } from "../../lib/materials/index";
import { resolveAndAggregate } from "../../lib/materials/resolve";
import { ProblemCollector } from "../../lib/materials/problems";
import type { InventoryRow } from "../../lib/data/inventory";
import type { FormulaSetBody } from "../../lib/summary/types";
import type { ConfigSnapshot } from "../../lib/config-snapshot";

// ─── Matcher (Unit AC1) ───────────────────────────────────────────────────────

const TYPE = "ct-glass";
const cand = (code: string, rows: Record<string, string>, over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  code, componentTypeId: TYPE, measurementUnit: "m²", active: true, rows, ...over,
});
const fieldTypes = new Map<string, string>([
  ["glassType", "dropdown"], ["thickness", "dropdown"], ["film", "checkbox"], ["note", "field"],
]);
const ALL = new Set(["glassType", "thickness", "film", "note"]);
const query = (values: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  typeId: TYPE, unit: "m²", values, visibleKeys: ALL as ReadonlySet<string>, fieldTypes, ...over,
});
const glass = cand("GLASS-1", { glassType: "ID1", thickness: "12.76" });
const film = cand("FILM-1", { glassType: "ID1", thickness: "12.76", film: "Yes" });

describe("matchItems (S37-1)", () => {
  test("Film No bills the glass only; Film Yes bills both", () => {
    const no = matchItems([glass, film], query({ glassType: "ID1", thickness: "12.76", film: false }));
    assert.deepEqual(no.matched.map((c) => c.code), ["GLASS-1"]);
    const yes = matchItems([glass, film], query({ glassType: "ID1", thickness: "12.76", film: true }));
    assert.deepEqual(yes.matched.map((c) => c.code), ["GLASS-1", "FILM-1"]);
  });

  test("a row on a hidden field never matches", () => {
    const r = matchItems([film], query({ glassType: "ID1", thickness: "12.76", film: true }, { visibleKeys: new Set(["glassType", "thickness"]) }));
    assert.equal(r.matched.length, 0);
  });

  test("stale rows never match: unknown field key, or a value the Selection does not hold", () => {
    assert.equal(matchItems([cand("S1", { gone: "x" })], query({ gone: "x" })).matched.length, 0);
    assert.equal(matchItems([cand("S2", { glassType: "ID9" })], query({ glassType: "ID1" })).matched.length, 0);
  });

  test("blank or absent Selection value never matches", () => {
    assert.equal(matchItems([glass], query({ glassType: "ID1", thickness: "" })).matched.length, 0);
    assert.equal(matchItems([glass], query({ glassType: "ID1" })).matched.length, 0);
  });

  test("another unit, another type, an item with no rows: not candidates", () => {
    const v = { glassType: "ID1", thickness: "12.76" };
    assert.equal(matchItems([cand("U", glass.rows, { measurementUnit: "pieces" })], query(v)).matched.length, 0);
    assert.equal(matchItems([cand("T", glass.rows, { componentTypeId: "other" })], query(v)).matched.length, 0);
    assert.equal(matchItems([cand("N", {})], query(v)).matched.length, 0);
  });

  test("an inactive would-match goes to the inactive list", () => {
    const r = matchItems([cand("OFF", glass.rows, { active: false })], query({ glassType: "ID1", thickness: "12.76" }));
    assert.equal(r.matched.length, 0);
    assert.deepEqual(r.inactive.map((c) => c.code), ["OFF"]);
  });

  test("canonical equality: free-text 12.760 equals row 12.76; checkbox boolean equals Yes/No", () => {
    assert.equal(matchItems([cand("D", { note: "12.76" })], query({ note: " 12.760 " })).matched.length, 1);
    assert.equal(matchItems([cand("F", { film: "No" })], query({ film: false })).matched.length, 1);
  });

  test("matchCandidatesFrom keeps only items with rows", () => {
    const row = (rows?: Record<string, string>): InventoryRow => ({
      name: "n", measurementUnit: "m²", perUnitQuantity: 1, active: true, componentTypeId: TYPE, soldInWholePacks: true, rows,
    });
    const out = matchCandidatesFrom(new Map([["A", row({ glassType: "ID1" })], ["B", row({})], ["C", row()]]));
    assert.deepEqual(out.map((c) => c.code), ["A"]);
  });

  test("the matcher is Prisma-free", () => {
    const src = readFileSync("lib/materials/match.ts", "utf8");
    assert.ok(!/from ["'][^"']*(prisma|lib\/data\/(?!inventory["']))/.test(src));
    assert.ok(!/import \{[^}]*\} from "@\/lib\/data\/inventory"/.test(src), "type-only import of InventoryRow");
  });
});

// ─── Evaluator through buildMaterials ─────────────────────────────────────────

const field = (key: string, type = "dropdown") => ({ key, label: key, type, required: true, basic: false });
const SNAPSHOT: ConfigSnapshot = {
  takenAt: "2026-11-20T00:00:00.000Z",
  componentTypes: [{
    id: TYPE, code: "GLASS", name: "Glass", active: true,
    fieldsSchema: [field("glassType"), field("thickness"), field("film", "checkbox")] as never,
    fieldOptionsConfig: {},
  }],
};
const MATCH_SET: FormulaSetBody = {
  schemaVersion: 2,
  slots: { GLASS: { role: "glass" } },
  formulas: [{
    id: "glassPane", slot: "GLASS", grain: "CELL", materialMatch: { itemType: "GLASS" }, unit: "m²",
    quantity: "cell.widthMm * cell.heightMm / 1000000",
  }, {
    id: "glassTwice", slot: "GLASS", grain: "CELL", materialMatch: { itemType: "GLASS" }, unit: "m²",
    quantity: "calc.glassPane * 2",
  }],
};
function input(config: Record<string, unknown>, inventory: MatchCandidate[], body = MATCH_SET): MaterialsInput {
  return {
    formulaSetBody: body,
    snapshot: SNAPSHOT,
    floors: [{
      id: "f1", label: "Floor 1",
      rooms: [{
        id: "r1", label: "Room 1", isClosed: true,
        sides: [],
        partitions: [{
          id: "p1", label: "Wall 1", widthMm: 1000, heightMm: 2000,
          design: { schemaVersion: 2, sections: [{ widthMm: 1000, cells: [{ heightMm: 2000, selectionId: "sel" }] }] },
        }],
      }],
    }],
    selections: [{ id: "sel", componentTypeId: TYPE, label: "Pane", config }],
    inventory,
  };
}
const CFG = { glassType: "ID1", thickness: "12.76", film: false };
const onlyPane = (body: FormulaSetBody): FormulaSetBody => ({ ...body, formulas: [body.formulas![0]] });

describe("materialMatch in the evaluator", () => {
  test("two matching items bill two raw lines at the full area; byRoom has one entry per item", () => {
    const r = buildMaterials(input(CFG, [cand("G-A", glass.rows), cand("G-B", glass.rows)], onlyPane(MATCH_SET)));
    assert.equal(r.collector.hasAny(), false);
    assert.deepEqual(r.rawLines.map((l) => [l.code, l.requirement, l.viaMatch]), [["G-A", 2, true], ["G-B", 2, true]]);
    assert.deepEqual(r.byRoom[0].lines.map((l) => l.code), ["G-A", "G-B"]);
  });

  test("zero match: UNRESOLVED_MATCH, INVENTORY scope, names the choices; calc.* readers see no noise", () => {
    const r = buildMaterials(input(CFG, [cand("G-X", { glassType: "ID9" })]));
    const problems = r.collector.report().problems;
    assert.deepEqual(problems.map((p) => p.kind), ["UNRESOLVED_MATCH"]);
    assert.equal(problems[0].scope, "INVENTORY");
    assert.equal(problems[0].message, "No active GLASS inventory item matches ID1");
    assert.equal(problems[0].matchChoices, "ID1");
    assert.equal(problems[0].occurrenceCount, 2, "two formulas fired for the one cell");
  });

  test("choices list the visible values of fields with Matches rows, in schema order", () => {
    const r = buildMaterials(input(CFG, [cand("G-X", { glassType: "ID9", thickness: "10" })], onlyPane(MATCH_SET)));
    assert.equal(r.collector.report().problems[0].message, "No active GLASS inventory item matches ID1 · 12.76");
  });

  test("only inactive would-match items: INACTIVE_ITEM, no UNRESOLVED_MATCH", () => {
    const r = buildMaterials(input(CFG, [cand("G-OFF", glass.rows, { active: false })], onlyPane(MATCH_SET)));
    assert.deepEqual(r.collector.report().problems.map((p) => [p.kind, p.code]), [["INACTIVE_ITEM", "G-OFF"]]);
  });

  test("an active match wins over an inactive one (inactive is not reported)", () => {
    const r = buildMaterials(input(CFG, [cand("G-ON", glass.rows), cand("G-OFF", glass.rows, { active: false })], onlyPane(MATCH_SET)));
    assert.equal(r.collector.hasAny(), false);
    assert.deepEqual(r.rawLines.map((l) => l.code), ["G-ON"]);
  });

  test("no inventory given (absent) = no candidates", () => {
    const r = buildMaterials({ ...input(CFG, []), inventory: undefined });
    assert.ok(r.collector.report().problems.some((p) => p.kind === "UNRESOLVED_MATCH"));
  });

  test("PARTITION grain matches too", () => {
    const body: FormulaSetBody = {
      schemaVersion: 2, slots: { GLASS: { role: "glass" } },
      formulas: [{ id: "pane", slot: "GLASS", grain: "PARTITION", materialMatch: { itemType: "GLASS" }, unit: "m²", quantity: "partition.widthMm * partition.heightMm / 1000000" }],
    };
    const r = buildMaterials(input(CFG, [cand("G-A", glass.rows)], body));
    assert.deepEqual(r.rawLines.map((l) => [l.code, l.requirement]), [["G-A", 2]]);
  });

  test("a materialCode formula is unchanged", () => {
    const body: FormulaSetBody = {
      schemaVersion: 2, slots: { GLASS: { role: "glass", requiredParams: [{ key: "glassType" }] } },
      formulas: [{ id: "byCode", slot: "GLASS", grain: "CELL", materialCode: "{param.glassType}", unit: "pieces", quantity: "1" }],
    };
    const r = buildMaterials(input(CFG, [], body));
    assert.deepEqual(r.rawLines.map((l) => [l.code, l.viaMatch]), [["ID1", undefined]]);
  });
});

// ─── Resolver: S37-4 and per-item rounding ────────────────────────────────────

const inv = (over: Partial<InventoryRow> = {}): InventoryRow => ({
  name: "Item", measurementUnit: "m²", perUnitQuantity: 1, active: true, componentTypeId: TYPE, soldInWholePacks: true, ...over,
});
const line = (code: string, requirement: number, viaMatch?: boolean) => ({
  code, unit: "m²", requirement, slot: "GLASS", formulaId: "glassPane", roomId: "r1", partitionId: "p1", viaMatch,
});
const labels = new Map([["r1", "Room 1"]]);
const plabels = new Map([["p1", "Wall 1"]]);

describe("resolveAndAggregate with matches (S37-4)", () => {
  const map = new Map([["G-A", inv({ rows: { glassType: "ID1" } })], ["PLAIN", inv()]]);

  test("a code line naming an item with rows is UNRESOLVED_CODE; the same item resolves via match", () => {
    const c = new ProblemCollector();
    const out = resolveAndAggregate([line("G-A", 2)], map, c, labels, plabels);
    assert.equal(out.length, 0);
    const p = c.report().problems[0];
    assert.equal(p.kind, "UNRESOLVED_CODE");
    assert.match(p.message, /billed by match only/);

    const c2 = new ProblemCollector();
    const out2 = resolveAndAggregate([line("G-A", 2, true)], map, c2, labels, plabels);
    assert.equal(c2.hasAny(), false);
    assert.deepEqual(out2.map((l) => [l.code, l.quantity]), [["G-A", 2]]);
  });

  test("an item without rows still resolves by code", () => {
    const c = new ProblemCollector();
    const out = resolveAndAggregate([line("PLAIN", 1.5)], map, c, labels, plabels);
    assert.equal(c.hasAny(), false);
    assert.equal(out[0].quantity, 2);
  });

  test("match lines round per item on the project total (whole packs on and off)", () => {
    const m = new Map([
      ["W", inv({ rows: { a: "1" }, perUnitQuantity: 3, soldInWholePacks: true })],
      ["X", inv({ rows: { a: "1" }, perUnitQuantity: 3, soldInWholePacks: false })],
    ]);
    const c = new ProblemCollector();
    const out = resolveAndAggregate([line("W", 27.3, true), line("X", 27.3, true)], m, c, labels, plabels);
    assert.deepEqual(out.map((l) => [l.code, l.quantity]), [["W", 10], ["X", 9.1]]);
  });
});

describe("UNRESOLVED_MATCH dedupe", () => {
  const add = (c: ProblemCollector, choices: string) =>
    c.add({ kind: "UNRESOLVED_MATCH", scope: "INVENTORY", message: `m ${choices}`, matchChoices: choices, locus: { componentTypeCode: "GLASS" } });
  test("identical choices collapse with an accumulated count; different choices stay separate", () => {
    const c = new ProblemCollector();
    add(c, "ID1 · 12.76");
    add(c, "ID1 · 12.76");
    add(c, "ID2");
    const ps = c.report().problems;
    assert.equal(ps.length, 2);
    assert.equal(ps.find((p) => p.matchChoices === "ID1 · 12.76")?.occurrenceCount, 2);
  });
});
