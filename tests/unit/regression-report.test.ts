import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictOf, type ReportData } from "../regression/report/report-data";
import { renderReport } from "../regression/report/render-html";
import { parseUnitCounts, mergeResults, toRow, assembleReportData, type ResultsFile } from "../regression/report/assemble";

const clean = (): Omit<ReportData, "verdict"> => ({
  runId: "r1", startedAt: "2026-10-02T13:00:00Z", durationMs: 372_000, target: "https://test.easeetool.com", commit: "abc1234",
  testOrg: "e2e-testorg", orgB: "rgr-r1-b",
  unit: { total: 10, passed: 10, failed: 0 },
  coverage: { routes: { total: 3, covered: 3 }, pages: { total: 2, covered: 2 }, untested: [], stale: [] },
  areas: [{ name: "users", tests: [{ title: "ok", status: "passed", durationMs: 100, flaky: false }] }],
  cleanup: { created: 2, deleted: ["a", "b"], cleanupErrors: [], strays: [], revertFailures: [], delta: [], revertsOk: [], orgsCompared: 5 },
});

test("verdict is PASS only when everything is clean", () => { assert.equal(verdictOf(clean()), "PASS"); });

test("each of these alone makes the verdict FAIL", () => {
  const cases: Array<[string, (d: Omit<ReportData, "verdict">) => void]> = [
    ["failed test", (d) => { d.areas[0].tests[0].status = "failed"; }],
    ["skipped test (no silent skips)", (d) => { d.areas[0].tests[0].status = "skipped"; }],
    ["unit failure", (d) => { d.unit.failed = 1; }],
    ["untested route", (d) => { d.coverage.untested = ["GET /x"]; }],
    ["stale registration", (d) => { d.coverage.stale = ["GET /gone"]; }],
    ["cleanup error", (d) => { d.cleanup.cleanupErrors = ["x"]; }],
    ["stray row", (d) => { d.cleanup.strays = [{ id: 1 }]; }],
    ["revert failure", (d) => { d.cleanup.revertFailures = ["k"]; }],
    ["other-org delta", (d) => { d.cleanup.delta = ['org "cloisons": project count 5 → 6']; }],
    ["cleanupFailed flag", (d) => { d.cleanup.cleanupFailed = true; }],
    ["a source not produced", (d) => { d.notProduced = ["cleanup"]; }],
    ["no tests ran", (d) => { d.areas = []; }],
  ];
  for (const [name, mutate] of cases) { const d = clean(); mutate(d); assert.equal(verdictOf(d), "FAIL", name); }
});

test("a flaky pass does not fail the run but is rendered", () => {
  const d = clean(); d.areas[0].tests[0].flaky = true;
  assert.equal(verdictOf(d), "PASS");
  assert.match(renderReport({ ...d, verdict: "PASS" }), /flaky/i);
});

test("rendered report: verdict banner, areas, failures with the error, cleanup block, coverage gaps", () => {
  const d = clean();
  d.areas[0].tests.push({ title: "boom", status: "failed", durationMs: 5, flaky: false, error: "Error: expected 1 got 2", trace: "../../test-results/x/trace.zip" });
  d.coverage.untested = ["GET /api/v1/orgs/[orgSlug]/reports"];
  d.cleanup.delta = ['org "cloisons": project count 5 → 6'];
  const html = renderReport({ ...d, verdict: verdictOf(d) });
  assert.match(html, /REGRESSION FAIL/);
  assert.match(html, /users/);
  assert.match(html, /Error: expected 1 got 2/);
  assert.match(html, /href="\.\.\/\.\.\/test-results\/x\/trace\.zip"/);
  assert.match(html, /GET \/api\/v1\/orgs\/\[orgSlug\]\/reports/);
  assert.match(html, /cloisons.*project count 5/);
  assert.match(html, /rgr-r1-b/);
});

test("rendered report is self-contained and escapes every dynamic value", () => {
  const d = clean();
  d.areas[0].tests[0].title = '<script>alert(1)</script> & "q"';
  d.areas[0].tests[0].error = "<img src=x onerror=alert(1)>";
  d.areas[0].tests[0].status = "failed";
  d.areas[0].tests[0].trace = "javascript:alert(1)";
  const html = renderReport({ ...d, verdict: "FAIL" });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\\u003cscript>alert\(1\)\\u003c\/script>/); // embedded JSON: `<` escaped
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /https?:\/\/(fonts|cdn|unpkg|cdnjs)/); // no external requests
  assert.doesNotMatch(html, /<link[^>]+href="http/);
  assert.doesNotMatch(html, /fonts\.googleapis/);
});

test("PASS banner renders when clean", () => { assert.match(renderReport({ ...clean(), verdict: "PASS" }), /REGRESSION PASS/); });

test("a not-produced source is marked in its section and the banner", () => {
  const d = { ...clean(), notProduced: ["cleanup" as const] };
  const html = renderReport({ ...d, verdict: verdictOf(d) });
  assert.match(html, /not produced — see console/);
  assert.match(html, /REGRESSION FAIL/);
});

test("parseUnitCounts reads node:test summary lines (spec reporter and TAP)", () => {
  assert.deepEqual(parseUnitCounts("ℹ tests 12\nℹ suites 0\nℹ pass 11\nℹ fail 1\nℹ cancelled 0"), { total: 12, passed: 11, failed: 1 });
  assert.deepEqual(parseUnitCounts("# tests 4\n# pass 4\n# fail 0\n"), { total: 4, passed: 4, failed: 0 });
  assert.equal(parseUnitCounts("garbage"), null);
  assert.equal(parseUnitCounts(null), null);
  // a crashed/cancelled run counts as failing even if "fail" is 0
  assert.equal(parseUnitCounts("ℹ tests 5\nℹ pass 4\nℹ fail 0\nℹ cancelled 1")!.failed, 1);
});

test("toRow maps Playwright outcomes", () => {
  const r = (outcome: "expected" | "unexpected" | "skipped" | "flaky") => toRow({ id: "i", area: "a", title: "t", outcome, durationMs: 1 });
  assert.deepEqual([r("expected").status, r("expected").flaky], ["passed", false]);
  assert.deepEqual([r("flaky").status, r("flaky").flaky], ["passed", true]);
  assert.equal(r("unexpected").status, "failed");
  assert.equal(r("skipped").status, "skipped");
});

test("mergeResults: a test that failed in the first pass and passed on the re-run is flaky, not failed", () => {
  const prev: ResultsFile = { startedAt: "t0", durationMs: 1000, rows: [
    { id: "1", area: "a", title: "ok", status: "passed", durationMs: 1, flaky: false },
    { id: "2", area: "a", title: "was bad", status: "failed", durationMs: 1, flaky: false, error: "x" },
    { id: "3", area: "a", title: "still bad", status: "failed", durationMs: 1, flaky: false, error: "y" },
  ] };
  const cur: ResultsFile = { startedAt: "t1", durationMs: 500, rows: [
    { id: "2", area: "a", title: "was bad", status: "passed", durationMs: 2, flaky: false },
    { id: "3", area: "a", title: "still bad", status: "failed", durationMs: 2, flaky: false, error: "y2" },
  ] };
  const m = mergeResults(prev, cur);
  assert.equal(m.startedAt, "t0");
  assert.equal(m.durationMs, 1500);
  assert.equal(m.rows.length, 3);
  const by = Object.fromEntries(m.rows.map((r) => [r.id, r]));
  assert.deepEqual([by["2"].status, by["2"].flaky], ["passed", true]);
  assert.deepEqual([by["3"].status, by["3"].error], ["failed", "y2"]);
  assert.deepEqual([by["1"].status, by["1"].flaky], ["passed", false]);
});

const cleanupJson = { runId: "r1", created: 2, deleted: ["a", "b"], cleanupErrors: [], strays: [], delta: [], revertFailures: [], orgsCompared: 5, cleanupFailed: false };
const results: ResultsFile = { startedAt: "2026-10-02T13:00:00Z", durationMs: 1000, rows: [{ id: "1", area: "users", title: "ok", status: "passed", durationMs: 1, flaky: false }] };
const cov = { routes: { total: 3, covered: 3 }, pages: { total: 2, covered: 2 }, untested: [], stale: [] };
const src = { runId: "r1", results, cleanup: cleanupJson, teardown: { runId: "r1", cleanupFailed: false }, unitText: "ℹ tests 3\nℹ pass 3\nℹ fail 0", coverage: cov, target: "https://x.test.easeetool.com/path?token=SECRET", commit: "abc", testOrg: "e2e-testorg" };

test("assembleReportData: all sources good -> PASS; target is host only", () => {
  const d = assembleReportData(src);
  assert.equal(d.verdict, "PASS");
  assert.equal(d.target, "x.test.easeetool.com");
  assert.equal(d.orgB, "rgr-r1-b");
  assert.doesNotMatch(renderReport(d), /SECRET/);
});

test("assembleReportData: missing/malformed sources -> FAIL with the section marked", () => {
  for (const [name, patch, section] of [
    ["results", { results: null }, "results"],
    ["cleanup", { cleanup: null }, "cleanup"],
    ["malformed cleanup", { cleanup: { runId: "r1", created: "x" } }, "cleanup"],
    ["cleanup of another run", { cleanup: { ...cleanupJson, runId: "zzz" } }, "cleanup"],
    ["unit", { unitText: null }, "unit"],
    ["coverage", { coverage: null }, "coverage"],
  ] as const) {
    const d = assembleReportData({ ...src, ...patch });
    assert.equal(d.verdict, "FAIL", name);
    assert.ok(d.notProduced?.includes(section), name);
  }
});

test("assembleReportData: teardown problems fail the run", () => {
  assert.equal(assembleReportData({ ...src, teardown: null }).verdict, "FAIL");
  assert.equal(assembleReportData({ ...src, teardown: { runId: "other", cleanupFailed: false } }).verdict, "FAIL");
  assert.equal(assembleReportData({ ...src, teardown: { runId: "r1", cleanupFailed: true } }).verdict, "FAIL");
});
