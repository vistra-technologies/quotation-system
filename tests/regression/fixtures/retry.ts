// Pure bounded retry (no Playwright imports) — unit-tested in tests/unit/regression-retry.test.ts.

/** 429 (sign-in rate limit) and 5xx are transient for a login; anything else (401, 400, …) is final. */
export const isTransientStatus = (s: number): boolean => s === 429 || (s >= 500 && s <= 599);

/**
 * Final review I5: call `attempt` until it returns a non-transient status, waiting `delaysMs[i]` before retry i+1
 * (bounded: delaysMs.length retries at most). Returns the last result — the caller decides what a final failure means.
 */
export async function retryTransient<T extends { status: number }>(
  attempt: () => Promise<T>,
  opts: { delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (status: number, waitMs: number, n: number) => void } = {},
): Promise<T> {
  const delays = opts.delaysMs ?? [2_000, 5_000, 10_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let res = await attempt();
  for (let i = 0; i < delays.length && isTransientStatus(res.status); i++) {
    opts.onRetry?.(res.status, delays[i], i + 1);
    await sleep(delays[i]);
    res = await attempt();
  }
  return res;
}

/**
 * True for network-level connection errors that are safe to retry on idempotent methods (GET, HEAD,
 * DELETE). Checks both the error message (Playwright wraps the underlying Node error) and the .code
 * property (bare Node errors).
 */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("EPIPE")
    )
      return true;
  }
  const code = err != null ? (err as NodeJS.ErrnoException).code : undefined;
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EPIPE";
}

/**
 * Retry `attempt` on connection-level errors (ECONNRESET, ETIMEDOUT, …) — safe ONLY for idempotent
 * methods (GET, HEAD, DELETE). Do NOT use for POST/PATCH/PUT creates: a reset after the server
 * processed the request but before it could respond would orphan a row.
 * Bounded: `delaysMs.length` retries at most. Each retry is logged via `onRetry`.
 */
export async function retryConnectionError<T>(
  attempt: () => Promise<T>,
  opts: {
    delaysMs?: number[];
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (err: unknown, waitMs: number, n: number) => void;
  } = {},
): Promise<T> {
  const delays = opts.delaysMs ?? [1_000, 2_000, 4_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!isConnectionError(err) || i >= delays.length) throw err;
      opts.onRetry?.(err, delays[i], i + 1);
      await sleep(delays[i]);
    }
  }
}
