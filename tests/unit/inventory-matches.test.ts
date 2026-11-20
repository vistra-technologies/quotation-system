/**
 * Unit tests for lib/inventory-matches.ts (Stage 37 Batch 2: S37-2 save checks, stale rows, canonical form).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalMatchValue,
  identicalMatchSet,
  readMatchRows,
  staleRows,
  validateMatchAttributes,
  validateMatchRows,
} from "../../lib/inventory-matches";

const fields = [
  { key: "glassType", type: "dropdown" as const },
  { key: "thickness", type: "dropdown" as const, dependsOn: "glassType" },
  { key: "film", type: "checkbox" as const },
  { key: "note", type: "field" as const },
];
const config = {
  glassType: { options: ["ID1", "ID2"] },
  thickness: { valueMap: { ID1: ["12.76"], ID2: ["10"] } },
} as never;

const errs = (attrs: unknown) => validateMatchAttributes(attrs, fields, config);

describe("validateMatchAttributes", () => {
  test("a valid set passes", () => {
    assert.deepEqual(errs({ glassType: "ID1", thickness: "12.76", film: "Yes", note: "12.5" }), []);
    assert.deepEqual(errs({}), []);
  });

  test("unknown field key (exact match only: no trimming)", () => {
    assert.match(errs({ gone: "x" })[0], /unknown field/);
    assert.match(errs({ " glassType": "ID1" })[0], /unknown field/);
  });

  test("dropdown value the org does not offer, including a dependent field's union", () => {
    assert.match(errs({ glassType: "ID9" })[0], /not a value this organization offers/);
    assert.deepEqual(errs({ thickness: "10" }), [], "the union across parent values is offered");
    assert.match(errs({ thickness: "99" })[0], /not a value this organization offers/);
  });

  test("empty values", () => {
    assert.match(errs({ glassType: "" })[0], /needs a value/);
    assert.match(errs({ note: "   " })[0], /needs a value/);
  });

  test("non-canonical numbers and padded text", () => {
    assert.match(errs({ note: "12.760" })[0], /canonical form \(use "12\.76"\)/);
    assert.match(errs({ note: " 12.76" })[0], /canonical form/);
    assert.deepEqual(errs({ note: "1e2" }), [], "non-decimal free text stays verbatim");
  });

  test("checkbox accepts Yes/No only", () => {
    assert.match(errs({ film: "yes" })[0], /Yes or No/);
    assert.deepEqual(errs({ film: "No" }), []);
  });

  test("non-string value and non-object attributes", () => {
    assert.match(errs({ film: true })[0], /must be a string/);
    assert.match(errs([])[0], /must be an object/);
    assert.match(errs("x")[0], /must be an object/);
  });
});

describe("validateMatchRows (drawer array form)", () => {
  test("a duplicate key is reported", () => {
    const e = validateMatchRows([{ key: "glassType", value: "ID1" }, { key: "glassType", value: "ID2" }], fields, config);
    assert.ok(e.some((m) => /more than once/.test(m)));
  });
});

describe("staleRows", () => {
  test("flags a removed field and a removed option, not a healthy row", () => {
    const rows = [
      { key: "gone", value: "x" },
      { key: "glassType", value: "ID9" },
      { key: "glassType", value: "ID1" },
      { key: "note", value: "12.760" },
    ];
    assert.deepEqual(staleRows(rows, fields, config).map((r) => [r.key, r.problem]), [
      ["gone", "FIELD_REMOVED"],
      ["glassType", "VALUE_NOT_OFFERED"],
    ]);
  });
});

describe("canonicalMatchValue / readMatchRows / identicalMatchSet", () => {
  test("canonical forms", () => {
    assert.equal(canonicalMatchValue("12.760", "field"), "12.76");
    assert.equal(canonicalMatchValue(12.5, "field"), "12.5");
    assert.equal(canonicalMatchValue(true, "checkbox"), "Yes");
    assert.equal(canonicalMatchValue("No", "checkbox"), "No");
    assert.equal(canonicalMatchValue("maybe", "checkbox"), null);
    assert.equal(canonicalMatchValue("ID1", "dropdown"), "ID1");
    assert.equal(canonicalMatchValue("", "dropdown"), null);
  });

  test("readMatchRows: only an object of strings counts", () => {
    assert.deepEqual(readMatchRows({ a: "1" }), { a: "1" });
    assert.deepEqual(readMatchRows({ a: 1 }), {});
    assert.deepEqual(readMatchRows(["a"]), {});
    assert.deepEqual(readMatchRows(null), {});
  });

  test("identicalMatchSet is order-insensitive", () => {
    assert.equal(identicalMatchSet({ a: "1", b: "2" }, { b: "2", a: "1" }), true);
    assert.equal(identicalMatchSet({ a: "1" }, { a: "1", b: "2" }), false);
    assert.equal(identicalMatchSet({ a: "1" }, { a: "2" }), false);
  });
});
