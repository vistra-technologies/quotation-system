import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { log, MAX_LINE_BYTES } from "@/lib/logger";
import { DENY_KEYS, redactValue, scrubString, serializeError } from "@/lib/log-redact";
import { runWithContext, type LogContext } from "@/lib/log-context";

// The spec's deny list (S30-7), hard-coded so removing a key from lib/log-redact.ts fails a test.
const SPEC_DENY = [
  "password", "newPassword", "currentPassword", "initialAdminPassword", "token", "accessToken",
  "refreshToken", "secret", "cookie", "set-cookie", "authorization", "username", "email", "phone",
  "ip", "x-forwarded-for", "x-real-ip",
];

const ENV_KEYS = [
  "LOG_LEVEL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA", "DATABASE_URL", "DATABASE_URL_UNPOOLED",
  "BETTER_AUTH_SECRET", "AXIOM_TOKEN", "SUPERADMIN_FOO_PASSWORD",
];
let saved: Record<string, string | undefined>;
let out: string[];
let errOut: string[];

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  out = [];
  errOut = [];
  mock.method(console, "log", (s: string) => void out.push(s));
  mock.method(console, "error", (s: string) => void errOut.push(s));
});
afterEach(() => {
  mock.restoreAll();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const nest = (key: string, depth: number): Record<string, unknown> => {
  let v: Record<string, unknown> = { [key]: "LEAK" };
  for (let i = 1; i < depth; i++) v = { wrap: v };
  return v;
};

test("every deny-listed key is redacted at depths 1-4 and inside arrays, case-insensitively", () => {
  for (const key of SPEC_DENY) {
    for (const k of [key, key.toUpperCase()]) {
      for (let depth = 1; depth <= 4; depth++) {
        assert.ok(!JSON.stringify(redactValue(nest(k, depth))).includes("LEAK"), `${k}@${depth}`);
      }
      assert.ok(!JSON.stringify(redactValue({ list: [{ [k]: "LEAK" }] })).includes("LEAK"), `${k} in array`);
    }
  }
  assert.equal((redactValue({ Authorization: "x" }) as Record<string, string>).Authorization, "[REDACTED]");
  assert.equal((redactValue({ "SET-COOKIE": "x" }) as Record<string, string>)["SET-COOKIE"], "[REDACTED]");
});

test("the deny list is pinned to the spec", () => {
  assert.deepEqual([...DENY_KEYS].sort(), [...SPEC_DENY].sort());
});

test("a value below depth 4 is replaced by [DEPTH], never emitted raw", () => {
  const s = JSON.stringify(redactValue(nest("password", 7)));
  assert.ok(!s.includes("LEAK"));
  assert.ok(s.includes("[DEPTH]"));
});

test("env secrets are scrubbed from msg, string fields and stacks; short/empty values are ignored", () => {
  process.env.DATABASE_URL = "pgsecret-aaa111";
  process.env.DATABASE_URL_UNPOOLED = "pgunpooled-bbb222";
  process.env.BETTER_AUTH_SECRET = "authsecret-ccc333";
  process.env.AXIOM_TOKEN = "axiomtoken-ddd444";
  process.env.SUPERADMIN_FOO_PASSWORD = "sapass-eee555";
  const err = new Error("boom pgsecret-aaa111");
  err.stack = "stack axiomtoken-ddd444 sapass-eee555";
  log.error("msg authsecret-ccc333 pgunpooled-bbb222", { note: "x pgsecret-aaa111 y", err });
  const line = errOut[0];
  for (const v of ["pgsecret-aaa111", "pgunpooled-bbb222", "authsecret-ccc333", "axiomtoken-ddd444", "sapass-eee555"]) {
    assert.ok(!line.includes(v), v);
  }
  process.env.AXIOM_TOKEN = "abc";
  process.env.SUPERADMIN_FOO_PASSWORD = "";
  assert.equal(scrubString("abc and more"), "abc and more");
});

test("postgres URLs are scrubbed in messages and stacks", () => {
  const e = new Error("fail postgresql://u:pw@host/db?x=1 done");
  e.stack = "at postgres://u:pw@h/d";
  const line = JSON.stringify(serializeError(e)) + scrubString("postgres://a:b@c/d");
  assert.ok(!line.includes("pw@"));
  assert.ok(!line.includes("a:b@"));
});

test("Prisma-shaped errors log only name, prismaCode and model", () => {
  const e = Object.assign(new Error("Unique constraint failed on SECRET-USER-VALUE"), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: { target: ["SECRET-USER-VALUE"], modelName: "Project" },
  });
  assert.deepEqual(serializeError(e), { name: "PrismaClientKnownRequestError", prismaCode: "P2002", model: "Project" });
  log.error("db", { err: e });
  assert.ok(!errOut[0].includes("SECRET-USER-VALUE"));
});

test("plain errors: stack capped at 6 KB, cause one level only, non-Error throws survive", () => {
  const e = new Error("outer", { cause: new Error("inner", { cause: new Error("innermost") }) });
  e.stack = "x".repeat(20000);
  const s = serializeError(e);
  assert.equal(s.name, "Error");
  assert.equal(s.stack!.length, 6 * 1024);
  assert.equal(s.cause!.message, "inner");
  assert.equal(s.cause!.cause, undefined);
  assert.deepEqual(serializeError("just a string"), { name: "NonError", message: "just a string" });
  assert.equal(serializeError({ a: 1 }).name, "NonError");
});

test("lines over 8 KB are truncated but remain valid JSON with truncated: true", () => {
  log.info("big", { blob: "y".repeat(20000), status: 200 });
  const big = out[0];
  assert.ok(Buffer.byteLength(big) <= MAX_LINE_BYTES);
  const parsed = JSON.parse(big);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.status, 200);
  log.info("small");
  assert.equal(JSON.parse(out[1]).truncated, undefined);
});

test("level gating: info default, LOG_LEVEL=debug works except in production", () => {
  log.debug("d1");
  assert.equal(out.length, 0);
  process.env.LOG_LEVEL = "debug";
  process.env.VERCEL_ENV = "preview";
  log.debug("d2");
  assert.equal(out.length, 1);
  process.env.VERCEL_ENV = "production";
  log.debug("d3");
  assert.equal(out.length, 1);
});

test("routing and shape: info -> console.log, warn/error -> console.error, one JSON line per call", () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
  log.info("i");
  log.warn("w");
  log.error("e");
  assert.equal(out.length, 1);
  assert.equal(errOut.length, 2);
  const p = JSON.parse(out[0]);
  assert.equal(p.level, "info");
  assert.equal(p.msg, "i");
  assert.equal(p.env, "preview");
  assert.equal(p.commit, "abcdef1");
  assert.ok(typeof p.ts === "string");
  assert.equal("requestId" in p, false);
});

test("never throws: circular, BigInt and throwing-getter fields", () => {
  const circ: Record<string, unknown> = {};
  circ.self = circ;
  const getter = {};
  Object.defineProperty(getter, "boom", { enumerable: true, get() { throw new Error("nope"); } });
  assert.doesNotThrow(() => log.info("x", { circ, n: BigInt(5), getter }));
  assert.equal(out.length, 1);
  JSON.parse(out[0]);
});

test("inside a context the line carries identity and is buffered (cap 200)", () => {
  const ctx: LogContext = {
    requestId: "r1", parentRequestId: "p1", route: "GET /x", method: "GET",
    orgSlug: "o", userId: "u", saId: "s", buffer: [],
  };
  runWithContext(ctx, () => {
    log.info("hello");
    const p = JSON.parse(out[0]);
    assert.deepEqual(
      [p.requestId, p.parentRequestId, p.route, p.method, p.orgSlug, p.userId, p.saId],
      ["r1", "p1", "GET /x", "GET", "o", "u", "s"],
    );
    assert.equal(ctx.buffer.length, 1);
    for (let i = 0; i < 300; i++) log.info("many");
    assert.equal(ctx.buffer.length, 200);
  });
});
