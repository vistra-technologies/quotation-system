/**
 * Stage 37 Batch 3 review R-B (fix round 2): the problem popup's "Go" link for UNRESOLVED_MATCH must open the
 * Inventory page on the matching type tab (`?type=<code>`), URI-encoded, with the org prefix off a subdomain.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveGoHref } from "../../lib/materials/problem-links";
import type { CalculationProblem } from "../../lib/materials/problems";

const unresolved = (componentTypeCode?: string): CalculationProblem => ({
  kind: "UNRESOLVED_MATCH",
  scope: "INVENTORY",
  message: "No inventory item matches.",
  locus: componentTypeCode ? { componentTypeCode } : {},
});

test("UNRESOLVED_MATCH links to the Inventory type tab", () => {
  assert.equal(resolveGoHref(unresolved("DOOR"), "acme", "p1", true), "/admin/inventory?type=DOOR");
  assert.equal(resolveGoHref(unresolved("DOOR"), "acme", "p1", false), "/acme/admin/inventory?type=DOOR");
});

test("UNRESOLVED_MATCH encodes the code and falls back to the plain page without one", () => {
  assert.equal(resolveGoHref(unresolved("A B&C"), "acme", "p1", true), "/admin/inventory?type=A%20B%26C");
  assert.equal(resolveGoHref(unresolved(), "acme", "p1", true), "/admin/inventory");
});

test("other INVENTORY problems keep the generic link, only when they name a code", () => {
  const base = { kind: "UNRESOLVED_CODE", scope: "INVENTORY", message: "x" } as CalculationProblem;
  assert.equal(resolveGoHref({ ...base, code: "ABC" }, "acme", "p1", true), "/admin/inventory");
  assert.equal(resolveGoHref(base, "acme", "p1", true), null);
});

test("DESIGN and SELECTION deep-link to the partition, FORMULA_SET has no link", () => {
  const d = { kind: "CELL_UNASSIGNED", scope: "DESIGN", message: "x", locus: { partitionId: "w1" } } as CalculationProblem;
  assert.equal(resolveGoHref(d, "acme", "p1", true), "/projects/p1/design?partition=w1");
  const s = { kind: "UNRESOLVED_CODE", scope: "SELECTION", message: "x", locus: { partitionId: "w1", selectionId: "s1" } } as CalculationProblem;
  assert.equal(resolveGoHref(s, "acme", "p1", false), "/acme/projects/p1/design?partition=w1");
  assert.equal(resolveGoHref({ ...d, scope: "FORMULA_SET" }, "acme", "p1", true), null);
});
