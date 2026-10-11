import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { withRoute, withAction, setActionIdentityResolver } from "@/lib/with-route";
import { setContext } from "@/lib/log-context";
import { apiServerError } from "@/lib/api-error";

let lines: { stream: "log" | "error"; line: Record<string, unknown> }[];
beforeEach(() => {
  lines = [];
  setActionIdentityResolver(async () => {}); // keep the real session lookup (auth/prisma imports) out of unit tests
  mock.method(console, "log", (s: string) => void lines.push({ stream: "log", line: JSON.parse(s) }));
  mock.method(console, "error", (s: string) => void lines.push({ stream: "error", line: JSON.parse(s) }));
});
afterEach(() => {
  mock.restoreAll();
  setActionIdentityResolver();
});

const req = (headers: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request("http://localhost/api/x", { headers, ...init });
const terminal = (msg: string) => lines.filter((l) => l.line.msg === msg);

test("x-request-id is the inbound x-vercel-id, else a UUID", async () => {
  const h = withRoute("GET /x", async () => NextResponse.json({ ok: true }));
  const a = await h(req({ "x-vercel-id": "iad1::abc-123" }));
  assert.equal(a.headers.get("x-request-id"), "abc-123");
  const b = await h(req());
  assert.match(b.headers.get("x-request-id")!, /^[0-9a-f-]{36}$/);
  // only the segment after the last `::` is used; malformed ids fall back to a UUID
  const d = await h(req({ "x-vercel-id": "bom1:iad1::iad1::xyz-9" }));
  assert.equal(d.headers.get("x-request-id"), "xyz-9");
  for (const bad of ["bom1::", "bom1::a b", "bom1::" + "a".repeat(129)]) {
    assert.match((await h(req({ "x-vercel-id": bad }))).headers.get("x-request-id")!, /^[0-9a-f-]{36}$/);
  }
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

test("withAction: identity is filled on action.end for an action that never reads the session (S30-15)", async () => {
  setActionIdentityResolver(async () => {
    await new Promise((r) => setTimeout(r, 30)); // longer than the (instant) action body: only the wait lets it land
    setContext({ orgSlug: "acme", userId: "u1", username: "alice" });
  });
  await withAction("a#thin", async () => 1)();
  const l = terminal("action.end")[0].line;
  assert.deepEqual([l.orgSlug, l.userId, l.username], ["acme", "u1", "alice"]);
  // also on a throwing action
  lines.length = 0;
  await assert.rejects(() => withAction("a#thinbad", async () => { throw new Error("x"); })());
  assert.equal(terminal("action.end")[0].line.username, "alice");
});

test("withAction: a failing or hanging identity lookup never breaks or long-delays the action", async () => {
  setActionIdentityResolver(async () => { throw new Error("db down"); });
  assert.equal(await withAction("a#f", async () => 7)(), 7);
  assert.equal(terminal("action.end")[0].line.ok, true);
  setActionIdentityResolver(() => { throw new Error("sync throw"); });
  assert.equal(await withAction("a#g", async () => 8)(), 8);
  lines.length = 0;
  setActionIdentityResolver(() => new Promise<void>(() => {}));
  const t0 = Date.now();
  assert.equal(await withAction("a#h", async () => 9)(), 9);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal("userId" in terminal("action.end")[0].line, false);
});

// ---- Stage 32: params / queryIds (S32-3, S32-4) ----
const reqUrl = (url: string) => new Request(url, { headers: { "x-vercel-id": "iad1::p-1" } });
const endLine = () => terminal("request.end")[0].line;
const ok = () => NextResponse.json({ ok: true });
type Ctx = { params?: Promise<unknown> };
const wr = (fn: () => Promise<NextResponse> | NextResponse) =>
  withRoute("GET /x", (async () => fn()) as (r: Request, c?: Ctx) => Promise<NextResponse>);

test("params: id-shaped string params are logged on request.end exactly", async () => {
  const h = wr(async () => ok());
  const params = { orgSlug: "e2e-testorg", projectId: "abc_123" };
  await h(req(), { params: Promise.resolve(params) });
  assert.deepEqual(endLine().params, params);
});

test("params: arrays, 129-char values and values with / or @ are dropped", async () => {
  const h = wr(async () => ok());
  await h(req(), {
    params: Promise.resolve({
      all: ["sign-in", "email"],
      long: "a".repeat(129),
      slash: "a/b",
      at: "a@b",
      keep: "k-1",
    }),
  });
  assert.deepEqual(endLine().params, { keep: "k-1" });
});

test("params: no second argument -> no params key and the handler runs", async () => {
  let ran = false;
  const h = wr(async () => {
    ran = true;
    return ok();
  });
  await h(req());
  assert.equal(ran, true);
  assert.equal("params" in endLine(), false);
});

test("params: a rejecting params promise never fails the request", async () => {
  let ran = false;
  const h = wr(async () => {
    ran = true;
    return ok();
  });
  const rejecting = Promise.reject(new Error("nope"));
  const res = await h(req(), { params: rejecting });
  assert.equal(res.status, 200);
  assert.equal(ran, true);
  assert.equal("params" in endLine(), false);
});

test("queryIds: only *Id keys with id-shaped values are logged; search and page never are", async () => {
  const h = wr(async () => ok());
  await h(reqUrl("http://localhost/api/x?projectId=abc&search=Jane&page=2&floorId=a/b"));
  const line = endLine();
  assert.deepEqual(line.queryIds, { projectId: "abc" });
  const raw = JSON.stringify(lines.map((l) => l.line));
  assert.equal(raw.includes("Jane"), false);
  assert.equal(raw.includes("search"), false);
});

test("queryIds: a crafted or oversized key is dropped, real keys are kept", async () => {
  const h = wr(async () => ok());
  const longKey = "a".repeat(9000) + "Id";
  await h(
    reqUrl(
      `http://localhost/api/x?${encodeURIComponent("jane.doe@example.comId")}=abc&${longKey}=abc` +
        "&orgId=o1&projectId=p1&floorId=f1&roomId=r1&externalCompanyId=c1",
    ),
  );
  const q = endLine().queryIds as Record<string, string>;
  assert.deepEqual(q, { orgId: "o1", projectId: "p1", floorId: "f1", roomId: "r1", externalCompanyId: "c1" });
  const raw = JSON.stringify(lines.map((l) => l.line));
  assert.equal(raw.includes("jane.doe"), false);
  assert.equal(raw.includes("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("queryIds: at most 5 keys", async () => {
  const h = wr(async () => ok());
  await h(reqUrl("http://localhost/api/x?aId=1&bId=2&cId=3&dId=4&eId=5&fId=6&gId=7"));
  assert.equal(Object.keys(endLine().queryIds as object).length, 5);
});

test("params and queryIds are on every line of the request, and survive the 8 KB truncation path", async () => {
  const { log } = await import("@/lib/logger");
  const h = wr(async () => {
    log.info("mid");
    log.error("big", { blob: "x".repeat(20000) });
    return ok();
  });
  await h(reqUrl("http://localhost/api/x?projectId=abc"), { params: Promise.resolve({ orgSlug: "o-1" }) });
  const big = lines.find((l) => l.line.msg === "big")!.line;
  assert.equal(big.truncated, true);
  assert.deepEqual(big.params, { orgSlug: "o-1" });
  assert.deepEqual(big.queryIds, { projectId: "abc" });
  const mid = lines.find((l) => l.line.msg === "mid")!.line;
  assert.deepEqual(mid.params, { orgSlug: "o-1" });
});

test("a caller field named params or queryIds is renamed with the field_ prefix", async () => {
  const { log } = await import("@/lib/logger");
  const h = wr(async () => {
    log.info("custom", { params: "mine", queryIds: "mine" });
    return ok();
  });
  await h(req(), { params: Promise.resolve({ orgSlug: "o-1" }) });
  const l = lines.find((x) => x.line.msg === "custom")!.line;
  assert.equal(l.field_params, "mine");
  assert.equal(l.field_queryIds, "mine");
  assert.deepEqual(l.params, { orgSlug: "o-1" });
});
