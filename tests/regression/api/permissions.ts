import type { Role } from "../fixtures/run-state";

/** The global permission catalog (lib/rbac.ts PERMISSIONS / the 8 seeded Permission rows). */
export const PERMISSION_CODES = [
  "MANAGE_USERS",
  "MANAGE_FEATURES",
  "VIEW_ALL_DATA",
  "MANAGE_PRICING",
  "APPLY_DISCOUNT",
  "DESIGN",
  "QUOTE",
  "ORDER",
] as const;
export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Test-Org role name per suite role (the default role set every org is created with). */
export const ROLE_NAME: Record<Role, string> = {
  admin: "Admin",
  member: "Company Member",
  distributor: "Distributor",
  architect: "Architectural Firm",
};

/**
 * Mirrors lib/org-role-defaults.ts DEFAULT_ROLE_DEFS. tests/unit/regression-permissions.test.ts asserts
 * they are equal, so a change to the defaults fails the unit suite until this table (and every 403
 * expectation derived from it) is updated.
 */
export const ROLE_PERMISSIONS: Record<Role, PermissionCode[]> = {
  admin: ["MANAGE_USERS", "MANAGE_FEATURES", "VIEW_ALL_DATA", "MANAGE_PRICING", "APPLY_DISCOUNT"],
  member: ["VIEW_ALL_DATA", "MANAGE_PRICING", "APPLY_DISCOUNT"],
  distributor: ["DESIGN", "QUOTE", "ORDER"],
  architect: ["DESIGN"],
};

export const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

/** Roles that must get 403: explicit `deniedRoles`, else those holding none of `permission` (any-of). */
export function deniedRolesFor(c: { permission?: PermissionCode | PermissionCode[]; deniedRoles?: Role[] }): Role[] {
  if (c.deniedRoles) return c.deniedRoles;
  if (!c.permission) return [];
  const need = Array.isArray(c.permission) ? c.permission : [c.permission];
  return ROLES.filter((r) => !need.some((p) => ROLE_PERMISSIONS[r].includes(p)));
}
