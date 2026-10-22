import { test } from "node:test";
import assert from "node:assert/strict";
import { retryTransient, isTransientStatus, isConnectionError, retryConnectionError } from "../regression/fixtures/retry";

const seq = (statuses: number[]) => {
  let i = 0;
  return async () => ({ status: statuses[Math.min(i++, statuses.length - 1)], n: i });
};

test("isTransientStatus: 429 and 5xx only", () => {
  for (const s of [429, 500, 502, 503, 599]) assert.equal(isTransientStatus(s), true, String(s));
  for (const s of [200, 201, 400, 401, 403, 404, 409]) assert.equal(isTransientStatus(s), false, String(s));
});

test("retries 429/5xx with the given backoff and returns the first non-transient result", async () => {
  const waits: number[] = [];
  const r = await retryTransient(seq([429, 503, 200]), { delaysMs: [1, 2, 3], sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.status, 200);
  assert.equal(r.n, 3);
  assert.deepEqual(waits, [1, 2]);
});

test("bounded: gives up after delaysMs.length retries and returns the last transient result", async () => {
  const waits: number[] = [];
  const r = await retryTransient(seq([429, 429, 429, 429, 429]), { delaysMs: [1, 2], sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.status, 429);
  assert.equal(r.n, 3);
  assert.deepEqual(waits, [1, 2]);
});

test("a final status (401) is never retried", async () => {
  let slept = false;
  const r = await retryTransient(seq([401, 200]), { delaysMs: [1], sleep: async () => void (slept = true) });
  assert.equal(r.status, 401);
  assert.equal(slept, false);
});

// ── isConnectionError ──────────────────────────────────────────────────────────────────────────────

test("isConnectionError: matches ECONNRESET and friends by message (Playwright-wrapped errors)", () => {
  for (const msg of [
    "apiRequestContext.get: read ECONNRESET",
    "apiRequestContext.post: read ETIMEDOUT",
    "write EPIPE",
    "ECONNREFUSED 127.0.0.1:3000",
  ]) {
    assert.equal(isConnectionError(new Error(msg)), true, msg);
  }
  for (const msg of ["HTTP 429", "fetch failed", "timeout exceeded", "400 Bad Request"]) {
    assert.equal(isConnectionError(new Error(msg)), false, msg);
  }
});

test("isConnectionError: matches by .code property (bare Node errors)", () => {
  const mkErr = (code: string) => Object.assign(new Error("x"), { code });
  for (const code of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]) {
    assert.equal(isConnectionError(mkErr(code)), true, code);
  }
  assert.equal(isConnectionError(mkErr("ENOENT")), false, "ENOENT");
  assert.equal(isConnectionError(new Error("plain")), false, "plain");
  assert.equal(isConnectionError(null), false, "null");
});

// ── retryConnectionError ───────────────────────────────────────────────────────────────────────────

const connErr = () => Object.assign(new Error("apiRequestContext.get: read ECONNRESET"), { code: "ECONNRESET" });

test("retryConnectionError: retries on connection error and returns on success", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await retryConnectionError(
    async () => {
      calls++;
      if (calls < 3) throw connErr();
      return "ok";
    },
    { delaysMs: [1, 2, 3], sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1, 2]);
});

test("retryConnectionError: bounded — gives up and rethrows after delaysMs.length retries", async () => {
  let calls = 0;
  const err = connErr();
  await assert.rejects(
    retryConnectionError(
      async () => {
        calls++;
        throw err;
      },
      { delaysMs: [1, 2], sleep: async () => {} },
    ),
    /ECONNRESET/,
  );
  assert.equal(calls, 3); // 1 initial + 2 retries
});

test("retryConnectionError: does not retry non-connection errors", async () => {
  let calls = 0;
  await assert.rejects(
    retryConnectionError(
      async () => {
        calls++;
        throw new Error("HTTP 400 Bad Request");
      },
      { delaysMs: [1], sleep: async () => {} },
    ),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

test("retryConnectionError: calls onRetry with correct arguments", async () => {
  const retries: Array<{ ms: number; n: number }> = [];
  await assert.rejects(
    retryConnectionError(async () => { throw connErr(); }, {
      delaysMs: [10, 20],
      sleep: async () => {},
      onRetry: (_e, ms, n) => retries.push({ ms, n }),
    }),
  );
  assert.deepEqual(retries, [{ ms: 10, n: 1 }, { ms: 20, n: 2 }]);
});

test("retryConnectionError: succeeds on first attempt without retrying", async () => {
  let calls = 0;
  const result = await retryConnectionError(async () => { calls++; return 42; }, { delaysMs: [1] });
  assert.equal(result, 42);
  assert.equal(calls, 1);
});
