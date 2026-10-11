import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reportClientError } from "@/lib/client-error-report";

// reportClientError is browser code: stub the DOM globals it touches.
const g = globalThis as Record<string, unknown>;
const saved: Record<string, PropertyDescriptor | undefined> = {};
const KEYS = ["window", "navigator", "fetch"];
let store: Map<string, string>;
let sent: { url: string; body: Record<string, unknown> }[];

function define(k: string, value: unknown) {
  saved[k] = Object.getOwnPropertyDescriptor(g, k);
  Object.defineProperty(g, k, { value, configurable: true, writable: true });
}

beforeEach(() => {
  store = new Map();
  sent = [];
  define("window", {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    location: { pathname: "/o/admin/x" },
  });
  // No sendBeacon: the reporter falls back to fetch, whose JSON body is easy to capture.
  define("navigator", {});
  define("fetch", (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve(new Response(null, { status: 204 }));
  });
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k]) Object.defineProperty(g, k, saved[k]!);
    else delete g[k];
  }
});

test("no digest: returns a ref and sends it", () => {
  const ref = reportClientError({ message: "boom" }, "admin");
  assert.match(ref ?? "", /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.ref, ref);
  assert.equal(sent[0].body.digest, undefined);
  assert.equal(sent[0].body.path, "/o/admin/x");
});

test("a deduped repeat is not re-sent and returns the same ref", () => {
  const first = reportClientError({ message: "boom" }, "admin");
  const second = reportClientError({ message: "boom" }, "admin");
  assert.equal(sent.length, 1);
  assert.equal(second, first);
});

test("with a digest: no ref is sent or returned, the digest is the reference", () => {
  const ref = reportClientError({ message: "boom", digest: "d123" }, "global");
  assert.equal(ref, undefined);
  assert.equal(sent[0].body.digest, "d123");
  assert.equal("ref" in sent[0].body, false);
  assert.equal(reportClientError({ message: "boom", digest: "d123" }, "global"), undefined);
  assert.equal(sent.length, 1);
});

test("storage blocked: still reports with a fresh ref, never throws", () => {
  (g.window as { sessionStorage: unknown }).sessionStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const ref = reportClientError({ message: "boom" }, "admin");
  assert.ok(ref);
  assert.equal(sent[0].body.ref, ref);
});

test("no window (server): returns undefined without sending", () => {
  delete g.window;
  assert.equal(reportClientError({ message: "boom" }, "admin"), undefined);
  assert.equal(sent.length, 0);
});
