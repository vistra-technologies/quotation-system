import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ledger, DELETE_ORDER } from "../regression/fixtures/ledger";
import { assertMutationAllowed, GuardError } from "../regression/fixtures/guard";
import {
  withGlobalState,
  withRecordedGlobalState,
  appendGlobalStateFailures,
  globalStateFailuresFile,
  readGlobalStateFailures,
  stuckTemporaryTypeNames,
} from "../regression/fixtures/global-state";
import { withLock, tryAcquire, lockDir, release, isAbandoned, breakLock } from "../regression/fixtures/config-lock";
import { restoreDecision } from "../regression/fixtures/pending-restore";

/** Temp ledger path; the directory is removed after the test. */
const tmp = (t: TestContext) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rgr-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "ledger.jsonl");
};

test("ledger registers + persists; a fresh instance recovers the orphans", (t) => {
  const f = tmp(t);
  const a = new Ledger(f);
  a.add({ kind: "project", id: "p1", orgSlug: "e2e-testorg", label: "rgr-x-P" });
  a.add({ kind: "user", id: "u1", orgSlug: "e2e-testorg", label: "rgr-x-u" });
  const b = new Ledger(f); // simulates the next run after a crash
  assert.deepEqual(b.load().map((e) => e.id).sort(), ["p1", "u1"]);
  b.remove("p1");
  assert.deepEqual(new Ledger(f).load().map((e) => e.id), ["u1"]);
});

test("ledger.inDeleteOrder puts children before parents (FK-safe)", (t) => {
  const l = new Ledger(tmp(t));
  for (const kind of ["org", "user", "project", "externalCompany", "superadmin", "inventoryItem", "inquiry", "role"] as const) {
    l.add({ kind, id: kind, orgSlug: null, label: `rgr-x-${kind}` });
  }
  const order = l.inDeleteOrder().map((e) => e.kind);
  const idx = (k: string) => order.indexOf(k as never);
  assert.ok(idx("project") < idx("user"));          // projects reference users
  assert.ok(idx("user") < idx("externalCompany"));  // users reference companies
  assert.ok(idx("user") < idx("role"));             // users reference roles
  assert.ok(idx("project") < idx("org") && idx("user") < idx("org")); // org last
  assert.deepEqual([...DELETE_ORDER].sort(), [...new Set(DELETE_ORDER)].sort()); // no duplicates
});

test("ledger refuses an entry whose label lacks the rgr- prefix (cannot be swept later)", (t) => {
  assert.throws(() => new Ledger(tmp(t)).add({ kind: "project", id: "x", orgSlug: null, label: "Real Project" }), /rgr-/);
});

test("ledger: two instances adding to the same file lose no update", (t) => {
  const f = tmp(t);
  const a = new Ledger(f);
  const b = new Ledger(f); // both constructed before either writes (stale views)
  a.add({ kind: "project", id: "pa", orgSlug: null, label: "rgr-a" });
  b.add({ kind: "project", id: "pb", orgSlug: null, label: "rgr-b" });
  a.add({ kind: "user", id: "ua", orgSlug: null, label: "rgr-ua" });
  assert.deepEqual(new Ledger(f).load().map((e) => e.id).sort(), ["pa", "pb", "ua"]);
  b.remove("pa");
  assert.deepEqual(new Ledger(f).load().map((e) => e.id).sort(), ["pb", "ua"]);
});

test("ledger: add creates the parent directory and the file is JSONL", (t) => {
  const f = path.join(path.dirname(tmp(t)), "deep", "nested", "ledger.jsonl");
  new Ledger(f).add({ kind: "org", id: "o1", orgSlug: null, label: "rgr-o" });
  const lines = fs.readFileSync(f, "utf-8").trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).op, "add");
});

test("ledger: a corrupt FINAL line (crash mid-append) is tolerated and later appends survive", (t) => {
  const f = tmp(t);
  const l = new Ledger(f);
  l.add({ kind: "project", id: "p1", orgSlug: null, label: "rgr-p1" });
  fs.appendFileSync(f, '{"op":"add","entry":{"kind":"pro'); // partial, no newline
  assert.deepEqual(new Ledger(f).load().map((e) => e.id), ["p1"]);
  l.add({ kind: "user", id: "u1", orgSlug: null, label: "rgr-u1" }); // must not merge into the partial line
  assert.deepEqual(new Ledger(f).load().map((e) => e.id).sort(), ["p1", "u1"]);
});

test("ledger: a corrupt line in the middle throws a clear error", (t) => {
  const f = tmp(t);
  const l = new Ledger(f);
  l.add({ kind: "project", id: "p1", orgSlug: null, label: "rgr-p1" });
  fs.appendFileSync(f, "not json\n");
  fs.appendFileSync(f, JSON.stringify({ op: "remove", id: "zzz" }) + "\n");
  assert.throws(() => new Ledger(f), /line 2 is corrupt/);
});

test("ledger: only ENOENT reads as empty; other read errors propagate", (t) => {
  const f = tmp(t);
  assert.deepEqual(new Ledger(f).load(), []); // missing file
  const dir = path.join(path.dirname(f), "adir");
  fs.mkdirSync(dir);
  assert.throws(() => new Ledger(dir), (e: NodeJS.ErrnoException) => e.code === "EISDIR");
});

const ALLOWED = new Set(["e2e-testorg", "rgr-abc-b"]);
const IDS = new Set(["mine1", "mine2"]);
const SA = "/api/v1/superadmin";

test("guard allows mutations to allowed org slugs and reads anywhere", () => {
  assertMutationAllowed("POST", "https://e2e-testorg.test.easeetool.com/api/v1/orgs/e2e-testorg/projects", ALLOWED);
  assertMutationAllowed("DELETE", "/api/v1/orgs/rgr-abc-b/projects/1", ALLOWED);
  assertMutationAllowed("GET", "/api/v1/orgs/cloisons/projects", ALLOWED); // reads are not mutations
  assertMutationAllowed("get", "/api/v1/orgs/cloisons/projects", ALLOWED);
  assertMutationAllowed("GET", `${SA}/orgs/anything`, ALLOWED);
  assertMutationAllowed("HEAD", `${SA}/formula-sets/abc`, ALLOWED);
  assertMutationAllowed("OPTIONS", `${SA}/formula-sets/abc`, ALLOWED);
});

test("guard throws BEFORE a mutating request to any other org", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.throws(() => assertMutationAllowed(method, "/api/v1/orgs/cloisons/projects", ALLOWED), GuardError);
  }
  assert.throws(() => assertMutationAllowed("POST", "https://cloisons.easeetool.com/api/v1/orgs/cloisons/users", ALLOWED), GuardError);
});

test("guard: unknown / odd methods are treated as mutating (fail closed)", () => {
  for (const m of ["post", "POST ", "PURGE", "GET ", ""]) {
    assert.throws(() => assertMutationAllowed(m, "/api/v1/orgs/cloisons/projects", ALLOWED), GuardError, m);
  }
  assertMutationAllowed("post", "/api/v1/orgs/e2e-testorg/projects", ALLOWED); // lowercase on allowed org is fine
});

test("guard: login/logout/admin-create/org-create/auth always allowed", () => {
  assertMutationAllowed("POST", `${SA}/login`, ALLOWED);
  assertMutationAllowed("POST", `${SA}/logout`, ALLOWED);
  assertMutationAllowed("POST", `${SA}/admins`, ALLOWED);
  assertMutationAllowed("POST", `${SA}/orgs`, ALLOWED);
  assertMutationAllowed("POST", "/api/auth/sign-in/username", ALLOWED);
});

test("guard: /admins/:id needs the id in allowedIds", () => {
  assert.throws(() => assertMutationAllowed("DELETE", `${SA}/admins/a1`, ALLOWED), GuardError);
  assert.throws(() => assertMutationAllowed("PATCH", `${SA}/admins/a1`, ALLOWED, IDS), GuardError);
  assertMutationAllowed("DELETE", `${SA}/admins/mine1`, ALLOWED, IDS);
  assertMutationAllowed("PATCH", `${SA}/admins/mine1`, ALLOWED, IDS);
  assert.throws(() => assertMutationAllowed("DELETE", `${SA}/admins/mine1/x`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("DELETE", `${SA}/admins/a/b`, ALLOWED, IDS), GuardError);
});

test("guard: /orgs/:id mutations follow allowedIds", () => {
  assert.throws(() => assertMutationAllowed("PATCH", `${SA}/orgs/some-real-org-id`, ALLOWED), GuardError);
  assert.throws(() => assertMutationAllowed("PATCH", `${SA}/orgs/X`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("DELETE", `${SA}/orgs/X`, ALLOWED, IDS), GuardError);
  assertMutationAllowed("PATCH", `${SA}/orgs/mine1`, ALLOWED, IDS);
  assertMutationAllowed("DELETE", `${SA}/orgs/mine1`, ALLOWED, IDS);
  assertMutationAllowed("POST", `${SA}/orgs/mine1/suspend`, ALLOWED, IDS);
  assert.throws(() => assertMutationAllowed("POST", `${SA}/orgs/X/suspend`, ALLOWED, IDS), GuardError);
  assertMutationAllowed("POST", `${SA}/orgs/mine1/users`, ALLOWED, IDS);
  assertMutationAllowed("DELETE", `${SA}/orgs/mine1/users/U`, ALLOWED, IDS);
  assert.throws(() => assertMutationAllowed("DELETE", `${SA}/orgs/X/users/U`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("POST", `${SA}/orgs/X/users`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("POST", `${SA}/orgs/mine1/unknown`, ALLOWED, IDS), GuardError);
});

const OC = ["roles", "roles/r1", "roles/r1/permissions", "component-types", "component-types/c1", "component-types/c1/reorder"];

test("guard: roles / component-types orgId from query (DELETE style)", () => {
  for (const r of OC) {
    const base = `${SA}/${r}`;
    assert.throws(() => assertMutationAllowed("POST", base, ALLOWED, IDS), GuardError); // neither
    assert.throws(() => assertMutationAllowed("POST", `${base}?orgId=X`, ALLOWED, IDS), GuardError);
    assertMutationAllowed("DELETE", `${base}?orgId=mine2`, ALLOWED, IDS); // query-only allowed
    assertMutationAllowed("PATCH", `https://easeetool.com${base}?foo=1&orgId=mine2`, ALLOWED, IDS);
  }
});

test("guard: roles / component-types orgId from JSON body (R8)", () => {
  for (const r of OC) {
    const base = `${SA}/${r}`;
    assertMutationAllowed("POST", base, ALLOWED, IDS, { orgId: "mine1" }); // body-only allowed
    assert.throws(() => assertMutationAllowed("POST", base, ALLOWED, IDS, { orgId: "foreign" }), GuardError);
    // query allowed + body foreign -> refused (the bypass)
    assert.throws(() => assertMutationAllowed("POST", `${base}?orgId=mine1`, ALLOWED, IDS, { orgId: "foreign" }), GuardError);
    // query foreign + body allowed -> refused (disagreement)
    assert.throws(() => assertMutationAllowed("POST", `${base}?orgId=foreign`, ALLOWED, IDS, { orgId: "mine1" }), GuardError);
    // both equal -> ok
    assertMutationAllowed("POST", `${base}?orgId=mine1`, ALLOWED, IDS, { orgId: "mine1" });
    // neither (body without orgId) -> refused
    assert.throws(() => assertMutationAllowed("POST", base, ALLOWED, IDS, { name: "x" }), GuardError);
    // non-string / empty body orgId falls back to query
    assertMutationAllowed("POST", `${base}?orgId=mine2`, ALLOWED, IDS, { orgId: 5 });
    assertMutationAllowed("POST", `${base}?orgId=mine2`, ALLOWED, IDS, { orgId: "" });
    assert.throws(() => assertMutationAllowed("POST", base, ALLOWED, IDS, { orgId: 5 }), GuardError);
    assert.throws(() => assertMutationAllowed("POST", base, ALLOWED, IDS, null), GuardError);
  }
});

test("guard: formula-sets create allowed; existing ids only when allowed", () => {
  assertMutationAllowed("POST", `${SA}/formula-sets`, ALLOWED);
  assert.throws(() => assertMutationAllowed("DELETE", `${SA}/formula-sets/abc`, ALLOWED), GuardError);
  assert.throws(() => assertMutationAllowed("PATCH", `${SA}/formula-sets/abc`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("POST", `${SA}/formula-sets/abc/version`, ALLOWED, IDS), GuardError);
  assertMutationAllowed("DELETE", `${SA}/formula-sets/mine1`, ALLOWED, IDS);
  assertMutationAllowed("PATCH", `${SA}/formula-sets/mine1`, ALLOWED, IDS);
  assertMutationAllowed("POST", `${SA}/formula-sets/mine1/version`, ALLOWED, IDS);
  assert.throws(() => assertMutationAllowed("POST", `${SA}/formula-sets/mine1/other`, ALLOWED, IDS), GuardError);
});

test("guard: unknown superadmin or other mutation targets are refused", () => {
  assert.throws(() => assertMutationAllowed("POST", `${SA}/platform-settings`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("POST", "/api/other", ALLOWED, IDS), GuardError);
});

test("guard: URL-trick bypasses are refused", () => {
  const refused = (m: string, u: string) =>
    assert.throws(() => assertMutationAllowed(m, u, ALLOWED, IDS, { orgId: "mine1" }), GuardError, u);
  // dot-segment traversal, plain and encoded
  refused("DELETE", "/api/v1/orgs/e2e-testorg/../cloisons/projects/1");
  refused("DELETE", "/api/v1/orgs/e2e-testorg/%2e%2e/cloisons/projects/1");
  refused("DELETE", "/api/v1/orgs/e2e-testorg/%2E%2E/cloisons/projects/1");
  refused("DELETE", "/api/v1/superadmin/orgs/mine1/../X");
  // encoded slug
  refused("POST", "/api/v1/orgs/%63loisons/projects");
  refused("POST", "/api/v1/orgs/e2e-testorg%2F..%2Fcloisons/projects");
  refused("POST", "/api/v1/superadmin/orgs/mine%31");
  // case / prefix tricks
  refused("POST", "/API/v1/orgs/cloisons/projects");
  refused("POST", "/Api/V1/orgs/cloisons/projects");
  refused("POST", "//api/v1/orgs/cloisons/projects");
  refused("POST", "//evil.example/api/v1/orgs/e2e-testorg/projects");
  refused("POST", "/api//v1/orgs/cloisons/projects");
  refused("POST", "/api/v1//orgs/e2e-testorg/projects");
  refused("POST", "/api/v1/orgs//cloisons/projects");
  refused("POST", "/api\\v1\\orgs\\cloisons\\projects");
  // trailing slash / extra segments / unknown subpaths on SA
  refused("DELETE", "/api/v1/superadmin/orgs/X/");
  refused("DELETE", "/api/v1/superadmin/orgs/mine1/");
  refused("POST", "/api/v1/superadmin/login/");
  refused("DELETE", "/api/v1/superadmin/admins/a/b");
  refused("POST", "/api/v1/superadmin/orgs/mine1/unknown");
  refused("POST", "/api/v1/superadmin/login/extra");
  // lowercase method on a foreign org is still blocked
  refused("post", "/api/v1/orgs/cloisons/projects");
  refused("delete", "/api/v1/superadmin/orgs/X");
});

test("withGlobalState: reverts after success, verifies, and returns the body result", async () => {
  let v: unknown = "orig";
  const failures: string[] = [];
  const out = await withGlobalState(
    { key: "k", read: async () => v, write: async (n) => { v = n; } },
    async () => { v = "changed"; },
    async () => { assert.equal(v, "changed"); return 42; },
    failures,
  );
  assert.equal(out, 42);
  assert.equal(v, "orig");
  assert.deepEqual(failures, []);
});

test("withGlobalState: reverts even when the body throws", async () => {
  let v: unknown = { a: 1 };
  const failures: string[] = [];
  await assert.rejects(
    withGlobalState(
      { key: "k", read: async () => v, write: async (n) => { v = n; } },
      async () => { v = { a: 2 }; },
      async () => { throw new Error("boom"); },
      failures,
    ),
    /boom/,
  );
  assert.deepEqual(v, { a: 1 });
  assert.deepEqual(failures, []);
});

test("withGlobalState: a revert that does not take is recorded as a failure", async () => {
  let v: unknown = "orig";
  const failures: string[] = [];
  await withGlobalState(
    { key: "sticky", read: async () => v, write: async () => { /* revert silently fails */ } },
    async () => { v = "changed"; },
    async () => 1,
    failures,
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /sticky/);
});

test("appendGlobalStateFailures: one JSONL line per failure (append-only), ignores an empty list; reader handles JSONL + legacy arrays", (t) => {
  const file = path.join(path.dirname(tmp(t)), "sub", "global-state-failures.json");
  appendGlobalStateFailures(file, []);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(readGlobalStateFailures(file), []);
  appendGlobalStateFailures(file, ["a"]);
  appendGlobalStateFailures(file, ["b\nwith newline", "c"]);
  assert.equal(fs.readFileSync(file, "utf-8").trim().split("\n").length, 3);
  assert.deepEqual(readGlobalStateFailures(file), ["a", "b\nwith newline", "c"]);
  fs.writeFileSync(file, JSON.stringify(["legacy"]));
  assert.deepEqual(readGlobalStateFailures(file), ["legacy"]);
  assert.equal(globalStateFailuresFile("/x/run"), path.join("/x/run", "global-state-failures.json"));
});

test("withRecordedGlobalState forbidOriginal: a value matching it refuses to start (nothing mutated, nothing recorded)", async (t) => {
  const file = path.join(path.dirname(tmp(t)), "gsf.json");
  let v: unknown = "rgr-abc-GLASS-renamed";
  let mutated = false;
  await assert.rejects(
    withRecordedGlobalState(
      { key: "GLASS.name", read: async () => v, write: async (n) => { v = n; } },
      async () => { mutated = true; v = "x"; },
      async () => 1,
      file,
      { forbidOriginal: /^rgr-/ },
    ),
    /GLASS\.name.*rgr-abc-GLASS-renamed.*never reverted/,
  );
  assert.equal(mutated, false);
  assert.equal(v, "rgr-abc-GLASS-renamed");
  assert.equal(fs.existsSync(file), false);
  // a normal original passes the check
  v = "Glass";
  assert.equal(await withRecordedGlobalState({ key: "k", read: async () => v, write: async (n) => { v = n; } }, async () => { v = "rgr-t"; }, async () => 2, file, { forbidOriginal: /^rgr-/ }), 2);
  assert.equal(v, "Glass");
});

test("stuckTemporaryTypeNames flags only rgr- names", () => {
  assert.deepEqual(stuckTemporaryTypeNames([{ code: "GLASS", name: "rgr-x-GLASS-renamed" }, { code: "DOOR", name: "Door" }, { code: "X", name: "my rgr- type" }]), [
    'GLASS (name "rgr-x-GLASS-renamed")',
  ]);
});

test("withRecordedGlobalState: a clean revert writes nothing and returns the body result", async (t) => {
  const file = path.join(path.dirname(tmp(t)), "gsf.json");
  let v: unknown = "orig";
  const out = await withRecordedGlobalState(
    { key: "k", read: async () => v, write: async (n) => { v = n; } },
    async () => { v = "changed"; },
    async () => 7,
    file,
  );
  assert.equal(out, 7);
  assert.equal(v, "orig");
  assert.equal(fs.existsSync(file), false);
});

test("withRecordedGlobalState: a revert that does not take is written for teardown AND thrown", async (t) => {
  const file = path.join(path.dirname(tmp(t)), "gsf.json");
  let v: unknown = "orig";
  await assert.rejects(
    withRecordedGlobalState(
      { key: "sticky", read: async () => v, write: async () => { /* revert silently fails */ } },
      async () => { v = "changed"; },
      async () => 1,
      file,
    ),
    /global state not restored[\s\S]*sticky/,
  );
  const recorded = readGlobalStateFailures(file);
  assert.equal(recorded.length, 1);
  assert.match(recorded[0], /sticky/);
});

test("withRecordedGlobalState: a body error still reverts and propagates (nothing recorded)", async (t) => {
  const file = path.join(path.dirname(tmp(t)), "gsf.json");
  let v: unknown = 1;
  await assert.rejects(
    withRecordedGlobalState(
      { key: "k", read: async () => v, write: async (n) => { v = n; } },
      async () => { v = 2; },
      async () => { throw new Error("boom"); },
      file,
    ),
    /boom/,
  );
  assert.equal(v, 1);
  assert.equal(fs.existsSync(file), false);
});

// ── config-lock (Task 10): cross-worker lock for the Test Org's ComponentType config window ──

const tmpDir = (t: TestContext) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rgr-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("withLock serialises bodies and releases the lock even when the body throws", async (t) => {
  const dir = tmpDir(t);
  const events: string[] = [];
  const run = (id: string, fail = false) =>
    withLock(dir, "x", async () => {
      events.push(`in-${id}`);
      await new Promise((r) => setTimeout(r, 30));
      events.push(`out-${id}`);
      if (fail) throw new Error("boom");
    }, { pollMs: 5 });
  const results = await Promise.allSettled([run("a", true), run("b")]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  // never interleaved: each "in" is immediately followed by its own "out"
  for (let i = 0; i < events.length; i += 2) assert.equal(events[i].slice(3), events[i + 1].slice(4));
  assert.equal(fs.existsSync(lockDir(dir, "x")), false);
});

test("tryAcquire refuses a live lock, breaks a dead holder's or a stale one; release only removes our own token", async (t) => {
  const dir = tmpDir(t);
  const d = lockDir(dir, "y");
  const alive = () => true;
  const dead = () => false;
  const tok = tryAcquire(d, 60_000, Date.now(), alive);
  assert.ok(tok);
  assert.equal(tryAcquire(d, 60_000, Date.now(), alive), null); // held by a live, fresh holder
  // stale by age (holder alive): the waiter breaks it on this poll and takes it on the next
  assert.equal(tryAcquire(d, 60_000, Date.now() + 120_000, alive), null);
  const tok2 = tryAcquire(d, 60_000, Date.now(), alive);
  assert.ok(tok2);
  // the old holder's release must not remove the new holder's lock
  release(d, tok!);
  assert.equal(fs.existsSync(d), true);
  // a dead holder pid is broken at once, whatever its age
  assert.equal(tryAcquire(d, 60_000, Date.now(), dead), null);
  assert.ok(tryAcquire(d, 60_000, Date.now(), alive));
  await assert.rejects(withLock(dir, "y", async () => 1, { timeoutMs: 50, pollMs: 10, isAlive: alive }), /timed out/);
});

test("isAbandoned: dead pid → yes; alive and fresh → no; no holder file → judged by the directory age", () => {
  const now = 1_000_000;
  assert.equal(isAbandoned({ pid: 1, token: "t", at: now }, now, now, 60_000, () => false), true);
  assert.equal(isAbandoned({ pid: 1, token: "t", at: now - 1000 }, now, now, 60_000, () => true), false);
  assert.equal(isAbandoned({ pid: 1, token: "t", at: now - 61_000 }, now, now, 60_000, () => true), true);
  assert.equal(isAbandoned(null, now - 1000, now, 60_000, () => true), false);
  assert.equal(isAbandoned(null, now - 61_000, now, 60_000, () => true), true);
});

test("withLock: onAcquired gets the wait time; concurrent breakers of one stale lock leave exactly one holder", async (t) => {
  const dir = tmpDir(t);
  const d = lockDir(dir, "z");
  fs.mkdirSync(d); // an abandoned lock with no holder file
  const old = new Date(Date.now() - 10 * 60_000);
  fs.utimesSync(d, old, old);
  let inside = 0;
  let maxInside = 0;
  const waits: number[] = [];
  await Promise.all(
    [0, 1, 2, 3].map(() =>
      withLock(dir, "z", async () => {
        maxInside = Math.max(maxInside, ++inside);
        await new Promise((r) => setTimeout(r, 10));
        inside--;
      }, { pollMs: 2, staleMs: 60_000, onAcquired: (w) => waits.push(w) }),
    ),
  );
  assert.equal(maxInside, 1);
  assert.equal(waits.length, 4);
  for (const w of waits) assert.ok(w >= 0);
  assert.equal(fs.existsSync(d), false);
  assert.deepEqual(fs.readdirSync(dir), []); // no renamed stale directories left behind
});

test("breakLock never destroys a NEW holder's lock: a token change between judgement and rename is rolled back", (t) => {
  const dir = tmpDir(t);
  const d = lockDir(dir, "r");
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "holder.json"), JSON.stringify({ pid: process.pid, token: "B-new", at: Date.now() }));
  // the waiter judged holder "A-old" abandoned, but "B-new" took the lock before the rename
  assert.equal(breakLock(d, "A-old"), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, "holder.json"), "utf-8")).token, "B-new");
  assert.deepEqual(fs.readdirSync(dir), ["lock-r"]); // renamed back, no grave left
  // judged correctly → removed
  assert.equal(breakLock(d, "B-new"), true);
  assert.deepEqual(fs.readdirSync(dir), []);
  // a holder-less lock judged as such (null) is removed; one that gained a holder meanwhile is kept
  fs.mkdirSync(d);
  assert.equal(breakLock(d, null), true);
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, "holder.json"), JSON.stringify({ pid: process.pid, token: "C", at: Date.now() }));
  assert.equal(breakLock(d, null), false);
  assert.equal(fs.existsSync(d), true);
});

test("restoreDecision: original → done; the recorded temporary name → restore; anything else → conflict (never overwritten)", () => {
  const p = { original: "Door", temp: "rgr-run1-DOOR-renamed" };
  assert.equal(restoreDecision("Door", p), "done");
  assert.equal(restoreDecision("rgr-run1-DOOR-renamed", p), "restore");
  assert.equal(restoreDecision("Door (edited by a human)", p), "conflict");
  assert.equal(restoreDecision("rgr-run2-DOOR-renamed", p), "conflict"); // another run's temporary name
});
