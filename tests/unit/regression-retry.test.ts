import { test } from "node:test";
import assert from "node:assert/strict";
import { retryTransient, isTransientStatus } from "../regression/fixtures/retry";

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
