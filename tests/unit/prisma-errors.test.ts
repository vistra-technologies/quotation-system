import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniqueViolation, isFkViolation, isRecordNotFound } from "../../lib/prisma-errors";

const withCode = (code: string) => Object.assign(new Error("Invalid `prisma.x.y()` invocation: secret detail"), { code });

test("each guard matches only its own Prisma code", () => {
  assert.equal(isUniqueViolation(withCode("P2002")), true);
  assert.equal(isUniqueViolation(withCode("P2003")), false);
  assert.equal(isFkViolation(withCode("P2003")), true);
  assert.equal(isFkViolation(withCode("P2025")), false);
  assert.equal(isRecordNotFound(withCode("P2025")), true);
  assert.equal(isRecordNotFound(withCode("P2002")), false);
});

test("narrowing is by code only: the message and meta are never consulted", () => {
  const lookalike = new Error("Unique constraint failed on the fields: (`name`)");
  assert.equal(isUniqueViolation(lookalike), false);
  assert.equal(isRecordNotFound(Object.assign(new Error("No record was found"), { meta: { cause: "x" } })), false);
  assert.equal(isUniqueViolation({ code: "P2002" }), true); // plain objects with the code also match
});

test("non-error values never match", () => {
  for (const v of [null, undefined, "P2002", 2002, {}, []]) {
    assert.equal(isUniqueViolation(v), false);
    assert.equal(isFkViolation(v), false);
    assert.equal(isRecordNotFound(v), false);
  }
});
