import { test } from "node:test";
import assert from "node:assert/strict";
import {
  drainOrder,
  isRunAdminUsername,
  isDeletableOrgSlug,
  isDeletableSuperAdminUsername,
  runIdOf,
  recoverDecision,
  RECOVER_MIN_AGE_MS,
  generateRunPassword,
} from "../regression/fixtures/cleanup-rules";
import { DELETE_ORDER, type LedgerEntry, type LedgerKind } from "../regression/fixtures/ledger";

const entry = (kind: string, label: string): LedgerEntry =>
  ({ kind: kind as LedgerKind, id: `${kind}-${label}`, orgSlug: "e2e-testorg", label, createdAt: "" });

test("drainOrder follows DELETE_ORDER for every LedgerKind", () => {
  const shuffled = [...DELETE_ORDER].reverse().map((k) => entry(k, `rgr-x-${k}`));
  assert.deepEqual(drainOrder(shuffled).map((e) => e.kind), DELETE_ORDER);
});

test("drainOrder moves the run admin after externalCompany (its session deletes the company)", () => {
  const out = drainOrder([
    entry("org", "rgr-x-b"),
    entry("externalCompany", "rgr-x-Co"),
    entry("user", "rgr-x-admin"),
    entry("user", "rgr-x-member"),
    entry("project", "rgr-x-p"),
  ]).map((e) => e.label);
  assert.deepEqual(out, ["rgr-x-p", "rgr-x-member", "rgr-x-Co", "rgr-x-admin", "rgr-x-b"]);
});

test("drainOrder sorts unknown kinds LAST, never first", () => {
  const out = drainOrder([entry("bogus", "rgr-x-z"), entry("org", "rgr-x-b"), entry("project", "rgr-x-p")]);
  assert.deepEqual(out.map((e) => e.kind), ["project", "org", "bogus"]);
});

test("isRunAdminUsername", () => {
  assert.ok(isRunAdminUsername("rgr-mur9trki-admin"));
  assert.ok(!isRunAdminUsername("admin"));
  assert.ok(!isRunAdminUsername("rgr-mur9trki-member"));
});

test("isDeletableOrgSlug: only rgr- orgs", () => {
  assert.ok(isDeletableOrgSlug("rgr-mur9trki-b"));
  for (const s of ["e2e-testorg", "cloisons", "rgr-", "", "xrgr-a"]) assert.ok(!isDeletableOrgSlug(s), s);
});

test("isDeletableSuperAdminUsername: only rgr- / e2e-sa- admins", () => {
  assert.ok(isDeletableSuperAdminUsername("rgr-abc-sa"));
  assert.ok(isDeletableSuperAdminUsername("e2e-sa-123"));
  for (const u of ["testeraccount", "root", "e2e-x", "rgr-", ""]) assert.ok(!isDeletableSuperAdminUsername(u), u);
});

test("runIdOf parses rgr-<base36 runId>-…", () => {
  const id = (1_790_000_000_000).toString(36);
  assert.equal(runIdOf(`rgr-${id}-admin`)?.runId, id);
  assert.equal(runIdOf(`rgr-${id}-admin`)?.startedAt, 1_790_000_000_000);
  assert.equal(runIdOf("rgr-nohyphen"), null);
  assert.equal(runIdOf("cloisons"), null);
});

test("recoverDecision: older than the threshold → delete; younger / unparseable / future → skip with a reason", () => {
  const now = 1_790_000_000_000;
  const label = (ms: number) => `rgr-${ms.toString(36)}-admin`;
  assert.equal(RECOVER_MIN_AGE_MS, 2 * 60 * 60 * 1000);
  assert.equal(recoverDecision(label(now - RECOVER_MIN_AGE_MS - 1), now, RECOVER_MIN_AGE_MS).delete, true);
  const young = recoverDecision(label(now - 60_000), now, RECOVER_MIN_AGE_MS);
  assert.equal(young.delete, false);
  assert.match(young.reason!, /younger/);
  assert.equal(recoverDecision("rgr-zz-admin", now, RECOVER_MIN_AGE_MS).delete, false); // implausible timestamp
  assert.equal(recoverDecision(label(now + 3_600_000), now, RECOVER_MIN_AGE_MS).delete, false); // future
  assert.equal(recoverDecision("rgr-oops", now, RECOVER_MIN_AGE_MS).delete, false);
  // the test seam: min age 0 deletes a just-crashed run's rows
  assert.equal(recoverDecision(label(now - 1), now, 0).delete, true);
});

test("generateRunPassword: fresh, long, mixed", () => {
  const a = generateRunPassword();
  const b = generateRunPassword();
  assert.notEqual(a, b);
  assert.ok(a.length >= 20);
  assert.match(a, /[A-Z]/);
  assert.match(a, /[a-z]/);
  assert.match(a, /[0-9]/);
});
