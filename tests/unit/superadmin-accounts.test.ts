/**
 * Unit tests for lib/superadmin-accounts.ts (hotfix 2026-10-02): username/password validation and the
 * delete guard (protected `devadmin`, no self-delete, never the last SuperAdmin).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTED_SUPERADMIN_USERNAME,
  checkDeleteAllowed,
  isProtectedSuperAdmin,
  validateSuperAdminPassword,
  validateSuperAdminUsername,
} from "../../lib/superadmin-accounts";

test("validateSuperAdminUsername: accepts 2–32 char lowercase/digit/._- starting alphanumeric", () => {
  for (const ok of ["ab", "e2e-sa-1", "ishan", "a.b_c-d", "0abc", "a".repeat(32)]) {
    assert.equal(validateSuperAdminUsername(ok), null, ok);
  }
});

test("validateSuperAdminUsername: rejects empty, short, long, uppercase, spaces, bad edges", () => {
  for (const bad of ["", "a", "a".repeat(33), "Admin", "has space", "-lead", ".lead", "_lead", "ünï", "a@b", "a/b"]) {
    assert.notEqual(validateSuperAdminUsername(bad), null, JSON.stringify(bad));
  }
});

test("validateSuperAdminPassword: needs a string of at least 8 characters", () => {
  assert.equal(validateSuperAdminPassword("12345678"), null);
  assert.equal(validateSuperAdminPassword("a much longer passphrase"), null);
  assert.notEqual(validateSuperAdminPassword("1234567"), null);
  assert.notEqual(validateSuperAdminPassword(""), null);
  assert.notEqual(validateSuperAdminPassword(undefined), null);
  assert.notEqual(validateSuperAdminPassword(null), null);
  assert.notEqual(validateSuperAdminPassword(12345678), null);
});

test("isProtectedSuperAdmin: only devadmin, exact match", () => {
  assert.equal(PROTECTED_SUPERADMIN_USERNAME, "devadmin");
  assert.equal(isProtectedSuperAdmin("devadmin"), true);
  assert.equal(isProtectedSuperAdmin("DevAdmin"), false);
  assert.equal(isProtectedSuperAdmin("devadmin2"), false);
  assert.equal(isProtectedSuperAdmin("ishan"), false);
});

test("checkDeleteAllowed: ordinary delete of another account is allowed", () => {
  assert.deepEqual(
    checkDeleteAllowed({ targetUsername: "e2e-sa-1", targetId: "t", actingId: "a", totalAdmins: 4 }),
    { allowed: true },
  );
  // Two admins is enough: deleting one still leaves one.
  assert.equal(
    checkDeleteAllowed({ targetUsername: "x", targetId: "t", actingId: "a", totalAdmins: 2 }).allowed,
    true,
  );
});

test("checkDeleteAllowed: devadmin is protected, even for another admin", () => {
  const r = checkDeleteAllowed({ targetUsername: "devadmin", targetId: "t", actingId: "a", totalAdmins: 5 });
  assert.equal(r.allowed, false);
  assert.equal(!r.allowed && r.reason, "protected");
});

test("checkDeleteAllowed: protected wins over self (devadmin deleting devadmin)", () => {
  const r = checkDeleteAllowed({ targetUsername: "devadmin", targetId: "same", actingId: "same", totalAdmins: 1 });
  assert.equal(!r.allowed && r.reason, "protected");
});

test("checkDeleteAllowed: self-delete is blocked", () => {
  const r = checkDeleteAllowed({ targetUsername: "ishan", targetId: "same", actingId: "same", totalAdmins: 3 });
  assert.equal(!r.allowed && r.reason, "self");
});

test("checkDeleteAllowed: the last remaining SuperAdmin cannot be deleted", () => {
  const r = checkDeleteAllowed({ targetUsername: "solo", targetId: "t", actingId: "a", totalAdmins: 1 });
  assert.equal(!r.allowed && r.reason, "last_admin");
  const zero = checkDeleteAllowed({ targetUsername: "solo", targetId: "t", actingId: "a", totalAdmins: 0 });
  assert.equal(!zero.allowed && zero.reason, "last_admin");
});
