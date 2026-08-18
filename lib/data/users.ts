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
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
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
  const { username, firstName, lastName, mobile, profileEmail, roleId, externalCompanyId, password } = input;

  // Tenancy guard: role must belong to this org.
  const role = await prisma.role.findFirst({
    where: { id: roleId, organizationId: session.organizationId },
    select: { id: true, isInternalRole: true },
  });
  if (!role) throw new Error("Role not found or access denied");

  // U3 enforcement on create: external roles require an external company.
  if (!role.isInternalRole && !externalCompanyId) {
    throw new Error("External company is required for this role");
  }

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
        // better-auth core display name — use full name going forward
        name: `${firstName} ${lastName}`,
        email: synthEmail,
        emailVerified: false,
        organizationId: session.organizationId,
        username,
        firstName,
        lastName,
        mobile: mobile ?? null,
        profileEmail: profileEmail ?? null,
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

export type UpdateUserProfileInput = {
  firstName?: string;
  lastName?: string;
  mobile?: string | null;
  profileEmail?: string | null;
  externalCompanyId?: string | null;
};

/**
 * Update editable profile fields for a user.
 *
 * Stage 15 Batch G (U4): adds the missing profile-edit capability.
 * Only the five fields (firstName, lastName, mobile, profileEmail,
 * externalCompanyId) are writable via this function; username and
 * synthetic auth email remain immutable.
 *
 * Tenancy guards (all throw on failure):
 *   - User must be in the session org (filters on both id AND organizationId).
 *   - If externalCompanyId is being set, it must belong to the session org.
 *   - If the user's current role is NOT internal (isInternalRole = false),
 *     clearing externalCompanyId is rejected (U3 enforcement on edit).
 */
export async function updateUserProfile(
  session: SessionData,
  userId: string,
  input: UpdateUserProfileInput,
): Promise<void> {
  // Tenancy guard: user must exist in this org AND include role info for U3 check.
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: session.organizationId },
    select: { id: true, roleId: true },
  });
  if (!user) throw new Error("User not found or access denied");

  // U3 enforcement on edit: if the user's role requires an external company,
  // clearing it here is rejected.
  if (Object.prototype.hasOwnProperty.call(input, "externalCompanyId")) {
    const role = await prisma.role.findFirst({
      where: { id: user.roleId, organizationId: session.organizationId },
      select: { isInternalRole: true },
    });
    if (role && !role.isInternalRole && input.externalCompanyId === null) {
      throw new Error("External company is required for this role");
    }
  }

  // Tenancy guard: external company (if supplied) must belong to this org.
  if (input.externalCompanyId) {
    const ec = await prisma.externalCompany.findFirst({
      where: { id: input.externalCompanyId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!ec) throw new Error("External company not found or access denied");
  }

  // Build the data object — only include fields that were supplied.
  // Also update the better-auth `name` field if firstName or lastName changed.
  const data: Record<string, unknown> = {};
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (Object.prototype.hasOwnProperty.call(input, "mobile")) data.mobile = input.mobile;
  if (Object.prototype.hasOwnProperty.call(input, "profileEmail")) data.profileEmail = input.profileEmail;
  if (Object.prototype.hasOwnProperty.call(input, "externalCompanyId")) {
    data.externalCompanyId = input.externalCompanyId;
  }

  // Keep the better-auth `name` display field in sync when name parts change.
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const current = await prisma.user.findFirst({
      where: { id: userId, organizationId: session.organizationId },
      select: { firstName: true, lastName: true },
    });
    if (current) {
      const newFirst = input.firstName ?? current.firstName;
      const newLast = input.lastName ?? current.lastName;
      data.name = `${newFirst} ${newLast}`;
    }
  }

  // Scoped update: both id and organizationId must match (lint-enforced tenancy pattern).
  await prisma.user.updateMany({
    where: { id: userId, organizationId: session.organizationId },
    data,
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
 * Delete a user and their credential account (cascades via DB).
 * Tenancy guard: user must be in session org.
 * Prevents self-deletion (admin would lose their own account).
 * Returns a descriptive error if the user has created projects or inquiries that
 * would violate FK constraints — admin should deactivate them instead.
 */
export async function deleteUser(session: SessionData, userId: string): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  if (userId === session.userId) {
    throw new Error("You cannot delete your own account");
  }

  // Proactive FK check: block if user has created projects or inquiries (no cascade).
  const [projectCount, inquiryCount] = await Promise.all([
    prisma.project.count({ where: { createdByUserId: userId } }),
    prisma.inquiry.count({ where: { createdByUserId: userId } }),
  ]);
  if (projectCount > 0 || inquiryCount > 0) {
    throw new Error(
      "Cannot delete this user — they have associated projects or inquiries. Deactivate them instead.",
    );
  }

  // Session and Account rows cascade automatically (onDelete: Cascade in schema).
  await prisma.user.delete({ where: { id: userId } });
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
