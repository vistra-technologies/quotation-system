import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, secretsFromEnv, MASK } from "../regression/report/redact";
import { assembleReportData, reportExitCode, parseUnitCounts, deepRedact, type ResultsFile } from "../regression/report/assemble";
import { renderReport } from "../regression/report/render-html";

const gone = (out: string, secret: string) => assert.ok(!out.includes(secret), `still contains ${secret}: ${out}`);

test("header lines are masked (cookie, set-cookie, authorization, bypass)", () => {
  const input = [
    "Cookie: __Secure-qs.session_token=abc123; other=zzz",
    "set-cookie: qs-sa-token=sat999; Path=/",
    "Authorization: Basic dXNlcjpwYXNz",
    "x-vercel-protection-bypass: bypassvalue1",
    "  x-vercel-set-bypass-cookie: true",
  ].join("\n");
  const out = redact(input);
  for (const s of ["abc123", "zzz", "sat999", "dXNlcjpwYXNz", "bypassvalue1"]) gone(out, s);
  assert.match(out, /Cookie: \[REDACTED\]/);
});

test("quoted header objects are masked", () => {
  const out = redact(`headers: { 'cookie': 'a=secretcookie', "authorization": "Bearer tok123" }`);
  gone(out, "secretcookie");
  gone(out, "tok123");
});

test("session cookie names, qs-sa-token, token= and bearer tokens are masked", () => {
  gone(redact("GET /x?a=1 with __Secure-qs.session_token=s3ss10n.sig%3D"), "s3ss10n");
  gone(redact("qs.session_token=plainsess; Path=/"), "plainsess");
  gone(redact("qs-sa-token=satoken123"), "satoken123");
  gone(redact("url https://x/y?token=tk_abcdef&b=2"), "tk_abcdef");
  assert.match(redact("url https://x/y?token=tk_abcdef&b=2"), /&b=2/);
  gone(redact("sent Bearer eyJhbGciOi.payload.sig here"), "eyJhbGciOi");
});

test("password values are masked (JSON, escaped JSON, key=value)", () => {
  gone(redact('{"password":"hunter22","username":"u"}'), "hunter22");
  gone(redact('{"newPassword": "n3wpass!", "adminPassword":"adm1n"}'), "n3wpass");
  gone(redact('{"newPassword": "n3wpass!", "adminPassword":"adm1n"}'), "adm1n");
  gone(redact('body: "{\\"password\\":\\"esc4ped\\"}"'), "esc4ped");
  gone(redact("password=hunter22&user=u"), "hunter22");
  assert.match(redact('{"password":"hunter22","username":"u"}'), /"username":"u"/);
});

test("literal env secret values are masked wherever they appear; short/unset ones are ignored", () => {
  const env = { VERCEL_AUTOMATION_BYPASS_SECRET: "byp4ssS3cretXYZ", TEST_SA_PASSWORD: "sa-Pass-123", TEST_ADMIN_PASSWORD: "x", RGR_RUN_PASSWORD: "RunPw!4567" };
  const secrets = secretsFromEnv(env);
  assert.deepEqual(secrets.sort(), ["RunPw!4567", "byp4ssS3cretXYZ", "sa-Pass-123"].sort()); // "x" is too short
  const out = redact("failed with byp4ssS3cretXYZ and sa-Pass-123; again sa-Pass-123 / RunPw!4567", secrets);
  for (const s of secrets) gone(out, s);
  assert.equal((out.match(/\[REDACTED\]/g) ?? []).length, 4);
});

test("normal text is untouched", () => {
  const t = "Error: expect(received).toBe(expected)\nExpected: 2\nReceived: 1\n  at projects.spec.ts:211 — GET /api/v1/orgs/e2e-testorg/projects → 200 token count 5";
  assert.equal(redact(t), t);
  assert.equal(redact("short secret abc", ["abc"]), "short secret abc"); // < 6 chars never masked
  assert.ok(MASK.length > 0);
});

test("assemble redacts titles, errors and cleanup strings before they reach the report", () => {
  const results: ResultsFile = { startedAt: "t", durationMs: 1, rows: [
    { id: "1", area: "a", title: "t", status: "failed", durationMs: 1, flaky: false, error: "Cookie: __Secure-qs.session_token=LEAK1\nbody has LITERALSECRET9" },
  ] };
  const cleanup = { runId: "r1", created: 1, deleted: ["x"], cleanupErrors: ["password=LEAK2"], strays: [{ note: "token=LEAK3" }], delta: [], revertFailures: [], orgsCompared: 1, cleanupFailed: false };
  const d = assembleReportData({
    runId: "r1", results, cleanup, teardown: { runId: "r1", cleanupFailed: false }, unitText: "# tests 1\n# pass 1\n# fail 0",
    coverage: { routes: { total: 1, covered: 1 }, pages: { total: 1, covered: 1 }, untested: [], stale: [] },
    target: "https://t.test.easeetool.com", commit: null, testOrg: "e2e-testorg", secrets: ["LITERALSECRET9"],
  });
  const json = JSON.stringify(d) + renderReport(d);
  for (const s of ["LEAK1", "LEAK2", "LEAK3", "LITERALSECRET9"]) gone(json, s);
  assert.deepEqual(deepRedact({ a: ["password=zzzzzz1"], n: 3 }, []), { a: ["password=[REDACTED]"], n: 3 });
});

test("the Failures card warns that trace.zip may contain request headers", () => {
  const d = assembleReportData({
    runId: "r1", results: { startedAt: "t", durationMs: 1, rows: [{ id: "1", area: "a", title: "t", status: "failed", durationMs: 1, flaky: false, error: "e" }] },
    cleanup: null, teardown: null, unitText: null, coverage: null, target: undefined, commit: null, testOrg: "e2e-testorg",
  });
  assert.match(renderReport(d), /trace\.zip files may contain request headers/);
});

const good = {
  runId: "r1",
  results: { startedAt: "t", durationMs: 1, rows: [{ id: "1", area: "a", title: "t", status: "passed" as const, durationMs: 1, flaky: false }] } as ResultsFile,
  cleanup: { runId: "r1", created: 1, deleted: ["x"], cleanupErrors: [], strays: [], delta: [], revertFailures: [], orgsCompared: 1, cleanupFailed: false },
  teardown: { runId: "r1", cleanupFailed: false },
  unitText: "# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0",
  coverage: { routes: { total: 1, covered: 1 }, pages: { total: 1, covered: 1 }, untested: [], stale: [] },
  target: "https://t.test.easeetool.com", commit: null, testOrg: "e2e-testorg",
};

test("report exit code: 0 only on PASS; skipped test / malformed cleanup / unparseable or skipped unit -> non-zero", () => {
  assert.equal(reportExitCode(assembleReportData(good)), 0);
  const bad: Array<[string, Partial<typeof good>]> = [
    ["skipped test", { results: { ...good.results, rows: [{ ...good.results.rows[0], status: "skipped" }] } }],
    ["malformed cleanup", { cleanup: { runId: "r1", created: "x" } as never }],
    ["unparseable unit", { unitText: "garbage" }],
    ["skipped unit test", { unitText: "# tests 3\n# pass 2\n# fail 0\n# skipped 1" }],
    ["merge source unreadable", { results: { ...good.results, mergeFailed: true } }],
  ];
  for (const [name, patch] of bad) assert.equal(reportExitCode(assembleReportData({ ...good, ...patch })), 1, name);
});

test("skipped unit tests count as failing", () => {
  assert.equal(parseUnitCounts("# tests 3\n# pass 2\n# fail 0\n# skipped 1")!.failed, 1);
});
