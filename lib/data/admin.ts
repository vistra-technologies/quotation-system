import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Health ────────────────────────────────────────────────────────────────

/** Liveness probe: count HealthCheck rows to prove DB connectivity. */
export async function pingHealthCheck(): Promise<number> {
  return prisma.healthCheck.count();
}

// ─── Organizations ──────────────────────────────────────────────────────────

/** List all organizations, oldest-first (for /organizations diagnostic page). */
export async function listOrganizations() {
  return prisma.organization.findMany({ orderBy: { createdAt: "asc" } });
}

/** List organizations as minimal selector items (for apex / page). */
export async function listOrganizationsForSelector() {
  return prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
}

/**
 * Look up an org by URL slug.
 * Used on the login page as a defensive guard against unknown slugs.
 */
export async function getOrgBySlug(slug: string) {
  return prisma.organization.findUnique({
    where: { slug },
    select: { name: true },
  });
}

/**
 * Look up an org by id.
 * Used on the dashboard identity panel and the login cross-org notice.
 */
export async function getOrgById(orgId: string) {
  return prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true },
  });
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

/** The session role's name (for the dashboard identity panel). */
export async function getSessionRole(session: SessionData) {
  return prisma.role.findUnique({
    where: { id: session.roleId },
    select: { name: true },
  });
}

/**
 * Effective permission codes for the session role.
 * Used by the dashboard to decide which nav links to render.
 */
export async function getSessionRolePermissions(session: SessionData): Promise<string[]> {
  const rps = await prisma.rolePermission.findMany({
    where: { roleId: session.roleId },
    include: { permission: { select: { code: true } } },
  });
  return rps.map((rp) => rp.permission.code);
}

// ─── Admin layout ───────────────────────────────────────────────────────────

/**
 * Fetch the admin-relevant permission codes (MANAGE_USERS + MANAGE_FEATURES)
 * held by the session role.
 *
 * Single query: gates the whole /admin/* sub-tree AND drives which nav links
 * to render. If the returned array is empty the caller should redirect to dashboard.
 */
export async function getAdminPermissions(session: SessionData): Promise<string[]> {
  const rps = await prisma.rolePermission.findMany({
    where: {
      roleId: session.roleId,
      permission: { code: { in: ["MANAGE_USERS", "MANAGE_FEATURES"] } },
    },
    include: { permission: { select: { code: true } } },
  });
  return rps.map((rp) => rp.permission.code);
}

// ─── Roles ──────────────────────────────────────────────────────────────────

/** List all roles for the session org, A→Z. */
export async function listRoles(session: SessionData) {
  return prisma.role.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
  });
}

/** List roles as id/name pairs for form dropdowns. */
export async function listRolesForDropdown(session: SessionData) {
  return prisma.role.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Get a role by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getRoleById(session: SessionData, roleId: string) {
  return prisma.role.findFirst({
    where: { id: roleId, organizationId: session.organizationId },
  });
}

/** Create a new role scoped to the session org. Returns the full role row. */
export async function createRole(
  session: SessionData,
  input: { name: string; description: string | null },
) {
  return prisma.role.create({
    data: {
      organizationId: session.organizationId,
      name: input.name,
      description: input.description,
    },
  });
}

/**
 * Tenancy guard: assert a role belongs to the given organization.
 * Throws a generic error on failure so callers cannot distinguish
 * "not found" from "wrong org" (prevents enumeration).
 */
export async function assertRoleInOrg(roleId: string, organizationId: string): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");
}

// ─── RolePermissions ────────────────────────────────────────────────────────

/** Permissions currently granted to a role, with permission details, A→Z by code. */
export async function listRolePermissions(roleId: string) {
  return prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: true },
    orderBy: { permission: { code: "asc" } },
  });
}

/**
 * Idempotent grant of a permission to a role (upsert on composite PK).
 * Tenancy guard: role must belong to the session org.
 */
export async function addRolePermission(
  session: SessionData,
  roleId: string,
  permissionId: string,
): Promise<void> {
  await assertRoleInOrg(roleId, session.organizationId);
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId, permissionId } },
    create: { roleId, permissionId },
    update: {},
  });
}

/**
 * Revoke a permission from a role.
 * Tenancy guard: role must belong to the session org.
 */
export async function removeRolePermission(
  session: SessionData,
  roleId: string,
  permissionId: string,
): Promise<void> {
  await assertRoleInOrg(roleId, session.organizationId);
  await prisma.rolePermission.delete({
    where: { roleId_permissionId: { roleId, permissionId } },
  });
}

// ─── Permissions ────────────────────────────────────────────────────────────

/** Global permission catalog, A→Z. No org filter — permissions are global by design. */
export async function listPermissions() {
  return prisma.permission.findMany({ orderBy: { code: "asc" } });
}

/**
 * Create a global Permission row.
 * Throws on duplicate code (P2002) — caller catches and converts to user error.
 * ⚠ Creating a row grants no capability until a developer wires it in code.
 */
export async function createPermission(input: {
  code: string;
  description: string;
}): Promise<void> {
  await prisma.permission.create({ data: { code: input.code, description: input.description } });
}

// ─── External companies ─────────────────────────────────────────────────────

/** List external companies for the session org, A→Z, as id/name pairs. */
export async function listExternalCompanies(session: SessionData) {
  return prisma.externalCompany.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
