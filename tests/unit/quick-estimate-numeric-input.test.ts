import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainNonNegativeNumber, isBlockedBeforeInput } from "@/lib/numeric-input";

test("accepts plain non-negative numbers", () => {
  for (const s of ["0", "5", "12.50", ".5", "5.", "1000000"]) assert.equal(isPlainNonNegativeNumber(s), true, s);
});

test("rejects signs, exponents, separators and junk", () => {
  for (const s of ["-5", "+5", "1e3", "1E3", "", " ", "1,000", "abc", "1.2.3", "--", "5-", " 5", "5 ", " 7 "]) {
    assert.equal(isPlainNonNegativeNumber(s), false, s);
  }
});

// --- isBlockedBeforeInput ---

test("insertText: blocks blocked chars", () => {
  for (const ch of ["-", "+", "e", "E"]) {
    assert.equal(isBlockedBeforeInput("insertText", ch), true, `should block '${ch}'`);
  }
});

test("insertText: allows digits and decimal point", () => {
  for (const ch of ["0", "5", "9", "."]) {
    assert.equal(isBlockedBeforeInput("insertText", ch), false, `should allow '${ch}'`);
  }
});

test("insertText: null data is not blocked", () => {
  assert.equal(isBlockedBeforeInput("insertText", null), false);
});

test("insertFromDrop: blocks invalid text", () => {
  for (const s of ["-5", "+5", "1e3", "1400--", "", "abc"]) {
    assert.equal(isBlockedBeforeInput("insertFromDrop", s), true, `should block '${s}'`);
  }
});

test("insertFromDrop: allows valid non-negative numbers", () => {
  for (const s of ["1400", "0", "12.50", ".5", "5."]) {
    assert.equal(isBlockedBeforeInput("insertFromDrop", s), false, `should allow '${s}'`);
  }
});

test("other inputTypes are never blocked", () => {
  for (const t of ["insertLineBreak", "deleteContentBackward", "insertCompositionText", ""]) {
    assert.equal(isBlockedBeforeInput(t, "-"), false, `inputType '${t}' should not block`);
  }
});
