import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRateCap, parseClientErrorReport } from "@/lib/client-errors";
import { POST } from "@/app/api/v1/client-errors/route";

test("parseClientErrorReport: exact keys and ranges", () => {
  assert.deepEqual(parseClientErrorReport({ boundary: "global", message: "m" }), { boundary: "global", message: "m" });
  assert.deepEqual(
    parseClientErrorReport({ boundary: "admin", message: "m", digest: "d", path: "/a/b" }),
    { boundary: "admin", message: "m", digest: "d", path: "/a/b" },
  );
  assert.ok(
    parseClientErrorReport({
      boundary: "admin",
      message: "x".repeat(300),
      digest: "d".repeat(64),
      path: "/" + "p".repeat(199),
    }),
  );
  const bad: unknown[] = [
    null, "s", 3, [], [{ boundary: "global", message: "m" }],
    { message: "m" },
    { boundary: "other", message: "m" },
    { boundary: "global" },
    { boundary: "global", message: 5 },
    { boundary: "global", message: "x".repeat(301) },
    { boundary: "global", message: "m", extra: 1 },
    { boundary: "global", message: "m", digest: "d".repeat(65) },
    { boundary: "global", message: "m", digest: 1 },
    { boundary: "global", message: "m", path: "/" + "p".repeat(200) },
    { boundary: "global", message: "m", path: "/a?x=1" },
    { boundary: "global", message: "m", path: "/a#h" },
    { boundary: "global", message: "m", path: "no-slash" },
  ];
  for (const b of bad) assert.equal(parseClientErrorReport(b), null, JSON.stringify(b));
});

test("createRateCap: 60 per minute with an injected clock, window slides", () => {
  let t = 1_000_000;
  const cap = createRateCap(60, 60_000, () => t);
  for (let i = 0; i < 60; i++) assert.equal(cap.tryAccept(), true, `#${i}`);
  assert.equal(cap.tryAccept(), false);
  t += 59_999;
  assert.equal(cap.tryAccept(), false);
  t += 1; // the first 60 are now a full minute old
  assert.equal(cap.tryAccept(), true);
});

// The route handler (withRoute works under node:test; after() is guarded).
let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = [];
  const grab = (s: string) => void lines.push(JSON.parse(s));
  mock.method(console, "log", grab);
  mock.method(console, "error", grab);
});
afterEach(() => mock.restoreAll());

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://app.test/api/v1/client-errors", {
      method: "POST",
      body,
      headers: { host: "app.test", "content-type": "application/json", ...headers },
    }),
  );
const ok = JSON.stringify({ boundary: "global", message: "boom", digest: "123", path: "/x" });

test("204 on a valid report, logs one client.error at error with host, no user id", async () => {
  const r = await post(ok);
  assert.equal(r.status, 204);
  assert.ok(r.headers.get("x-request-id"));
  const ce = lines.filter((l) => l.msg === "client.error");
  assert.equal(ce.length, 1);
  assert.equal(ce[0].level, "error");
  assert.equal(ce[0].host, "app.test");
  assert.equal(ce[0].userId, undefined);
  assert.equal(ce[0].boundary, "global");
});

test("413 over 2 KB by header and by actual body, 400 on bad shape, 403 on foreign Origin", async () => {
  const big = JSON.stringify({ boundary: "global", message: "x", path: "/" + "p".repeat(3000) });
  assert.equal((await post(big)).status, 413);
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post(JSON.stringify({ boundary: "global", message: "m", x: 1 }))).status, 400);
  assert.equal((await post(JSON.stringify([1]))).status, 400);
  assert.equal((await post(ok, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post(ok, { origin: "null" })).status, 403);
  assert.equal((await post(ok, { origin: "https://app.test" })).status, 204);
});

test("a body over 2 KB is cut off even when content-length lies", async () => {
  const big = JSON.stringify({ boundary: "global", message: "x", path: "/" + "p".repeat(3000) });
  const req = new Request("https://app.test/api/v1/client-errors", {
    method: "POST",
    body: big,
    headers: { host: "app.test" },
  });
  Object.defineProperty(req.headers, "get", {
    value: (k: string) => (k === "content-length" ? "10" : k === "host" ? "app.test" : null),
  });
  assert.equal((await POST(req)).status, 413);
});

test("the raw body is never logged", async () => {
  await post(JSON.stringify({ boundary: "global", message: "m", extra: "RAW-SECRET-BODY" }));
  await post(JSON.stringify({ boundary: "global", message: "RAW-SECRET-BODY" + "x".repeat(3000) }));
  assert.ok(!JSON.stringify(lines).includes("RAW-SECRET-BODY"));
});

test("SuperAdmin data-layer failures are logged from result.cause, never result.message", () => {
  const root = path.resolve(__dirname, "../..");
  const files = [
    "app/api/v1/superadmin/orgs/route.ts",
    "app/api/v1/superadmin/orgs/[orgId]/route.ts",
    "app/api/v1/superadmin/orgs/[orgId]/suspend/route.ts",
    "app/api/v1/superadmin/orgs/[orgId]/users/route.ts",
  ];
  let n = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/log\.\w+\([^)]*result\.message/.test(src), f);
    n += (src.match(/err: result\.cause/g) ?? []).length;
    // the response on those paths stays the constant 500
    assert.ok(!/apiServerError\(result\./.test(src), f);
  }
  assert.equal(n, 5);
});
