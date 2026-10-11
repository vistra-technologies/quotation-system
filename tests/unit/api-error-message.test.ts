import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { apiErrorMessage } from "@/lib/api-error-message";

const FB = "fallback text";

test("a 5xx body (error + requestId) appends the reference", () => {
  assert.equal(
    apiErrorMessage({ error: "Internal server error", requestId: "abc-1" }, FB),
    "Internal server error (Reference: abc-1)",
  );
});

test("a 4xx body (no requestId) never shows a reference", () => {
  assert.equal(apiErrorMessage({ error: "Name is required" }, FB), "Name is required");
});

test("null, a string, an empty object, an empty or non-string error -> the fallback", () => {
  for (const b of [null, undefined, "boom", 5, [], {}, { error: "" }, { error: 5 }]) {
    assert.equal(apiErrorMessage(b, FB), FB, JSON.stringify(b));
  }
});

test("requestId without error -> fallback plus reference", () => {
  assert.equal(apiErrorMessage({ requestId: "abc-1" }, FB), `${FB} (Reference: abc-1)`);
});

test("a malformed requestId (::, spaces, over 128, empty, non-string) adds no reference", () => {
  for (const id of ["a::b", "has space", "x".repeat(129), "", 12, null]) {
    assert.equal(apiErrorMessage({ error: "E", requestId: id }, FB), "E", String(id));
  }
  assert.equal(apiErrorMessage({ error: "E", requestId: "x".repeat(128) }, FB), `E (Reference: ${"x".repeat(128)})`);
});

test("the module has no imports (client-safe, S32-1)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../lib/api-error-message.ts"), "utf8");
  assert.ok(!/^\s*import\s/m.test(src));
});
