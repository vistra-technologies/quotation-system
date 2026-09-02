// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY omit organizationId filters — they operate across all orgs.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RoleRow {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isInternalRole: boolean;
}

export interface PermissionRow {
  id: string;
  code: string;
  description: string;
}

export interface RolePermissionRow {
  permissionId: string;
  permission: PermissionRow;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List all roles for a given org, A→Z by name.
 *
 * superadmin-only — intentionally cross-org
 */
export async function listRolesForOrg(orgId: string): Promise<RoleRow[]> {
  // superadmin-only — intentionally cross-org
  return prisma.role.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      isInternalRole: true,
    },
  });
}

/**
 * Get a single role by ID, verifying it belongs to the given org.
 * Returns null if not found or if it belongs to a different org (prevents enumeration).
 *
 * superadmin-only — intentionally cross-org
 */
export async function getRoleForOrg(
  orgId: string,
  roleId: string,
): Promise<RoleRow | null> {
  // superadmin-only — intentionally cross-org
  return prisma.role.findFirst({
    where: { id: roleId, organizationId: orgId },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      isInternalRole: true,
    },
  });
}

/**
 * List permissions currently granted to a role, A→Z by code.
 * Verifies role belongs to the given org first (prevents cross-org read leaks).
 *
 * superadmin-only — intentionally cross-org
 */
export async function listRolePermissionsForOrg(
  orgId: string,
  roleId: string,
): Promise<RolePermissionRow[] | null> {
  // superadmin-only — intentionally cross-org
  // Verify role belongs to org before reading its permissions.
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: orgId },
    select: { id: true },
  });
  if (!role) return null;

  return prisma.rolePermission.findMany({
    where: { roleId },
    include: {
      permission: {
        select: { id: true, code: true, description: true },
      },
    },
    orderBy: { permission: { code: "asc" } },
  });
}

/**
 * List the global Permission catalog, A→Z by code.
 * No org filter — permissions are global by design.
 *
 * superadmin-only — intentionally cross-org
 */
export async function listAllPermissionsCatalog(): Promise<PermissionRow[]> {
  // superadmin-only — intentionally cross-org
  return prisma.permission.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, description: true },
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new role scoped to the given org. Returns the created role.
 *
 * superadmin-only — intentionally cross-org
 */
export async function createRoleForOrg(
  orgId: string,
  name: string,
  description: string | null,
): Promise<RoleRow> {
  // superadmin-only — intentionally cross-org
  return prisma.role.create({
    data: {
      organizationId: orgId,
      name,
      description,
    },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      isInternalRole: true,
    },
  });
}

/**
 * Rename an existing role. Verifies the role belongs to the given org first.
 * Returns the updated role, or null if the role was not found / wrong org.
 *
 * superadmin-only — intentionally cross-org
 */
export async function updateRoleNameForOrg(
  orgId: string,
  roleId: string,
  name: string,
): Promise<RoleRow | null> {
  // superadmin-only — intentionally cross-org
  // Verify ownership before updating.
  const existing = await prisma.role.findFirst({
    where: { id: roleId, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return null;

  return prisma.role.update({
    where: { id: roleId },
    data: { name },
    select: {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      isInternalRole: true,
    },
  });
}

/**
 * Grant a permission to a role (upsert — idempotent if already granted).
 * Verifies the role belongs to the given org first.
 * Returns false if the role was not found / wrong org.
 *
 * superadmin-only — intentionally cross-org
 */
export async function grantRolePermissionForOrg(
  orgId: string,
  roleId: string,
  permissionId: string,
): Promise<boolean> {
  // superadmin-only — intentionally cross-org
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: orgId },
    select: { id: true },
  });
  if (!role) return false;

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    create: { roleId, permissionId },
    update: {},
  });

  return true;
}

/**
 * Revoke a permission from a role.
 * Verifies the role belongs to the given org first.
 * Returns false if the role was not found / wrong org.
 *
 * superadmin-only — intentionally cross-org
 */
export async function revokeRolePermissionForOrg(
  orgId: string,
  roleId: string,
  permissionId: string,
): Promise<boolean> {
  // superadmin-only — intentionally cross-org
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: orgId },
    select: { id: true },
  });
  if (!role) return false;

  await prisma.rolePermission.delete({
    where: { roleId_permissionId: { roleId, permissionId } },
  });

  return true;
}

// ─── Audit log ────────────────────────────────────────────────────────────────

/**
 * Write a SuperAdminAuditLog row for a role or permission mutation (append-only).
 *
 * Must be called after a successful mutation, not inside the mutation transaction
 * (so the audit log row is only written if the mutation committed).
 *
 * Intentionally NOT wrapped in try/catch here — an audit log write failure must
 * propagate as an error rather than being silently swallowed (Batch C round-2
 * discipline: every mutation must have an audit row; on retry the mutation is
 * idempotent so the admin sees a clear signal rather than a silent gap).
 *
 * superadmin-only — intentionally cross-org
 */
export async function createRoleAuditLog(
  superAdminId: string,
  roleId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // superadmin-only — intentionally cross-org
  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId,
      action,
      targetType: "Role",
      targetId: roleId,
      // Prisma nullable Json: omit the key when no metadata rather than passing null.
      ...(metadata !== undefined
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
