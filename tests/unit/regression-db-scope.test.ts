import { test } from "node:test";
import assert from "node:assert/strict";
import { assertOrgInScope, assertSweepPrefix, assertDeletableInquiry } from "../regression/fixtures/db-scope";

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
