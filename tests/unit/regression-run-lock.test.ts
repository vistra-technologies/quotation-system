import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { acquireRunLock, releaseRunLock, pidAlive, teardownRefusal, lockHolderPid } from "../regression/fixtures/run-lock";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rgr-lock-")), "run.lock");

test("acquire creates the lock with our pid; release removes it", () => {
  const f = tmp();
  acquireRunLock(f, { pid: 111, isAlive: () => true });
  assert.equal(JSON.parse(fs.readFileSync(f, "utf-8")).pid, 111);
  acquireRunLock(f, { pid: 111, isAlive: () => true }); // same pid (setup → teardown) = no-op
  releaseRunLock(f, 111);
  assert.equal(fs.existsSync(f), false);
});

test("a lock held by a LIVE other pid refuses the start, naming the pid", () => {
  const f = tmp();
  acquireRunLock(f, { pid: 111, isAlive: () => true });
  assert.throws(() => acquireRunLock(f, { pid: 222, isAlive: () => true }), /pid 111.*never run two live runs at once/);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf-8")).pid, 111, "the holder's lock is untouched");
});

test("a lock whose pid is dead (killed run) is stale and taken over", () => {
  const f = tmp();
  acquireRunLock(f, { pid: 111, isAlive: () => true });
  acquireRunLock(f, { pid: 222, isAlive: (p) => p !== 111 });
  assert.equal(JSON.parse(fs.readFileSync(f, "utf-8")).pid, 222);
});

test("a torn / unreadable lock file is treated as stale", () => {
  const f = tmp();
  fs.writeFileSync(f, "{not json");
  acquireRunLock(f, { pid: 333, isAlive: () => true });
  assert.equal(JSON.parse(fs.readFileSync(f, "utf-8")).pid, 333);
});

test("release by a non-holder leaves the lock in place", () => {
  const f = tmp();
  acquireRunLock(f, { pid: 111, isAlive: () => true });
  releaseRunLock(f, 999);
  assert.equal(fs.existsSync(f), true);
});

test("pidAlive: our own pid is alive; an exited child's pid is not; nonsense pids are not", () => {
  assert.equal(pidAlive(process.pid), true);
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(pidAlive(child.pid!), false);
  assert.equal(pidAlive(0), false);
  assert.equal(pidAlive(-5), false);
});

test("IMP-1 teardownRefusal: only the process that holds the lock AND set up this run.json may tear down", () => {
  // the live run A's own teardown
  assert.equal(teardownRefusal({ lockPid: 100, pid: 100, runRunId: "runA", envRunId: "runA" }), null);
  // run B, refused at the lock: its teardown must not touch run A (B never set RGR_RUN_ID)
  assert.match(teardownRefusal({ lockPid: 100, pid: 200, runRunId: "runA", envRunId: undefined })!, /not our run/);
  // even with a stray RGR_RUN_ID inherited from the environment, the lock decides
  assert.match(teardownRefusal({ lockPid: 100, pid: 200, runRunId: "runA", envRunId: "runA" })!, /held by pid 100, not this process \(pid 200\)/);
  // our setup failed and released the lock: nothing to tear down here
  assert.match(teardownRefusal({ lockPid: null, pid: 100, runRunId: null, envRunId: "runB" })!, /held by nobody/);
  // we hold the lock but run.json is another run's (must never happen; refuse rather than drain it)
  assert.match(teardownRefusal({ lockPid: 100, pid: 100, runRunId: "runA", envRunId: "runB" })!, /belongs to run runA/);
});

test("lockHolderPid reads the holder's pid; null when there is no lock", () => {
  const f = tmp();
  assert.equal(lockHolderPid(f), null);
  acquireRunLock(f, { pid: 4242, isAlive: () => true });
  assert.equal(lockHolderPid(f), 4242);
});
