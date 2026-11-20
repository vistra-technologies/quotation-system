/**
 * Unit tests for lib/units.ts (Stage 37 Q-D23, Q-D25): the unit list, label format and `ft²` / `roll`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MEASUREMENT_UNITS, isMeasurementUnit, packLabel, unitForQuantity, unitSymbol } from "../../lib/units";

test("every label has the form `symbol (Name)`", () => {
  for (const u of MEASUREMENT_UNITS) {
    assert.match(u.label, /^\S+ \([A-Z][a-z]+( [a-z]+)?\)$/, u.label);
  }
});

test("no label contains an em dash or an en dash", () => {
  for (const u of MEASUREMENT_UNITS) {
    assert.ok(!/[\u2013\u2014]/.test(u.label), u.label);
  }
});

test("labels match the Q-D25 wording", () => {
  const labels = Object.fromEntries(MEASUREMENT_UNITS.map((u) => [u.value, u.label]));
  assert.deepEqual(labels, {
    metres: "m (Metre)",
    pieces: "pc (Pieces)",
    "m²": "m² (Square metre)",
    mm: "mm (Millimetre)",
    ft: "ft (Feet)",
    "ft²": "ft² (Square feet)",
    set: "set (Sets)",
    roll: "roll (Rolls)",
  });
});

test("ft² and roll are valid units; unknown values are not", () => {
  assert.equal(isMeasurementUnit("ft²"), true);
  assert.equal(isMeasurementUnit("roll"), true);
  assert.equal(isMeasurementUnit("kg"), false);
  assert.equal(isMeasurementUnit(undefined), false);
});

test("unit values are unique", () => {
  const values = MEASUREMENT_UNITS.map((u) => u.value);
  assert.equal(new Set(values).size, values.length);
});

test("unitSymbol covers every unit; an unknown legacy value is shown as stored", () => {
  assert.deepEqual(MEASUREMENT_UNITS.map((u) => unitSymbol(u.value)), ["m", "pc", "m²", "mm", "ft", "ft²", "set", "roll"]);
  assert.equal(unitSymbol("kg"), "kg");
});

test("packLabel: singular at 1, plural sets and rolls above 1, symbols unchanged", () => {
  assert.equal(packLabel("metres", 1), "1 m");
  assert.equal(packLabel("metres", "2.5000"), "2.5 m");
  assert.equal(packLabel("set", 1), "1 set");
  assert.equal(packLabel("set", 3), "3 sets");
  assert.equal(packLabel("roll", "25"), "25 rolls");
  assert.equal(packLabel("m²", 4), "4 m²");
  assert.equal(packLabel("pieces", 1000), "1,000 pc");
  assert.equal(unitForQuantity("roll", 0.5), "roll");
});
