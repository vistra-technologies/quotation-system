/**
 * Unit tests for the Stage 34 S34-9 room-partitions cache helpers (lib/room-partitions-cache.ts, D-38).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createRequestTracker,
  findCachedPartition,
  partitionSideIds,
  patchPartitionInCache,
  roomSignature,
} from "../../lib/room-partitions-cache";

const room = (...ids: Array<string | null>) => ({
  sides: ids.map((id) => ({ kind: id ? "PARTITION" : "PLAIN", partitionId: id })),
});

describe("roomSignature", () => {
  test("ignores PLAIN sides and side order", () => {
    assert.deepEqual(partitionSideIds(room("b", null, "a")), ["b", "a"]);
    assert.equal(roomSignature(room("b", null, "a")), roomSignature(room("a", "b")));
  });
  test("empty when no partitions", () => {
    assert.equal(roomSignature(room(null, null)), "");
  });
  test("changes when a partition id is added", () => {
    assert.notEqual(roomSignature(room("a")), roomSignature(room("a", "b")));
  });
});

describe("createRequestTracker", () => {
  test("dedupes the same room+signature (duplicate effect, StrictMode)", () => {
    const t = createRequestTracker();
    assert.ok(t.begin("r1", "a"));
    assert.equal(t.begin("r1", "a"), null);
    assert.ok(t.begin("r2", "a"), "another room is independent");
  });
  test("a changed signature re-allows a request and supersedes the older reply", () => {
    const t = createRequestTracker();
    const older = t.begin("r1", "a")!;
    const newer = t.begin("r1", "a|b")!;
    assert.equal(t.isCurrent(older), false, "out-of-order older reply is dropped");
    assert.equal(t.isCurrent(newer), true);
  });
  test("a request for another room never supersedes this room's", () => {
    const t = createRequestTracker();
    const a = t.begin("A", "x")!;
    t.begin("B", "y");
    assert.equal(t.isCurrent(a), true, "A's slow reply still lands, under A's own key");
  });
  test("fail() forgets the signature so the next switch retries", () => {
    const t = createRequestTracker();
    const tok = t.begin("r1", "a")!;
    t.fail(tok);
    assert.ok(t.begin("r1", "a"));
  });
  test("fail() of a superseded request does not clear the newer signature", () => {
    const t = createRequestTracker();
    const older = t.begin("r1", "a")!;
    t.begin("r1", "a|b");
    t.fail(older);
    assert.equal(t.begin("r1", "a|b"), null);
  });
});

describe("patchPartitionInCache / findCachedPartition", () => {
  const cache = { r1: [{ id: "p1", v: 1 }, { id: "p2", v: 1 }], r2: [{ id: "p3", v: 1 }] };
  test("replaces the row wherever it appears", () => {
    const next = patchPartitionInCache(cache, { id: "p2", v: 2 });
    assert.deepEqual(next.r1, [{ id: "p1", v: 1 }, { id: "p2", v: 2 }]);
    assert.equal(next.r2, cache.r2);
  });
  test("returns the same object when nothing matches", () => {
    assert.equal(patchPartitionInCache(cache, { id: "zz", v: 9 }), cache);
  });
  test("find across rooms", () => {
    assert.equal(findCachedPartition(cache, "p3")?.id, "p3");
    assert.equal(findCachedPartition(cache, "nope"), undefined);
  });
});
