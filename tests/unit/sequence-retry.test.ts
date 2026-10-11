import { test } from "node:test";
import assert from "node:assert/strict";
import { withSequenceRetry, SEQUENCE_RETRY_ATTEMPTS } from "../../lib/sequence-retry";

const conflict = () => Object.assign(new Error("Project number conflict"), { code: "SEQUENCE_CONFLICT" });

test("the default is 3 attempts in total", () => {
  assert.equal(SEQUENCE_RETRY_ATTEMPTS, 3);
});

test("returns the first success without retrying", async () => {
  let calls = 0;
  const out = await withSequenceRetry(async () => {
    calls++;
    return "ok";
  });
  assert.equal(out, "ok");
  assert.equal(calls, 1);
});

test("retries on SEQUENCE_CONFLICT and returns the later success", async () => {
  let calls = 0;
  const out = await withSequenceRetry(async () => {
    calls++;
    if (calls < 3) throw conflict();
    return calls;
  });
  assert.equal(out, 3);
  assert.equal(calls, 3);
});

test("stops after 3 attempts and rethrows the last conflict", async () => {
  let calls = 0;
  await assert.rejects(
    withSequenceRetry(async () => {
      calls++;
      throw conflict();
    }),
    (err: unknown) => (err as { code?: string }).code === "SEQUENCE_CONFLICT",
  );
  assert.equal(calls, 3);
});

test("any other error is rethrown at once, without a retry", async () => {
  for (const err of [new Error("boom"), Object.assign(new Error("x"), { code: "P2002" }), "str", null]) {
    let calls = 0;
    await assert.rejects(
      withSequenceRetry(async () => {
        calls++;
        throw err;
      }),
    );
    assert.equal(calls, 1, String(err));
  }
});

test("every attempt calls fn afresh (a new transaction each time)", async () => {
  const seen: number[] = [];
  await withSequenceRetry(async () => {
    seen.push(seen.length + 1);
    if (seen.length < 2) throw conflict();
  });
  assert.deepEqual(seen, [1, 2]);
});

test("maxAttempts is honoured", async () => {
  let calls = 0;
  await assert.rejects(
    withSequenceRetry(async () => {
      calls++;
      throw conflict();
    }, 1),
  );
  assert.equal(calls, 1);
});
