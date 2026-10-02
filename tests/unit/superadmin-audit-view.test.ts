/**
 * Unit tests for lib/superadmin-audit-view.ts (hotfix 2026-10-02): action → INSERT/UPDATE/DELETE + Item +
 * summary mapping, org/label derivation from the inconsistent metadata keys, and filter validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_ACTIONS,
  deriveOrganizationId,
  itemForTargetType,
  labelFromMetadata,
  parseAuditFilters,
  summarizeAction,
  targetTypesForItem,
  verbForAction,
} from "../../lib/superadmin-audit-view";

const parse = (q: Record<string, string>) => parseAuditFilters((k) => q[k] ?? null);

test("verbForAction: creates and new versions are INSERT, deletes are DELETE, the rest UPDATE", () => {
  const expected: Record<string, string> = {
    "org.create": "INSERT", "user.create": "INSERT", "role.create": "INSERT",
    "componentType.create": "INSERT", "formulaSet.create": "INSERT", "formulaSet.newVersion": "INSERT",
    "superadmin.create": "INSERT",
    "org.delete": "DELETE", "user.delete": "DELETE", "componentType.delete": "DELETE",
    "formulaSet.delete": "DELETE", "superadmin.delete": "DELETE",
    "org.update": "UPDATE", "org.suspend": "UPDATE", "org.reactivate": "UPDATE", "user.update": "UPDATE",
    "role.rename": "UPDATE", "permission.assign": "UPDATE", "permission.revoke": "UPDATE",
    "componentType.update": "UPDATE", "componentType.reorder": "UPDATE", "formulaSet.update": "UPDATE",
    "superadmin.password_change": "UPDATE",
  };
  for (const a of KNOWN_ACTIONS) assert.equal(verbForAction(a), expected[a], a);
  assert.equal(Object.keys(expected).length, KNOWN_ACTIONS.length, "every known action has an expectation");
});

test("verbForAction: an unknown action falls back to UPDATE", () => {
  assert.equal(verbForAction("something.weird"), "UPDATE");
  assert.equal(verbForAction("nodot"), "UPDATE");
});

test("itemForTargetType / targetTypesForItem round-trip; unknown types pass through", () => {
  assert.equal(itemForTargetType("FormulaSet"), "Formula set");
  assert.equal(itemForTargetType("ComponentType"), "Component type");
  assert.equal(itemForTargetType("SuperAdmin"), "SuperAdmin");
  assert.equal(itemForTargetType("Mystery"), "Mystery");
  assert.deepEqual(targetTypesForItem("Formula set"), ["FormulaSet"]);
  assert.deepEqual(targetTypesForItem("Nope"), []);
});

test("deriveOrganizationId: Organization target is the org; others read organizationId then orgId", () => {
  assert.equal(deriveOrganizationId("Organization", "org1", {}), "org1");
  assert.equal(deriveOrganizationId("User", "u1", { organizationId: "orgA" }), "orgA");
  assert.equal(deriveOrganizationId("Role", "r1", { orgId: "orgB" }), "orgB");
  assert.equal(deriveOrganizationId("ComponentType", "c1", { orgId: "orgC", orgName: "C" }), "orgC");
  assert.equal(deriveOrganizationId("User", "u1", { organizationId: "orgA", orgId: "orgZ" }), "orgA");
});

test("deriveOrganizationId: platform-level rows (SuperAdmin, FormulaSet) have no org", () => {
  assert.equal(deriveOrganizationId("SuperAdmin", "s1", { username: "x" }), null);
  assert.equal(deriveOrganizationId("FormulaSet", "f1", { name: "n", version: 3 }), null);
  assert.equal(deriveOrganizationId("User", "u1", undefined), null);
  assert.equal(deriveOrganizationId("User", "u1", null), null);
  assert.equal(deriveOrganizationId("User", "u1", { organizationId: "  " }), null);
  assert.equal(deriveOrganizationId("User", "u1", { organizationId: 42 }), null);
});

test("labelFromMetadata: picks the best name a deleted target left behind", () => {
  assert.equal(labelFromMetadata({ deletedUsername: "paulson" }), "paulson");
  assert.equal(labelFromMetadata({ username: "e2e-sa-1" }), "e2e-sa-1");
  assert.equal(labelFromMetadata({ slug: "acme", name: "Acme Glass" }), "acme");
  assert.equal(labelFromMetadata({ newName: "Sales" }), "Sales");
  assert.equal(labelFromMetadata({ code: "DOOR", orgName: "x" }), "DOOR");
  assert.equal(labelFromMetadata({ name: "glass-partition-standard", version: 3 }), "glass-partition-standard v3");
  assert.equal(labelFromMetadata({ name: "Only A Name" }), "Only A Name");
  assert.equal(labelFromMetadata({}), null);
  assert.equal(labelFromMetadata(null), null);
});

test("summarizeAction: plain-English line per action; never echoes password-ish fields", () => {
  assert.equal(summarizeAction("org.suspend", null), "Suspended");
  assert.equal(summarizeAction("org.delete", { usersDeleted: 2 }), "Deleted with 2 users");
  assert.equal(summarizeAction("org.delete", { usersDeleted: 1 }), "Deleted with 1 user");
  assert.equal(summarizeAction("org.update", { formulaSetId: "x" }), "Changed formula set");
  assert.equal(summarizeAction("org.update", { name: "N", formulaSetId: "x" }), "Changed name, formula set");
  assert.equal(summarizeAction("user.update", { changedFields: ["roleId", "mobile"] }), "Changed role, mobile");
  assert.equal(summarizeAction("user.update", { changedFields: ["newPassword"] }), "Changed password");
  assert.equal(summarizeAction("componentType.update", { changedFields: ["fieldsSchema"] }), "Changed field schema");
  assert.equal(summarizeAction("role.rename", { newName: "Sales" }), "Renamed to Sales");
  assert.equal(summarizeAction("superadmin.password_change", { sessionsRevoked: 1 }), "Password changed · 1 session signed out");
  assert.equal(summarizeAction("superadmin.password_change", { sessionsRevoked: 0 }), "Password changed");
  assert.equal(summarizeAction("superadmin.delete", { deletedUsername: "x" }), "SuperAdmin account deleted");
  // Unknown action: still renders something sensible.
  assert.equal(summarizeAction("brand.new", { changedFields: ["a", "b"] }), "Changed a, b");
  assert.equal(summarizeAction("brand.new", null), "brand.new");
  for (const a of KNOWN_ACTIONS) assert.ok(summarizeAction(a, {}).length > 0, a);
});

test("parseAuditFilters: defaults when nothing is set", () => {
  const r = parse({});
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.filters, {
      scope: "all", orgId: null, by: null, verb: null, item: null, from: null, to: null, page: 1, pageSize: 50,
    });
  }
});

test("parseAuditFilters: accepts a full valid combination; blank values count as unset", () => {
  const r = parse({
    scope: "org", orgId: "org1", by: "devadmin", verb: "UPDATE", item: "Formula set",
    from: "2026-10-01", to: "2026-10-02", page: "3", pageSize: "100",
  });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.filters, {
    scope: "org", orgId: "org1", by: "devadmin", verb: "UPDATE", item: "Formula set",
    from: "2026-10-01", to: "2026-10-02", page: 3, pageSize: 100,
  });
  const blank = parse({ scope: "", verb: "  ", by: "", page: "" });
  assert.ok(blank.ok);
});

test("parseAuditFilters: rejects bad values with a message", () => {
  const bad: Array<[Record<string, string>, RegExp]> = [
    [{ scope: "everything" }, /scope/],
    [{ orgId: "o1" }, /orgId/],                       // orgId without scope=org
    [{ scope: "platform", orgId: "o1" }, /orgId/],
    [{ verb: "insert" }, /verb/],                     // case-sensitive
    [{ verb: "UPSERT" }, /verb/],
    [{ item: "Widget" }, /item/],
    [{ from: "2026-13-01" }, /from/],
    [{ from: "2026-02-30" }, /from/],                 // not a real date
    [{ from: "10/01/2026" }, /from/],
    [{ to: "yesterday" }, /to/],
    [{ from: "2026-10-05", to: "2026-10-01" }, /from must not be after to/],
    [{ page: "0" }, /page/],
    [{ page: "-1" }, /page/],
    [{ page: "1.5" }, /page/],
    [{ page: "abc" }, /page/],
    [{ pageSize: "0" }, /pageSize/],
    [{ pageSize: "101" }, /pageSize/],
    [{ pageSize: "x" }, /pageSize/],
  ];
  for (const [q, re] of bad) {
    const r = parse(q);
    assert.equal(r.ok, false, JSON.stringify(q));
    if (!r.ok) assert.match(r.error, re, JSON.stringify(q));
  }
});

test("parseAuditFilters: from == to is a valid single-day range", () => {
  assert.ok(parse({ from: "2026-10-02", to: "2026-10-02" }).ok);
});
