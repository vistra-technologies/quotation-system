import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOrgInScope, assertSweepPrefix, assertDeletableInquiry, scopedOp, assertRowInScope, SCOPED_OPS, matchesSweepPrefix, normalizeSweepCode } from "../regression/fixtures/db-scope";

test("assertOrgInScope accepts only the Test Org and rgr- orgs", () => {
  for (const ok of ["e2e-testorg", "rgr-x-b", "rgr-abc"]) assert.doesNotThrow(() => assertOrgInScope(ok));
  for (const bad of ["", "cloisons", "vistra", "rgr-", "rgr", "e2e-testorg2", "E2E-TESTORG", "x-rgr-a", "e2e-other"]) {
    assert.throws(() => assertOrgInScope(bad), /refused/, bad);
  }
});

test("assertSweepPrefix requires rgr- or e2e-", () => {
  for (const ok of ["rgr-", "rgr-x", "e2e-", "e2e-sa-"]) assert.doesNotThrow(() => assertSweepPrefix(ok));
  for (const bad of ["", "e2e", "rgr", "r", "cloisons", "x-rgr-"]) assert.throws(() => assertSweepPrefix(bad), /refused/, bad);
});

test("assertDeletableInquiry: null → false, rgr- → true, anything else throws", () => {
  assert.equal(assertDeletableInquiry(null), false);
  assert.equal(assertDeletableInquiry({ name: "rgr-inq-1" }), true);
  assert.throws(() => assertDeletableInquiry({ name: "Real customer inquiry" }), /refused/);
  assert.throws(() => assertDeletableInquiry({ name: "" }), /refused/);
});

test("scopedOp maps rgr: ops to their base op and rejects unknown rgr: ops; legacy ops are unscoped", () => {
  assert.deepEqual(scopedOp("rgr:setProjectStatus"), { base: "setProjectStatus", model: "project", idKey: "projectId" });
  assert.deepEqual(scopedOp("rgr:seedV1Design"), { base: "seedV1Design", model: "partition", idKey: "partitionId" });
  assert.deepEqual(Object.values(SCOPED_OPS).map((s) => s.base).sort(), ["insertCalculation", "seedV1Design", "setDesignSubmittedAt", "setProjectStatus", "setSelectionConfig"]);
  assert.equal(scopedOp("setProjectStatus"), null);
  assert.throws(() => scopedOp("rgr:dropEverything"), /refused/);
});

test("assertRowInScope: the row must exist and live in the Test Org or an rgr- org", () => {
  assert.doesNotThrow(() => assertRowInScope("rgr:setProjectStatus", "p1", "e2e-testorg"));
  assert.doesNotThrow(() => assertRowInScope("rgr:seedV1Design", "x", "rgr-abc-b"));
  assert.throws(() => assertRowInScope("rgr:setProjectStatus", "p1", "cloisons"), /refused/);
  assert.throws(() => assertRowInScope("rgr:setProjectStatus", "p1", "acme-glass"), /refused/);
  assert.throws(() => assertRowInScope("rgr:setProjectStatus", "p1", null), /not found/);
  assert.throws(() => assertRowInScope("rgr:setProjectStatus", "", "e2e-testorg"), /needs a row id/);
  assert.throws(() => assertRowInScope("rgr:setProjectStatus", 5, "e2e-testorg"), /needs a row id/);
});

test("matchesSweepPrefix: case- and padding-tolerant, still anchored at the start; labels normalised", () => {
  const p = "rgr-murx0cvz-";
  for (const ok of ["rgr-murx0cvz-inv-a1", "RGR-MURX0CVZ-INV-A1", "  rgr-murx0cvz-x  ", "Rgr-Murx0cvz-"]) assert.equal(matchesSweepPrefix(ok, p), true, ok);
  for (const bad of ["rgr-otherrun-inv", "x-rgr-murx0cvz-inv", "GLASS-WSEAL-01", "rgr-murx0cv"]) assert.equal(matchesSweepPrefix(bad, p), false, bad);
  assert.equal(matchesSweepPrefix("RGR-ANY-thing", "rgr-"), true); // recovery's generic prefix
  assert.equal(normalizeSweepCode("  RGR-MURX0CVZ-INV-A1 "), "rgr-murx0cvz-inv-a1");
});

test("addAllowedCodes adds rgr- codes under the parent branch, idempotently; refuses non-rgr codes and non-dependent fields", async () => {
  const { addAllowedCodes } = await import("../regression/fixtures/db-scope");
  const cfg = { u_profile: { valueMap: { ID1: ["GLASS-U-01"], ID2: ["X"] } }, category: { options: ["Single"] } };
  const once = addAllowedCodes(cfg, "ID1", { u_profile: "rgr-abc-1" });
  assert.deepEqual(once.u_profile.valueMap, { ID1: ["GLASS-U-01", "rgr-abc-1"], ID2: ["X"] });
  assert.deepEqual(addAllowedCodes(once, "ID1", { u_profile: "rgr-abc-1" }), once);
  assert.deepEqual(cfg.u_profile.valueMap.ID1, ["GLASS-U-01"]); // input untouched
  assert.throws(() => addAllowedCodes(cfg, "ID1", { u_profile: "GLASS-U-99" }), /not an rgr- code/);
  assert.throws(() => addAllowedCodes(cfg, "ID1", { category: "rgr-abc-2" }), /no valueMap/);
  assert.throws(() => addAllowedCodes(cfg, "ID1", { nope: "rgr-abc-2" }), /no valueMap/);
});

test("stripPrefixedCodes removes exactly the prefixed values, so add then strip restores the original", async () => {
  const { addAllowedCodes, stripPrefixedCodes } = await import("../regression/fixtures/db-scope");
  const cfg = { u_profile: { valueMap: { ID1: ["GLASS-U-01"] } }, door: { valueMap: { "Simple Glass": ["D-1"] } }, category: { options: ["Single"] } };
  const added = addAllowedCodes(addAllowedCodes(cfg, "ID1", { u_profile: "rgr-run1-a" }), "Simple Glass", { door: "RGR-RUN2-B" });
  const only1 = stripPrefixedCodes(added, "rgr-run1-");
  assert.equal(only1.removed, 1);
  assert.deepEqual(only1.cfg.door.valueMap, { "Simple Glass": ["D-1", "RGR-RUN2-B"] });
  const all = stripPrefixedCodes(added, "rgr-");
  assert.equal(all.removed, 2);
  assert.deepEqual(all.cfg, cfg);
});
