import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, type Snapshot } from "../regression/fixtures/snapshot";

const fp = (over = {}) => ({ counts: { user: 3, project: 5 }, componentTypesHash: "h", isSuspended: false, activeFormulaSetId: "fs1", ...over });
const snap = (orgs: Snapshot["orgs"], globals = {}): Snapshot => ({
  takenAt: "t",
  orgs,
  globals: { formulaSetsHash: "g", superAdmins: ["devadmin"], permissions: ["A"], rolePermissionsHash: "r", ...globals },
});
const ignoreTest = (slug: string) => slug === "e2e-testorg" || slug.startsWith("rgr-");

test("identical snapshots → no diff", () => {
  const s = snap({ cloisons: fp(), "e2e-testorg": fp() });
  assert.deepEqual(diffSnapshots(s, structuredClone(s), ignoreTest), []);
});

test("changes inside the Test Org and rgr- orgs are ignored", () => {
  const before = snap({ cloisons: fp(), "e2e-testorg": fp() });
  const after = snap({ cloisons: fp(), "e2e-testorg": fp({ counts: { user: 99, project: 99 } }), "rgr-x-b": fp() });
  assert.deepEqual(diffSnapshots(before, after, ignoreTest), []);
});

test("a count change in another org is reported with org, table and both numbers", () => {
  const before = snap({ cloisons: fp() });
  const after = snap({ cloisons: fp({ counts: { user: 3, project: 6 } }) });
  const d = diffSnapshots(before, after, ignoreTest);
  assert.equal(d.length, 1);
  assert.match(d[0], /cloisons/);
  assert.match(d[0], /project/);
  assert.match(d[0], /5.*6/);
});

test("suspension flag, active formula set and component-type hash changes are each reported", () => {
  const before = snap({ cloisons: fp() });
  const after = snap({ cloisons: fp({ isSuspended: true, activeFormulaSetId: "fs2", componentTypesHash: "x" }) });
  const d = diffSnapshots(before, after, ignoreTest).join("\n");
  assert.match(d, /isSuspended/);
  assert.match(d, /activeFormulaSetId/);
  assert.match(d, /componentTypesHash/);
});

test("an org that appeared or disappeared (other than rgr-/test) is reported", () => {
  const before = snap({ cloisons: fp() });
  assert.match(diffSnapshots(before, snap({}), ignoreTest).join(), /cloisons.*disappeared/);
  assert.match(diffSnapshots(snap({}), snap({ newco: fp() }), ignoreTest).join(), /newco.*appeared/);
});

test("global fingerprints: formula sets, SuperAdmins, permissions and role-permission links", () => {
  const before = snap({});
  const d = diffSnapshots(
    before,
    snap({}, { formulaSetsHash: "g2", superAdmins: ["devadmin", "ishan"], permissions: ["A", "B"], rolePermissionsHash: "r2" }),
    ignoreTest,
  ).join("\n");
  for (const k of ["formulaSetsHash", "superAdmins", "permissions", "rolePermissionsHash"]) assert.match(d, new RegExp(k));
});

test("SuperAdmins created/deleted by the suite are excluded by the caller before snapshotting (rgr-/e2e-sa-)", () => {
  // contract test: diffSnapshots itself compares verbatim; the DB op filters rgr-/e2e-sa- accounts out.
  const d = diffSnapshots(snap({}, { superAdmins: ["devadmin"] }), snap({}, { superAdmins: ["devadmin", "rgr-x-sa"] }), ignoreTest);
  assert.equal(d.length, 1);
});
