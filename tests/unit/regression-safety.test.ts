import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ledger, DELETE_ORDER } from "../regression/fixtures/ledger";
import { assertMutationAllowed, GuardError } from "../regression/fixtures/guard";
import { withGlobalState } from "../regression/fixtures/global-state";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rgr-")), "ledger.json");

test("ledger registers + persists; a fresh instance recovers the orphans", () => {
  const f = tmp();
  const a = new Ledger(f);
  a.add({ kind: "project", id: "p1", orgSlug: "e2e-testorg", label: "rgr-x-P" });
  a.add({ kind: "user", id: "u1", orgSlug: "e2e-testorg", label: "rgr-x-u" });
  const b = new Ledger(f); // simulates the next run after a crash
  assert.deepEqual(b.load().map((e) => e.id).sort(), ["p1", "u1"]);
  b.remove("p1");
  assert.deepEqual(new Ledger(f).load().map((e) => e.id), ["u1"]);
});

test("ledger.inDeleteOrder puts children before parents (FK-safe)", () => {
  const l = new Ledger(tmp());
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

test("ledger refuses an entry whose label lacks the rgr- prefix (cannot be swept later)", () => {
  assert.throws(() => new Ledger(tmp()).add({ kind: "project", id: "x", orgSlug: null, label: "Real Project" }), /rgr-/);
});

const ALLOWED = new Set(["e2e-testorg", "rgr-abc-b"]);
const IDS = new Set(["mine1", "mine2"]);
const SA = "/api/v1/superadmin";

test("guard allows mutations to allowed org slugs and reads anywhere", () => {
  assertMutationAllowed("POST", "https://e2e-testorg.test.easeetool.com/api/v1/orgs/e2e-testorg/projects", ALLOWED);
  assertMutationAllowed("DELETE", "/api/v1/orgs/rgr-abc-b/projects/1", ALLOWED);
  assertMutationAllowed("GET", "/api/v1/orgs/cloisons/projects", ALLOWED); // reads are not mutations
  assertMutationAllowed("GET", `${SA}/orgs/anything`, ALLOWED);
  assertMutationAllowed("HEAD", `${SA}/formula-sets/abc`, ALLOWED);
});

test("guard throws BEFORE a mutating request to any other org", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.throws(() => assertMutationAllowed(method, "/api/v1/orgs/cloisons/projects", ALLOWED), GuardError);
  }
  assert.throws(() => assertMutationAllowed("POST", "https://cloisons.easeetool.com/api/v1/orgs/cloisons/users", ALLOWED), GuardError);
});

test("guard: login/logout/admins/org-create/auth always allowed", () => {
  assertMutationAllowed("POST", `${SA}/login`, ALLOWED);
  assertMutationAllowed("POST", `${SA}/logout`, ALLOWED);
  assertMutationAllowed("POST", `${SA}/admins`, ALLOWED);
  assertMutationAllowed("DELETE", `${SA}/admins/a1`, ALLOWED);
  assertMutationAllowed("POST", `${SA}/orgs`, ALLOWED);
  assertMutationAllowed("POST", "/api/auth/sign-in/username", ALLOWED);
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
});

test("guard: roles and component-types need ?orgId in the allowed set", () => {
  for (const base of [`${SA}/roles`, `${SA}/roles/r1`, `${SA}/roles/r1/permissions`, `${SA}/component-types`, `${SA}/component-types/c1`]) {
    assert.throws(() => assertMutationAllowed("POST", base, ALLOWED, IDS), GuardError);
    assert.throws(() => assertMutationAllowed("POST", `${base}?orgId=X`, ALLOWED, IDS), GuardError);
    assertMutationAllowed("POST", `${base}?orgId=mine2`, ALLOWED, IDS);
    assertMutationAllowed("PATCH", `https://easeetool.com${base}?foo=1&orgId=mine2`, ALLOWED, IDS);
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
});

test("guard: unknown superadmin or other mutation targets are refused", () => {
  assert.throws(() => assertMutationAllowed("POST", `${SA}/platform-settings`, ALLOWED, IDS), GuardError);
  assert.throws(() => assertMutationAllowed("POST", "/api/other", ALLOWED, IDS), GuardError);
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
