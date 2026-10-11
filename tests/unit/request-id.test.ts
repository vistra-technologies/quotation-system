import { test } from "node:test";
import assert from "node:assert/strict";
import { parentRequestIdFor } from "@/lib/request-id";

test("parentRequestIdFor: the context id wins over the header", () => {
  assert.equal(parentRequestIdFor("ctx-1", "bom1::abc-123"), "ctx-1");
});

test("parentRequestIdFor: no context uses the segment after the last ::", () => {
  assert.equal(parentRequestIdFor(undefined, "bom1::abc-123"), "abc-123");
  assert.equal(parentRequestIdFor(undefined, "bom1:iad1::iad1::xyz-9"), "xyz-9");
});

test("parentRequestIdFor: a missing or malformed header yields undefined, never a UUID", () => {
  for (const bad of [undefined, null, "", "bom1::", "bom1::a b", "bom1::" + "a".repeat(129)]) {
    assert.equal(parentRequestIdFor(undefined, bad), undefined, String(bad));
  }
});
