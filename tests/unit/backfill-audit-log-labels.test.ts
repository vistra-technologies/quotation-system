/**
 * Unit tests for prisma/backfill-audit-log-labels.ts `planRow` (pure): fills only NULL columns, never
 * misclassifies platform-scope rows, and matches the audit writer's derivation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRow, type AuditRow, type Lookups } from "../../prisma/backfill-audit-log-labels";

const lk: Lookups = {
  adminUsernameById: new Map([["sa1", "root"]]),
  orgSlugById: new Map([["org1", "cloisons"]]),
  liveLabel: new Map([["Role:r1", "Sales"], ["FormulaSet:f1", "set v2"]]),
};
const base: AuditRow = {
  id: "a", superAdminId: "sa1", targetType: "Role", targetId: "r1", metadata: null,
  superAdminUsername: null, organizationId: null, organizationSlug: null, targetLabel: null,
};

test("platform-scope row: organizationId stays NULL, others fill", () => {
  const p = planRow(base, lk);
  assert.deepEqual(p.fill, { superAdminUsername: "root", targetLabel: "Sales" });
  assert.ok(p.remains.organizationId);
  assert.ok(p.remains.organizationSlug);
});

test("org derived from metadata.orgId or organizationId, slug from live org", () => {
  for (const metadata of [{ orgId: "org1" }, { organizationId: "org1" }]) {
    const p = planRow({ ...base, metadata }, lk);
    assert.equal(p.fill.organizationId, "org1");
    assert.equal(p.fill.organizationSlug, "cloisons");
  }
});

test("deleted Organization target: id = targetId, slug and label from metadata", () => {
  const p = planRow({ ...base, targetType: "Organization", targetId: "gone", metadata: { slug: "old-co" } }, lk);
  assert.equal(p.fill.organizationId, "gone");
  assert.equal(p.fill.organizationSlug, "old-co");
  assert.equal(p.fill.targetLabel, "old-co");
});

test("never plans a write to a non-NULL column", () => {
  const full: AuditRow = {
    ...base, superAdminUsername: "x", organizationId: "org1", organizationSlug: "y", targetLabel: "z", metadata: { orgId: "other" },
  };
  const p = planRow(full, lk);
  assert.deepEqual(p.fill, {});
  assert.deepEqual(p.remains, {});
});

test("unresolvable: deleted admin / deleted target without metadata stays NULL with a reason", () => {
  const p = planRow({ ...base, superAdminId: null, targetId: "gone" }, lk);
  assert.deepEqual(p.fill, {});
  assert.ok(p.remains.superAdminUsername && p.remains.targetLabel);
});

test("stored organizationId with NULL slug: slug filled, id untouched", () => {
  const p = planRow({ ...base, organizationId: "org1", superAdminUsername: "root", targetLabel: "Sales" }, lk);
  assert.deepEqual(p.fill, { organizationSlug: "cloisons" });
});
