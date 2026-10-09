import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { withRoute, withAction } from "@/lib/with-route";
import { apiServerError } from "@/lib/api-error";

let lines: { stream: "log" | "error"; line: Record<string, unknown> }[];
beforeEach(() => {
  lines = [];
  mock.method(console, "log", (s: string) => void lines.push({ stream: "log", line: JSON.parse(s) }));
  mock.method(console, "error", (s: string) => void lines.push({ stream: "error", line: JSON.parse(s) }));
});
afterEach(() => mock.restoreAll());

const req = (headers: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request("http://localhost/api/x", { headers, ...init });
const terminal = (msg: string) => lines.filter((l) => l.line.msg === msg);

test("x-request-id is the inbound x-vercel-id, else a UUID", async () => {
  const h = withRoute("GET /x", async () => NextResponse.json({ ok: true }));
  const a = await h(req({ "x-vercel-id": "iad1::abc-123" }));
  assert.equal(a.headers.get("x-request-id"), "iad1::abc-123");
  const b = await h(req());
  assert.match(b.headers.get("x-request-id")!, /^[0-9a-f-]{36}$/);
  // a client-supplied x-request-id is never used
  const c = await h(req({ "x-request-id": "evil" }));
  assert.notEqual(c.headers.get("x-request-id"), "evil");
});

test("an unhandled throw becomes a 500 with requestId and exactly one request.unhandled line", async () => {
  const h = withRoute("GET /x", async () => {
    throw new Error("kaboom");
  });
  const res = await h(req({ "x-vercel-id": "id-1" }));
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "Internal server error", requestId: "id-1" });
  assert.equal(res.headers.get("x-request-id"), "id-1");
  assert.equal(terminal("request.unhandled").length, 1);
  assert.equal(terminal("request.end").length, 0);
  const err = terminal("request.unhandled")[0].line.err as { stack: string };
  assert.match(err.stack, /kaboom/);
});

test("redirect() and notFound() thrown from a handler are rethrown and not logged as errors", async () => {
  const r = withRoute("GET /x", async () => {
    redirect("/elsewhere");
  });
  await assert.rejects(() => r(req()), (e: { digest?: string }) => String(e.digest).startsWith("NEXT_REDIRECT"));
  const n = withRoute("GET /x", async () => {
    notFound();
  });
  await assert.rejects(() => n(req()), (e: { digest?: string }) => String(e.digest).includes("404"));
  assert.equal(terminal("request.unhandled").length, 0);
  assert.equal(lines.filter((l) => l.stream === "error").length, 0);
});

test("x-parent-request-id is logged when valid and ignored when not", async () => {
  const h = withRoute("GET /x", async () => NextResponse.json({}));
  await h(req({ "x-parent-request-id": "iad1::p-1" }));
  assert.equal(terminal("request.end")[0].line.parentRequestId, "iad1::p-1");
  lines.length = 0;
  for (const bad of ["has space", "x".repeat(129), "<script>"]) {
    await h(req({ "x-parent-request-id": bad }));
  }
  for (const l of terminal("request.end")) assert.equal("parentRequestId" in l.line, false);
});

test("status to level mapping and request.end fields", async () => {
  const expect: Record<number, "log" | "error"> = { 200: "log", 404: "log", 401: "log", 403: "log" };
  for (const s of [200, 401, 403, 404]) {
    lines.length = 0;
    await withRoute("GET /x", async () => new NextResponse(null, { status: s }))(req());
    assert.equal(terminal("request.end")[0].line.level, "info", String(s));
    assert.equal(terminal("request.end")[0].stream, expect[s]);
  }
  for (const s of [400, 409, 413, 422, 429]) {
    lines.length = 0;
    await withRoute("GET /x", async () => new NextResponse(null, { status: s }))(req());
    assert.equal(terminal("request.end")[0].line.level, "warn", String(s));
  }
  lines.length = 0;
  await withRoute("POST /y", async () => new NextResponse(null, { status: 503 }))(req({}, { method: "POST" }));
  const l = terminal("request.end")[0].line;
  assert.equal(l.level, "error");
  assert.equal(l.route, "POST /y");
  assert.equal(l.method, "POST");
  assert.equal(l.status, 503);
  assert.equal(typeof l.durationMs, "number");
});

test("the wrapper does not consume the body", async () => {
  const h = withRoute("POST /x", async (request: Request) => NextResponse.json(await request.json()));
  const res = await h(req({ "content-type": "application/json" }, { method: "POST", body: JSON.stringify({ a: 1 }) }));
  assert.deepEqual(await res.json(), { a: 1 });
});

test("a response with immutable headers still gets x-request-id", async () => {
  const h = withRoute("GET /x", async () => Response.redirect("http://localhost/y", 302));
  const res = await h(req({ "x-vercel-id": "id-9" }));
  assert.equal(res.headers.get("x-request-id"), "id-9");
  assert.equal(res.status, 302);
});

test("handler context argument passes through untouched", async () => {
  const h = withRoute("GET /x/[id]", async (_r: Request, ctx: { params: Promise<{ id: string }> }) =>
    NextResponse.json({ id: (await ctx.params).id }),
  );
  const res = await h(req(), { params: Promise.resolve({ id: "7" }) });
  assert.deepEqual(await res.json(), { id: "7" });
});

test("apiServerError: requestId inside a wrapped request, byte-identical outside", async () => {
  assert.equal(JSON.stringify(await apiServerError().json()), '{"error":"Internal server error"}');
  assert.equal(
    JSON.stringify(await apiServerError("m", "C").json()),
    '{"error":"m","code":"C"}',
  );
  const res = await withRoute("GET /x", async () => apiServerError())(req({ "x-vercel-id": "id-5" }));
  assert.equal(JSON.stringify(await res.json()), '{"error":"Internal server error","requestId":"id-5"}');
});

test("withAction: success logs ok:true; throw logs ok:false and rethrows; redirect is ok with outcome", async () => {
  const ok = withAction("a#ok", async (n: number) => n + 1);
  assert.equal(await ok(1), 2);
  let l = terminal("action.end")[0].line;
  assert.deepEqual([l.ok, l.route, l.method], [true, "a#ok", "ACTION"]);
  assert.match(String(l.requestId), /^[0-9a-f-]{36}$/); // no request scope -> UUID

  lines.length = 0;
  const boom = new Error("action boom");
  await assert.rejects(() => withAction("a#bad", async () => { throw boom; })(), boom);
  l = terminal("action.end")[0].line;
  assert.equal(l.ok, false);
  assert.equal(l.level, "error");
  assert.equal((l.err as { message: string }).message, "action boom");
  assert.equal(terminal("action.end").length, 1);

  lines.length = 0;
  await assert.rejects(() => withAction("a#redir", async () => { redirect("/z"); })());
  l = terminal("action.end")[0].line;
  assert.deepEqual([l.ok, l.outcome, l.level], [true, "redirect", "info"]);

  lines.length = 0;
  await assert.rejects(() => withAction("a#nf", async () => { notFound(); })());
  l = terminal("action.end")[0].line;
  assert.deepEqual([l.ok, l.outcome], [false, "not_found"]);
});
