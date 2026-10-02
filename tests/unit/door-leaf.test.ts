/**
 * Unit tests for lib/door-leaf.ts (Hotfix 2026-10-01 H-2): only an explicit "Yes" is a double leaf.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDoubleLeafConfig } from "../../lib/door-leaf";

test("isDoubleLeafConfig: only isDoubleLeaf === 'Yes' is double", () => {
  assert.equal(isDoubleLeafConfig({ isDoubleLeaf: "Yes" }), true);
  assert.equal(isDoubleLeafConfig({ isDoubleLeaf: "No" }), false);
  assert.equal(isDoubleLeafConfig({ isDoubleLeaf: "" }), false);
  assert.equal(isDoubleLeafConfig({ isDoubleLeaf: true }), false);
  assert.equal(isDoubleLeafConfig({ category: "Double" }), false); // Category is not the signal
  assert.equal(isDoubleLeafConfig({}), false);
  assert.equal(isDoubleLeafConfig(undefined), false);
  assert.equal(isDoubleLeafConfig(null), false);
});
