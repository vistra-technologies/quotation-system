import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROLE_DEFS } from "../../lib/org-role-defaults";
import { PERMISSION_CODES, ROLES, ROLE_NAME, ROLE_PERMISSIONS, deniedRolesFor } from "../regression/api/permissions";

test("regression ROLE_PERMISSIONS mirrors lib/org-role-defaults.ts DEFAULT_ROLE_DEFS exactly", () => {
  const fromDefaults = Object.fromEntries(DEFAULT_ROLE_DEFS.map((d) => [d.name, [...d.permissions].sort()]));
  const fromSuite = Object.fromEntries(ROLES.map((r) => [ROLE_NAME[r], [...ROLE_PERMISSIONS[r]].sort()]));
  assert.deepEqual(fromSuite, fromDefaults);
});

test("every default-role permission is one of the 8 catalog codes", () => {
  const all = new Set(DEFAULT_ROLE_DEFS.flatMap((d) => d.permissions));
  for (const p of all) assert.ok((PERMISSION_CODES as readonly string[]).includes(p), p);
  assert.equal(PERMISSION_CODES.length, 8);
});

test("deniedRolesFor: single, any-of and explicit overrides", () => {
  assert.deepEqual(deniedRolesFor({}), []);
  assert.deepEqual(deniedRolesFor({ permission: "MANAGE_FEATURES" }), ["member", "distributor", "architect"]);
  assert.deepEqual(deniedRolesFor({ permission: "DESIGN" }), ["admin", "member"]);
  assert.deepEqual(deniedRolesFor({ permission: ["DESIGN", "VIEW_ALL_DATA"] }), []);
  assert.deepEqual(deniedRolesFor({ permission: "QUOTE" }), ["admin", "member", "architect"]);
  assert.deepEqual(deniedRolesFor({ permission: "DESIGN", deniedRoles: ["member"] }), ["member"]);
});
