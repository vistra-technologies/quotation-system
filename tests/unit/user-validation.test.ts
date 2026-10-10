import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_TOO_SHORT_MESSAGE,
  isValidPassword,
  isValidProfileEmail,
} from "../../lib/user-validation";

test("MIN_PASSWORD_LENGTH is 8 and the message names it", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.equal(PASSWORD_TOO_SHORT_MESSAGE, "Password must be at least 8 characters");
});

test("isValidPassword: 8+ characters of any kind, strings only", () => {
  assert.equal(isValidPassword("12345678"), true);
  assert.equal(isValidPassword("        "), true); // length, not content
  assert.equal(isValidPassword("1234567"), false);
  assert.equal(isValidPassword(""), false);
  for (const bad of [null, undefined, 12345678, {}, ["12345678"]]) {
    assert.equal(isValidPassword(bad), false, String(bad));
  }
});

test("isValidProfileEmail: null, undefined and blank are allowed", () => {
  assert.equal(isValidProfileEmail(null), true);
  assert.equal(isValidProfileEmail(undefined), true);
  assert.equal(isValidProfileEmail(""), true);
  assert.equal(isValidProfileEmail("   "), true);
});

test("isValidProfileEmail: accepts a@b.c shapes (trimmed)", () => {
  assert.equal(isValidProfileEmail("ada@example.com"), true);
  assert.equal(isValidProfileEmail("  ada@example.com  "), true);
  assert.equal(isValidProfileEmail("a.b+tag@sub.example.co.uk"), true);
});

test("isValidProfileEmail: rejects malformed addresses", () => {
  for (const bad of ["not-an-email", "a@b", "@b.com", "a@.com", "a b@c.com", "a@b@c.com", "a@b. c"]) {
    assert.equal(isValidProfileEmail(bad), false, bad);
  }
});
