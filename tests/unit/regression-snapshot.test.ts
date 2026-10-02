import { test } from "node:test";
import assert from "node:assert/strict";
import { diffSnapshots, type Snapshot } from "../regression/fixtures/snapshot";

const fp = (over = {}) => ({
  counts: { user: 3, project: 5 },
  componentTypesHash: "h",
  rolePermissionsHash: "rp",
  rowsHash: { project: "p1", user: "u1" },
  orgRowHash: "o1",
  isSuspended: false,
  activeFormulaSetId: "fs1",
  ...over,
});
const snap = (orgs: Snapshot["orgs"], globals = {}): Snapshot => ({
  takenAt: "t",
  orgs,
  globals: { formulaSetsHash: "g", superAdmins: ["devadmin"], permissions: ["A"], ...globals },
});
const ignoreTest = (slug: string) => slug === "e2e-testorg" || slug.startsWith("rgr-");

test("identical snapshots → no diff", () => {
  const s = snap({ cloisons: fp(), "e2e-testorg": fp() });
  assert.deepEqual(diffSnapshots(s, structuredClone(s), ignoreTest), []);
});

test("takenAt is never compared", () => {
  const s = snap({ cloisons: fp() });
  assert.deepEqual(diffSnapshots(s, { ...structuredClone(s), takenAt: "later" }, ignoreTest), []);
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

test("global fingerprints: formula sets, SuperAdmins and permissions", () => {
  const d = diffSnapshots(
    snap({}),
    snap({}, { formulaSetsHash: "g2", superAdmins: ["devadmin", "ishan"], permissions: ["A", "B"] }),
    ignoreTest,
  ).join("\n");
  for (const k of ["formulaSetsHash", "superAdmins", "permissions"]) assert.match(d, new RegExp(k));
  assert.doesNotMatch(d, /rolePermissionsHash/);
});

test("a SuperAdmin added is reported as exactly one global difference", () => {
  const d = diffSnapshots(snap({}, { superAdmins: ["devadmin"] }), snap({}, { superAdmins: ["devadmin", "rgr-x-sa"] }), ignoreTest);
  assert.equal(d.length, 1);
});

test("a table present on only one side is reported as a count change", () => {
  const d = diffSnapshots(snap({ cloisons: fp({ counts: { user: 3 } }) }), snap({ cloisons: fp({ counts: { user: 3, floor: 2 } }) }), ignoreTest);
  assert.equal(d.length, 1);
  assert.match(d[0], /floor count 0 .* 2/);
});

test("activeFormulaSetId null → value is reported", () => {
  const d = diffSnapshots(snap({ cloisons: fp({ activeFormulaSetId: null }) }), snap({ cloisons: fp() }), ignoreTest);
  assert.equal(d.length, 1);
  assert.match(d[0], /activeFormulaSetId null .* "fs1"/);
});

test("the same change is reported as a global but ignored inside an ignored org", () => {
  const before = snap({ "e2e-testorg": fp() }, { permissions: ["A"] });
  const after = snap({ "e2e-testorg": fp({ isSuspended: true, rolePermissionsHash: "zz" }) }, { permissions: ["A", "B"] });
  const d = diffSnapshots(before, after, ignoreTest);
  assert.equal(d.length, 1);
  assert.match(d[0], /global permissions/);
});

test("per-org rolePermissionsHash change is reported for a real org, not for ignored orgs", () => {
  const before = snap({ cloisons: fp(), "e2e-testorg": fp(), "rgr-x-b": fp() });
  const after = snap({
    cloisons: fp({ rolePermissionsHash: "new" }),
    "e2e-testorg": fp({ rolePermissionsHash: "new" }),
    "rgr-x-b": fp({ rolePermissionsHash: "new" }),
  });
  const d = diffSnapshots(before, after, ignoreTest);
  assert.equal(d.length, 1);
  assert.match(d[0], /cloisons.*rolePermissionsHash/);
});

test("rowsHash change reports 'rows modified' per table; ignored orgs stay ignored", () => {
  const before = snap({ cloisons: fp(), "e2e-testorg": fp() });
  const after = snap({
    cloisons: fp({ rowsHash: { project: "p2", user: "u1" } }),
    "e2e-testorg": fp({ rowsHash: { project: "zz", user: "zz" } }),
  });
  assert.deepEqual(diffSnapshots(before, after, ignoreTest), ['org "cloisons": project rows modified']);
});

test("a table gaining a rowsHash entry is reported as rows modified", () => {
  const d = diffSnapshots(
    snap({ cloisons: fp({ rowsHash: { project: "p1" } }) }),
    snap({ cloisons: fp({ rowsHash: { project: "p1", floor: "f" } }) }),
    ignoreTest,
  );
  assert.deepEqual(d, ['org "cloisons": floor rows modified']);
});

test("orgRowHash change reports 'org row modified'; ignored orgs stay ignored", () => {
  const before = snap({ cloisons: fp(), "e2e-testorg": fp() });
  const after = snap({ cloisons: fp({ orgRowHash: "o2" }), "e2e-testorg": fp({ orgRowHash: "o2" }) });
  assert.deepEqual(diffSnapshots(before, after, ignoreTest), ['org "cloisons": org row modified']);
});
