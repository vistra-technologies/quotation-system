import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Cross-worker mutual exclusion through a lock DIRECTORY under the run's storage dir (`mkdirSync` is
 * atomic, so exactly one worker process holds it). NOT re-entrant: a holder that calls withLock again
 * for the same name deadlocks until its own wait limit.
 *
 * Used for the Test Org's ComponentType CONFIGURATION window: every spec that temporarily edits a Test-Org
 * type (a rename, a field-values PUT) or asserts that a fresh Test-Org project's config-update diff is
 * exact/empty takes `TEST_ORG_CONFIG_LOCK`, so one spec's temporary edit can never show up in another
 * spec's exact diff. Projects created in parallel by other specs may still freeze a temporary label; that
 * is why no spec may assert ComponentType names outside this lock.
 *
 * Abandoned locks. The holder writes `holder.json` ({pid, token, at}) into the directory. A waiter breaks
 * the lock when the holder process is provably dead (`process.kill(pid, 0)` → ESRCH), or — fallback, for a
 * live process whose body was abandoned — when it is older than `staleMs`, which callers set LONGER than
 * any holder's maximum budget (see tests/regression/fixtures/config-window.ts). Breaking is race-safe: the
 * stale directory is first RENAMED to a unique name (only one waiter's rename succeeds), then removed.
 * Release only removes the directory while it still carries the holder's own token.
 */
export const TEST_ORG_CONFIG_LOCK = "test-org-component-config";

export interface LockOpts {
  /** Give up waiting after this long (default 180 s). */
  timeoutMs?: number;
  /** A held lock older than this is considered abandoned even if its pid is alive (default 5 min). */
  staleMs?: number;
  /** Poll interval (default 250 ms). */
  pollMs?: number;
  /** Called once the lock is held, with the time spent waiting. */
  onAcquired?: (waitedMs: number) => void;
  /** Liveness probe (injectable for unit tests). */
  isAlive?: (pid: number) => boolean;
}

export interface Holder {
  pid: number;
  token: string;
  at: number;
}

export function lockDir(storageDir: string, name: string): string {
  return path.join(storageDir, `lock-${name}`);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, not ours to signal
  }
}

function readHolder(dir: string): Holder | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "holder.json"), "utf-8")) as Holder;
  } catch {
    return null;
  }
}

/** Pure: is a held lock abandoned? `holder` null = the holder died between mkdir and writing holder.json. */
export function isAbandoned(holder: Holder | null, dirMtimeMs: number, now: number, staleMs: number, isAlive: (pid: number) => boolean): boolean {
  if (holder && !isAlive(holder.pid)) return true;
  return now - (holder?.at ?? dirMtimeMs) > staleMs;
}

const NOT_ACQUIRED = new Set(["EEXIST", "EPERM", "EACCES", "ENOTEMPTY", "EBUSY"]);

/** rmSync that cannot throw (Windows EBUSY/EPERM on a dir another process still touches): retry, then warn. */
function removeQuietly(p: string): void {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (err) {
    console.warn(`[regression] lock: could not remove ${p} (${(err as NodeJS.ErrnoException).code ?? String(err)}) — left in place`);
  }
}

/**
 * Rename-then-remove: only the caller whose rename succeeds breaks the lock. After the rename the grave's
 * holder token is re-read: if it is not the holder that was judged (`expectedToken`; null = no holder file
 * when judged), a NEW holder took the lock between the judgement and the rename — the directory is renamed
 * back (or, if that is impossible, left in place untouched) so a live holder's lock is never destroyed.
 * Returns true when the lock directory was actually removed.
 */
export function breakLock(dir: string, expectedToken: string | null): boolean {
  const grave = `${dir}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(dir, grave);
  } catch {
    return false; // another waiter won, or the holder released it meanwhile
  }
  const found = readHolder(grave)?.token ?? null;
  if (found !== expectedToken) {
    try {
      fs.renameSync(grave, dir);
    } catch {
      console.warn(`[regression] lock: ${dir} changed holder while being broken and could not be renamed back; left at ${grave}`);
    }
    return false;
  }
  removeQuietly(grave);
  return true;
}

/**
 * Try once to take the lock. Returns the holder token when this call now holds it, else null. Breaks an
 * abandoned lock first (the caller retries on its next poll).
 */
export function tryAcquire(dir: string, staleMs: number, now = Date.now(), isAlive: (pid: number) => boolean = pidAlive): string | null {
  try {
    fs.mkdirSync(dir);
    const token = randomBytes(8).toString("hex");
    fs.writeFileSync(path.join(dir, "holder.json"), JSON.stringify({ pid: process.pid, token, at: now } satisfies Holder));
    return token;
  } catch (err) {
    if (!NOT_ACQUIRED.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
  }
  try {
    const holder = readHolder(dir);
    if (isAbandoned(holder, fs.statSync(dir).mtimeMs, now, staleMs, isAlive)) breakLock(dir, holder?.token ?? null);
  } catch {
    /* released meanwhile — retry on the next poll */
  }
  return null;
}

/** Release only if the lock still carries our token (a broken-and-retaken lock belongs to someone else). */
export function release(dir: string, token: string): void {
  if (readHolder(dir)?.token !== token) return;
  breakLock(dir, token);
}

export async function withLock<T>(storageDir: string, name: string, body: () => Promise<T>, opts: LockOpts = {}): Promise<T> {
  const { timeoutMs = 180_000, staleMs = 300_000, pollMs = 250, onAcquired, isAlive = pidAlive } = opts;
  fs.mkdirSync(storageDir, { recursive: true });
  const dir = lockDir(storageDir, name);
  const start = Date.now();
  let token: string | null;
  while (!(token = tryAcquire(dir, staleMs, Date.now(), isAlive))) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for lock "${name}" (${dir})`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  try {
    onAcquired?.(Date.now() - start);
    return await body();
  } finally {
    release(dir, token);
  }
}
