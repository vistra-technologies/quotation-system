import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ledger, DELETE_ORDER } from "../regression/fixtures/ledger";
import { assertMutationAllowed, GuardError } from "../regression/fixtures/guard";
import { withGlobalState } from "../regression/fixtures/global-state";

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
