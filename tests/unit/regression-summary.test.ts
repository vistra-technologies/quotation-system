import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, type Row } from "../regression/report/summary";

const row = (id: string, outcome: Row["outcome"], area = "a"): Row => ({ id, area, title: id, outcome });
const goodCleanup = { runId: "r1", cleanupFailed: false, created: 3, deleted: ["x", "y", "z"], cleanupErrors: [], strays: [], orgsCompared: 4, delta: [], revertFailures: [] };
const goodTeardown = { runId: "r1", cleanupFailed: false };
const base = { rows: [row("1", "expected")], runId: "r1" as string | undefined, cleanup: goodCleanup as unknown, teardown: goodTeardown as unknown, runStatus: "passed" };

test("all good -> PASS, with real counts", () => {
  const s = buildSummary(base);
  assert.equal(s.pass, true);
  assert.match(s.text, /REGRESSION PASS/);
  assert.match(s.text, /created \/ deleted   : 3 \/ 3/);
  assert.match(s.text, /clean \(4 orgs compared\)/);
});
test("unexpected outcome (incl. test.fail() that passed) fails; expected passes; last retry result wins", () => {
  assert.equal(buildSummary({ ...base, rows: [row("1", "unexpected")] }).pass, false);
  assert.equal(buildSummary({ ...base, rows: [row("1", "unexpected"), row("1", "expected")] }).pass, true);
  assert.equal(buildSummary({ ...base, rows: [row("1", "expected"), row("1", "unexpected")] }).pass, false);
});
test("any skipped test fails the verdict (no silent skips)", () => {
  const s = buildSummary({ ...base, rows: [row("1", "expected"), row("2", "skipped")] });
  assert.equal(s.pass, false);
  assert.match(s.text, /skipped/);
});
test("flaky is reported but not a failure", () => {
  const s = buildSummary({ ...base, rows: [row("1", "flaky")] });
  assert.equal(s.pass, true);
  assert.match(s.text, /Flaky/);
});
test("missing cleanup.json, missing runId, or missing teardown status -> FAIL loudly", () => {
  for (const o of [{ cleanup: null }, { cleanup: undefined }, { runId: undefined }, { teardown: null }]) {
    const s = buildSummary({ ...base, ...o });
    assert.equal(s.pass, false, JSON.stringify(o));
    assert.match(s.text, /REGRESSION FAIL/);
  }
});
test("malformed cleanup fields are UNKNOWN and fail - never default to none/clean", () => {
  for (const k of ["cleanupFailed", "created", "deleted", "cleanupErrors", "strays", "orgsCompared", "delta", "revertFailures"]) {
    const bad: Record<string, unknown> = { ...goodCleanup };
    delete bad[k];
    const s = buildSummary({ ...base, cleanup: bad });
    assert.equal(s.pass, false, k);
    assert.match(s.text, /UNKNOWN \(cleanup\.json malformed\)/, k);
    assert.doesNotMatch(s.text, /REGRESSION PASS/);
  }
  assert.equal(buildSummary({ ...base, cleanup: "garbage" }).pass, false);
});
test("non-empty cleanupErrors/strays/revertFailures/delta, or cleanupFailed -> FAIL", () => {
  for (const o of [{ cleanupErrors: ["boom"] }, { strays: [{ id: 1 }] }, { revertFailures: ["fs"] }, { delta: ["org changed"] }, { cleanupFailed: true }]) {
    assert.equal(buildSummary({ ...base, cleanup: { ...goodCleanup, ...o } }).pass, false, JSON.stringify(o));
  }
});
test("cleanup.json or last-teardown.json from a different run -> FAIL", () => {
  assert.equal(buildSummary({ ...base, cleanup: { ...goodCleanup, runId: "old" } }).pass, false);
  assert.equal(buildSummary({ ...base, teardown: { runId: "old", cleanupFailed: false } }).pass, false);
  assert.equal(buildSummary({ ...base, teardown: { runId: "r1", cleanupFailed: true, reason: "x" } }).pass, false);
});
test("non-passed run status with no test failures still fails", () => {
  assert.equal(buildSummary({ ...base, runStatus: "interrupted" }).pass, false);
});

test("I4: the console summary lists what was not exercised on this target (informational, still PASS)", () => {
  const s = buildSummary({ ...base, rows: [{ ...row("1", "expected"), notExercised: ["path-mode target: no org subdomains"] }, { ...row("2", "expected"), notExercised: ["path-mode target: no org subdomains"] }] });
  assert.equal(s.pass, true);
  assert.match(s.text, /Not exercised on this target:\n  - path-mode target: no org subdomains \(2 tests\)/);
  assert.doesNotMatch(buildSummary(base).text, /Not exercised/);
});
