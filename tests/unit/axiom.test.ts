import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { axiomEnabled, flushToAxiom } from "@/lib/axiom";

const TOKEN = "xaat-SECRET-token-value";
const env = { AXIOM_TOKEN: TOKEN, AXIOM_DATASET: "easeetool-test" } as unknown as NodeJS.ProcessEnv;
const LINES = [JSON.stringify({ msg: "a" }), JSON.stringify({ msg: "b" })];

let out: string[];
beforeEach(() => {
  out = [];
  mock.method(console, "log", (s: string) => void out.push(s));
  mock.method(console, "error", (s: string) => void out.push(s));
});
afterEach(() => mock.restoreAll());

function fakeFetch(res: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return res();
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("silent no-op when AXIOM_TOKEN or AXIOM_DATASET is missing (no fetch, no log)", async () => {
  for (const e of [{}, { AXIOM_TOKEN: TOKEN }, { AXIOM_DATASET: "d" }, { AXIOM_TOKEN: "", AXIOM_DATASET: "d" }]) {
    const { f, calls } = fakeFetch(async () => new Response("{}"));
    await flushToAxiom(LINES, { fetchImpl: f, env: e as unknown as NodeJS.ProcessEnv });
    assert.equal(calls.length, 0);
  }
  assert.equal(axiomEnabled({} as NodeJS.ProcessEnv), false);
  assert.equal(axiomEnabled(env), true);
  assert.deepEqual(out, []);
});

test("one POST per flush with the whole buffer as a JSON array; nothing for an empty buffer", async () => {
  const { f, calls } = fakeFetch(async () => new Response("{}", { status: 200 }));
  await flushToAxiom(LINES, { fetchImpl: f, env });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.axiom.co/v1/datasets/easeetool-test/ingest?timestamp-field=ts");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), [{ msg: "a" }, { msg: "b" }]);
  assert.deepEqual(out, []);
  await flushToAxiom([], { fetchImpl: f, env });
  assert.equal(calls.length, 1);
});

test("an HTTP failure writes one axiom.flush_failed {status} line, never the token, and does not throw", async () => {
  const { f, calls } = fakeFetch(async () => new Response("denied", { status: 403 }));
  await flushToAxiom(LINES, { fetchImpl: f, env });
  assert.equal(calls.length, 1, "no retry");
  assert.equal(out.length, 1);
  const line = JSON.parse(out[0]);
  assert.equal(line.msg, "axiom.flush_failed");
  assert.equal(line.status, 403);
  assert.ok(!out[0].includes(TOKEN));
});

test("a network error or a timeout is status 0, swallowed, and not retried", async () => {
  let n = 0;
  const f = (async () => {
    n++;
    throw new Error(`boom ${TOKEN}`);
  }) as unknown as typeof fetch;
  await flushToAxiom(LINES, { fetchImpl: f, env });
  assert.equal(n, 1);
  assert.equal(JSON.parse(out[0]).status, 0);
  assert.ok(!out[0].includes(TOKEN));

  out = [];
  const slow = ((_url: string, init: RequestInit) =>
    new Promise((_res, rej) => {
      init.signal!.addEventListener("abort", () => rej(new Error("aborted")));
    })) as unknown as typeof fetch;
  const t0 = Date.now();
  const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout is unref'd; keep the loop alive in the test
  await flushToAxiom(LINES, { fetchImpl: slow, env, timeoutMs: 50 });
  clearTimeout(keepAlive);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(JSON.parse(out[0]).status, 0);
});
