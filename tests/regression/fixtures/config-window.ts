import { test } from "./test";
import { withLock, TEST_ORG_CONFIG_LOCK } from "./config-lock";
import type { RunState } from "./run-state";

/**
 * Budgets for TEST_ORG_CONFIG_LOCK, chosen to be coherent:
 *  - the waiting test's timeout is first extended by LOCK_WAIT_MS, so waiting never eats its own budget;
 *  - once the lock is held, the test's timeout is reset to (original budget + time waited + WINDOW_MS), so a
 *    holder can hold for at most ~original + WINDOW_MS (90 s + 180 s with the suite default);
 *  - STALE_MS is longer than that maximum holder lifetime, so a LIVE holder is never broken; a dead holder
 *    (its worker was killed) is broken at once through the pid check;
 *  - LOCK_WAIT_MS is longer than STALE_MS, so a waiter outlives an abandoned-but-alive holder.
 */
export const WINDOW_MS = 180_000;
export const STALE_MS = 6 * 60_000;
export const LOCK_WAIT_MS = 8 * 60_000;

/** Run `body` holding TEST_ORG_CONFIG_LOCK with a full time budget for the window. Not re-entrant. */
export async function withTestOrgConfigLock<T>(run: Pick<RunState, "storageDir">, body: () => Promise<T>): Promise<T> {
  const original = test.info().timeout;
  test.setTimeout(original + LOCK_WAIT_MS);
  return withLock(run.storageDir, TEST_ORG_CONFIG_LOCK, body, {
    timeoutMs: LOCK_WAIT_MS,
    staleMs: STALE_MS,
    onAcquired: (waited) => test.setTimeout(original + waited + WINDOW_MS),
  });
}
