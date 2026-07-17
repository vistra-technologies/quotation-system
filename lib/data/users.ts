import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { toAuthEmail } from "@/lib/auth-utils";
import type { SessionData } from "@/lib/session";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** List all users in the session org, A→Z by username, with role name. */
export async function listUsers(session: SessionData) {
  return prisma.user.findMany({
    where: { organizationId: session.organizationId },
    include: { role: { select: { name: true } } },
    orderBy: { username: "asc" },
  });
}

/**
 * Get one user by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getUserById(session: SessionData, userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, organizationId: session.organizationId },
    include: { role: { select: { name: true } } },
  });
}

/**
 * Tenancy guard: assert a user exists in the given org.
 * Throws a generic error on failure so callers cannot distinguish
 * "not found" from "wrong org" (prevents enumeration).
 */
export async function assertUserInOrg(userId: string, organizationId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!user) throw new Error("User not found or access denied");
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export type CreateUserInput = {
  username: string;
  roleId: string;
  externalCompanyId: string | null;
  password: string;
};

/**
 * Create a new user + better-auth credential account in a single transaction.
 *
 * Tenancy guards (all throw on failure):
 *   - role must belong to session org
 *   - externalCompany (if supplied) must belong to session org
 *   - username must be unique within session org
 *
 * The password is hashed with better-auth's own hasher (same Scrypt impl as sign-in).
 * The synthetic email uses toAuthEmail(username, orgSlug) so better-auth can route sign-ins.
 */
export async function createUser(session: SessionData, input: CreateUserInput): Promise<void> {
  const { username, roleId, externalCompanyId, password } = input;

  // Tenancy guard: role must belong to this org.
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");

  // Tenancy guard: external company (if supplied) must belong to this org.
  if (externalCompanyId) {
    const ec = await prisma.externalCompany.findFirst({
      where: { id: externalCompanyId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!ec) throw new Error("External company not found or access denied");
  }

  // Username uniqueness within org — throw so the action can surface it as form state.
  const existing = await prisma.user.findFirst({
    where: { organizationId: session.organizationId, username },
    select: { id: true },
  });
  if (existing) throw new Error(`Username "${username}" is already taken in this organization`);

  // Org slug for the synthetic auth email: {username}@{slug}.internal
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { slug: true },
  });
  if (!org) throw new Error("Organization not found");

  const synthEmail = toAuthEmail(username, org.slug);

  // Hash with better-auth's own hasher (Scrypt) — identical to the sign-in path.
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(password);

  // Atomic: user row + credential account in one transaction.
  await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: username,
        email: synthEmail,
        emailVerified: false,
        organizationId: session.organizationId,
        username,
        active: true,
        roleId,
        externalCompanyId: externalCompanyId ?? null,
      },
    });
    await tx.account.create({
      data: {
        userId: newUser.id,
        providerId: "credential",
        accountId: newUser.id,
        password: passwordHash,
      },
    });
  });
}

/** Activate a user (sets active = true). Tenancy guard: user must be in session org. */
export async function activateUser(session: SessionData, userId: string): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  await prisma.user.update({ where: { id: userId }, data: { active: true } });
}

/**
 * Deactivate a user (sets active = false).
 * Tenancy guard: user must be in session org.
 * Prevents self-deactivation — the admin would be locked out immediately.
 */
export async function deactivateUser(session: SessionData, userId: string): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  if (userId === session.userId) {
    throw new Error("You cannot deactivate your own account");
  }
  await prisma.user.update({ where: { id: userId }, data: { active: false } });
}

/**
 * Change a user's role.
 * Tenancy guards: user in org, new role in org.
 */
export async function changeUserRole(
  session: SessionData,
  userId: string,
  newRoleId: string,
): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  const role = await prisma.role.findFirst({
    where: { id: newRoleId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!role) throw new Error("Role not found or access denied");
  await prisma.user.update({ where: { id: userId }, data: { roleId: newRoleId } });
}

/**
 * Admin-set password: hashes the new password and writes it to the credential account.
 * The password is never logged, echoed, or returned.
 * Tenancy guard: user must be in session org.
 */
export async function setUserPassword(
  session: SessionData,
  userId: string,
  newPassword: string,
): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(newPassword);
  await prisma.account.updateMany({
    where: { userId, providerId: "credential" },
    data: { password: passwordHash },
  });
}
