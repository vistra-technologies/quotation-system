// Exclusive run lock (final review I1) — unit-tested in tests/unit/regression-run-lock.test.ts.
import fs from "node:fs";
import path from "node:path";

interface LockBody { pid: number; at: string; runId?: string }

/** true if a process with this pid exists (EPERM = exists but not ours). */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(file: string): LockBody | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as LockBody;
  } catch {
    return null; // missing, or a torn write — treated as stale
  }
}

/**
 * Take the per-checkout run lock (O_EXCL create). Two runs in one checkout would clobber run.json, the storage
 * states and each other's teardown. A lock whose pid is dead (a killed run) is stale and taken over; a lock held by
 * a LIVE pid other than ours refuses the start. Re-acquiring our own lock is a no-op (setup → teardown share a pid).
 */
export function acquireRunLock(file: string, opts: { pid?: number; isAlive?: (pid: number) => boolean; runId?: string } = {}): void {
  const pid = opts.pid ?? process.pid;
  const alive = opts.isAlive ?? pidAlive;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, JSON.stringify({ pid, at: new Date().toISOString(), runId: opts.runId } satisfies LockBody));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const held = readLock(file);
    if (held && held.pid === pid) return;
    if (held && alive(held.pid)) {
      throw new Error(
        `regression suite: another run holds ${file} (pid ${held.pid}, since ${held.at}${held.runId ? `, run ${held.runId}` : ""}) — ` +
          `never run two live runs at once. If that process is not a regression run, delete the lock file.`,
      );
    }
    fs.rmSync(file, { force: true }); // stale: its process is gone (killed run) — take it over
  }
  throw new Error(`regression suite: could not take the run lock ${file} (raced 3 times)`);
}

/** Release the lock if (and only if) `pid` holds it. */
export function releaseRunLock(file: string, pid: number = process.pid): void {
  const held = readLock(file);
  if (held && held.pid === pid) fs.rmSync(file, { force: true });
}
