import { test } from "node:test";
import assert from "node:assert/strict";
import { getContext, runWithContext, setContext, type LogContext } from "@/lib/log-context";

const mk = (id: string): LogContext => ({ requestId: id, route: "r", method: "GET", buffer: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("interleaved runs keep separate contexts across awaits", async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      runWithContext(mk(`req-${i}`), async () => {
        await sleep(Math.random() * 5);
        setContext({ userId: `u-${i}` });
        await sleep(Math.random() * 5);
        await Promise.resolve();
        const c = getContext()!;
        return [c.requestId, c.userId];
      }),
    ),
  );
  results.forEach(([rid, uid], i) => {
    assert.equal(rid, `req-${i}`);
    assert.equal(uid, `u-${i}`);
  });
});

test("setContext outside a run is a no-op and getContext is undefined", () => {
  assert.equal(getContext(), undefined);
  assert.doesNotThrow(() => setContext({ userId: "x" }));
  assert.equal(getContext(), undefined);
});

test("nested run shadows and the outer context is restored", () => {
  runWithContext(mk("outer"), () => {
    runWithContext(mk("inner"), () => {
      assert.equal(getContext()!.requestId, "inner");
      setContext({ userId: "in" });
    });
    assert.equal(getContext()!.requestId, "outer");
    assert.equal(getContext()!.userId, undefined);
  });
});
