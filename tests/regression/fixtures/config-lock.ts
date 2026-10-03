import fs from "node:fs";
import path from "node:path";

/**
 * Cross-worker mutual exclusion for a file-system lock under the run's storage dir (one directory per
 * lock; `mkdirSync` is atomic, so exactly one worker process holds it).
 *
 * Used for the Test Org's ComponentType CONFIGURATION window: every spec that temporarily edits a Test-Org
 * type (a rename, a field-values PUT) or asserts that a fresh Test-Org project's config-update diff is
 * exact/empty takes `TEST_ORG_CONFIG_LOCK`, so one spec's temporary edit can never show up in another
 * spec's exact diff. Other specs (projects created in parallel) may still freeze a temporary label; that
 * is why no spec may assert ComponentType names outside this lock.
 *
 * A lock directory older than `staleMs` (a worker killed while holding it) is broken and re-taken.
 */
export const TEST_ORG_CONFIG_LOCK = "test-org-component-config";

export interface LockOpts {
  /** Give up waiting after this long (default 180 s). */
  timeoutMs?: number;
  /** A held lock older than this is considered abandoned (default 5 min). */
  staleMs?: number;
  /** Poll interval (default 250 ms). */
  pollMs?: number;
}

export function lockDir(storageDir: string, name: string): string {
  return path.join(storageDir, `lock-${name}`);
}

/** Try once to take the lock; true if this call now holds it. Breaks an abandoned (stale) lock. */
export function tryAcquire(dir: string, staleMs: number, now = Date.now()): boolean {
  try {
    fs.mkdirSync(dir);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  try {
    if (now - fs.statSync(dir).mtimeMs > staleMs) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
      return true;
    }
  } catch {
    /* lost a race for the stale lock, or it was released meanwhile — retry on the next poll */
  }
  return false;
}

export async function withLock<T>(storageDir: string, name: string, body: () => Promise<T>, opts: LockOpts = {}): Promise<T> {
  const { timeoutMs = 180_000, staleMs = 300_000, pollMs = 250 } = opts;
  fs.mkdirSync(storageDir, { recursive: true });
  const dir = lockDir(storageDir, name);
  const deadline = Date.now() + timeoutMs;
  while (!tryAcquire(dir, staleMs)) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for lock "${name}" (${dir})`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  try {
    return await body();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
