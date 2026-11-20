import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToFixed, decimalToCents, parseMoneyToCents, toFixed2, MAX_CENTS } from "../../lib/money";

test("parseMoneyToCents: numbers and numeric strings, up to 2 dp", () => {
  assert.equal(parseMoneyToCents(2800), 280000);
  assert.equal(parseMoneyToCents("2800.5"), 280050);
  assert.equal(parseMoneyToCents(" 0.07 "), 7);
  assert.equal(parseMoneyToCents(0), 0);
  assert.equal(parseMoneyToCents(19.99), 1999);
  assert.equal(parseMoneyToCents(1.1), 110);
});

test("parseMoneyToCents: rejects negatives, more than 2 dp, exponents, junk, blanks", () => {
  for (const bad of [-1, "-1", 1.005, "1.005", "1e3", 1e21, "", " ", "abc", null, undefined, true, {}, NaN, Infinity, ".5", "5."]) {
    assert.equal(parseMoneyToCents(bad), null, String(bad));
  }
});

test("parseMoneyToCents: bounded by MAX_CENTS", () => {
  assert.equal(parseMoneyToCents(centsToFixed(MAX_CENTS)), MAX_CENTS);
  assert.equal(parseMoneyToCents(centsToFixed(MAX_CENTS + 1)), null);
});

test("centsToFixed always prints 2 dp", () => {
  assert.equal(centsToFixed(280000), "2800.00");
  assert.equal(centsToFixed(7), "0.07");
  assert.equal(centsToFixed(0), "0.00");
  assert.equal(centsToFixed(1999), "19.99");
});

test("decimalToCents / toFixed2 read stored Decimal strings", () => {
  assert.equal(decimalToCents("2800"), 280000);
  assert.equal(toFixed2("2800"), "2800.00");
  assert.equal(toFixed2({ toString: () => "12.5" }), "12.50");
  assert.equal(toFixed2("2800.000000000000000000000000000000"), "2800.00");
});
