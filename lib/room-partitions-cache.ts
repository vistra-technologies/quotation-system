// Stage 34 S34-9 (I9, D-38): pure helpers behind the Design page's room-partitions cache. One cache lives in the
// workspace; every fetch for a room goes through a request tracker so (a) a room is never fetched twice for the
// same set of partition ids, and (b) an older reply can never overwrite a newer one. Replies are written under
// their own room key, so a slow reply for room A cannot land under room B.

interface RoomWithSides {
  sides: ReadonlyArray<{ kind: string; partitionId: string | null }>;
}

/** The PARTITION side ids of a room, in side order. */
export function partitionSideIds(room: RoomWithSides): string[] {
  const ids: string[] = [];
  for (const s of room.sides) if (s.kind === "PARTITION" && s.partitionId) ids.push(s.partitionId);
  return ids;
}

/** Order-insensitive signature of a room's partition ids; "" when it has none. */
export function roomSignature(room: RoomWithSides): string {
  return partitionSideIds(room).sort().join("|");
}

export interface RequestToken {
  roomId: string;
  sig: string;
  seq: number;
}

export interface RequestTracker {
  /** A token to fetch with, or null when this room+signature was already requested (in flight or done). */
  begin(roomId: string, sig: string): RequestToken | null;
  /** True only for the newest request of that room. */
  isCurrent(token: RequestToken): boolean;
  /** Forget a failed request's signature so the next switch retries. */
  fail(token: RequestToken): void;
}

export function createRequestTracker(): RequestTracker {
  const requestedSig = new Map<string, string>();
  const latestSeq = new Map<string, number>();
  let seq = 0;
  return {
    begin(roomId, sig) {
      if (requestedSig.get(roomId) === sig) return null;
      requestedSig.set(roomId, sig);
      const token = { roomId, sig, seq: ++seq };
      latestSeq.set(roomId, token.seq);
      return token;
    },
    isCurrent(token) {
      return latestSeq.get(token.roomId) === token.seq;
    },
    fail(token) {
      if (requestedSig.get(token.roomId) === token.sig && latestSeq.get(token.roomId) === token.seq) {
        requestedSig.delete(token.roomId);
      }
    },
  };
}

/** Replace a saved partition wherever it appears in the cache; returns `prev` itself when nothing matched. */
export function patchPartitionInCache<P extends { id: string }>(
  prev: Record<string, P[]>,
  partition: P,
): Record<string, P[]> {
  let changed = false;
  const next: Record<string, P[]> = {};
  for (const [roomId, rows] of Object.entries(prev)) {
    const idx = rows.findIndex((p) => p.id === partition.id);
    if (idx === -1) {
      next[roomId] = rows;
      continue;
    }
    changed = true;
    next[roomId] = [...rows.slice(0, idx), partition, ...rows.slice(idx + 1)];
  }
  return changed ? next : prev;
}

/** Find a cached row by id across all rooms. */
export function findCachedPartition<P extends { id: string }>(
  cache: Record<string, P[]>,
  partitionId: string,
): P | undefined {
  for (const rows of Object.values(cache)) {
    const hit = rows.find((p) => p.id === partitionId);
    if (hit) return hit;
  }
  return undefined;
}
