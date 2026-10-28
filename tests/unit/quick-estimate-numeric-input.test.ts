import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainNonNegativeNumber } from "@/lib/numeric-input";

test("accepts plain non-negative numbers", () => {
  for (const s of ["0", "5", "12.50", ".5", "5.", "1000000"]) assert.equal(isPlainNonNegativeNumber(s), true, s);
});

test("rejects signs, exponents, separators and junk", () => {
  for (const s of ["-5", "+5", "1e3", "1E3", "", " ", "1,000", "abc", "1.2.3", "--", "5-", " 5", "5 ", " 7 "]) {
    assert.equal(isPlainNonNegativeNumber(s), false, s);
  }
});
