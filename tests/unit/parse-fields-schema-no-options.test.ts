import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFieldsSchema as parseOrg } from "@/lib/parse-field-config";
import { parseFieldsSchema as parseSa } from "@/lib/data/superadmin/component-types";

// Stage 35 S35-0: a stored `options` key is never emitted on read; all other keys are unchanged.
const stored = [
  { key: "a", label: "A", type: "dropdown", required: true, basic: false, hint: "h", options: ["x", "y"] },
  { key: "b", label: "B", type: "radio", required: false, basic: true, dependsOn: "a", options: ["z"] },
  { key: "c", label: "C", type: "field", required: false, basic: true, options: ["q"] },
];
const expected = [
  { key: "a", label: "A", type: "dropdown", required: true, basic: false, hint: "h" },
  { key: "b", label: "B", type: "radio", required: false, basic: true, dependsOn: "a" },
  { key: "c", label: "C", type: "field", required: false, basic: true },
];

for (const [name, parse] of [["org parseFieldsSchema", parseOrg], ["superadmin parseFieldsSchema", parseSa]] as const) {
  test(`${name} drops a stored options key and keeps every other key`, () => {
    const out = parse(stored);
    assert.deepEqual(out, expected);
    for (const f of out) assert.equal(Object.prototype.hasOwnProperty.call(f, "options"), false);
  });
}

// Stage 35 S35-1: both parsers pass showWhen / inventoryLinked through (round trip); `false` and malformed shapes stay absent.
for (const [name, parse] of [["org parseFieldsSchema", parseOrg], ["superadmin parseFieldsSchema", parseSa]] as const) {
  test(`${name} round-trips showWhen and inventoryLinked`, () => {
    const gated = [
      { key: "a", label: "A", type: "dropdown", required: false, basic: true, inventoryLinked: true },
      { key: "b", label: "B", type: "field", required: false, basic: true, showWhen: { field: "a", in: ["X", "Y"] } },
    ];
    assert.deepEqual(parse(gated), gated);
    assert.deepEqual(parse(parse(gated)), gated);
  });
  test(`${name} keeps inventoryLinked false and a malformed showWhen absent`, () => {
    const out = parse([
      { key: "a", label: "A", type: "dropdown", inventoryLinked: false, showWhen: { field: "", in: ["x"] } },
      { key: "b", label: "B", type: "field", showWhen: "a" },
      { key: "c", label: "C", type: "field", showWhen: { field: "a", in: [1] } },
    ]);
    for (const f of out) {
      assert.equal("inventoryLinked" in f, false);
      assert.equal("showWhen" in f, false);
    }
  });
}
