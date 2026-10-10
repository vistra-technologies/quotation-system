import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { toAuthEmail } from "@/lib/auth-utils";
import { assertUserSeatAvailable } from "@/lib/data/user-limit";
import { recordsOutsideCompanyWhere } from "@/lib/data/ownership";
import { PERMISSIONS } from "@/lib/rbac";
import { shouldRevokeSessions } from "@/lib/session-revocation";
import type { Prisma } from "@/app/generated/prisma/client";
import type { SessionData } from "@/lib/session";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** List all users in the session org, A→Z by username, with role name. */
export async function listUsers(session: SessionData) {
  return prisma.user.findMany({
    where: { organizationId: session.organizationId },
    include: { role: { select: { id: true, name: true } } },
    orderBy: { username: "asc" },
  });
}

/**
 * Seat usage for the session org (Stage 29): `used` counts every User row, active or deactivated,
 * exactly as assertUserSeatAvailable does.
 */
export async function getUserSeats(session: SessionData): Promise<{ limit: number; used: number }> {
  const [org, used] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: { userLimit: true },
    }),
    prisma.user.count({ where: { organizationId: session.organizationId } }),
  ]);
  if (!org) throw new Error("Organization not found");
  return { limit: org.userLimit, used };
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
 *   - org must have a free seat (userLimit) — checked inside the transaction, throws UserLimitReachedError
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

  // Atomic: seat check + user row + credential account in one transaction.
  // Throws UserLimitReachedError (route -> 409) when the org is at its userLimit (Stage 29).
  await prisma.$transaction(async (tx) => {
    await assertUserSeatAvailable(tx, session.organizationId);
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

/**
 * Own editable profile (Hotfix 2026-10-10, My Account popup): the four self-editable fields.
 * Own row only: id comes from the session. Returns null if the row is gone.
 */
export async function getOwnProfile(session: SessionData) {
  return prisma.user.findFirst({
    where: { id: session.userId, organizationId: session.organizationId },
    select: { firstName: true, lastName: true, mobile: true, profileEmail: true, name: true },
  });
}

export type OwnProfileUpdate = {
  firstName?: string;
  lastName?: string;
  mobile?: string | null;
  profileEmail?: string | null;
};

/**
 * Update the session user's OWN profile. A thin wrapper over updateUserProfile: the target id is
 * always session.userId and the input type has no externalCompanyId, so a self-edit can never reach
 * company/role/active fields. `name` is recomputed inside updateUserProfile.
 */
export async function updateOwnProfile(session: SessionData, input: OwnProfileUpdate): Promise<void> {
  const safe: OwnProfileUpdate = {};
  if (input.firstName !== undefined) safe.firstName = input.firstName;
  if (input.lastName !== undefined) safe.lastName = input.lastName;
  if (input.mobile !== undefined) safe.mobile = input.mobile;
  if (input.profileEmail !== undefined) safe.profileEmail = input.profileEmail;
  await updateUserProfile(session, session.userId, safe);
}

/** Activate a user (sets active = true). Tenancy guard: user must be in session org. */
export async function activateUser(session: SessionData, userId: string): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  // Stage 31 S31-2 P4: on a real inactive -> active transition, drop any session left over from a
  // deactivation (done before sessions were revoked on deactivate) so reactivating never revives an old
  // cookie. Activating an already-active user is a no-op and revokes nothing. Same transaction as the write.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { active: true } });
    if (!user) throw new Error("User not found or access denied");
    await tx.user.update({ where: { id: userId }, data: { active: true } });
    if (shouldRevokeSessions({ passwordChanged: false, nextActive: true, storedActive: user.active })) {
      await tx.session.deleteMany({ where: { userId } });
    }
  });
}

/**
 * Deactivate a user (sets active = false).
 * Tenancy guard: user must be in session org.
 * Prevents self-deactivation: the admin would be locked out immediately.
 * Revokes every session of the user in the same transaction (Stage 31 S31-2 P1).
 */
export async function deactivateUser(session: SessionData, userId: string): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  if (userId === session.userId) {
    throw new Error("You cannot deactivate your own account");
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { active: false } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}

/** 400 text when a role change would leave the org with no active user manager (Stage 31 S31-3). */
export const LAST_MANAGER_MESSAGE = "An organization needs at least one active user manager";

/**
 * Change a user's role.
 * Tenancy guards: user in org, new role in org.
 * Stage 31 S31-3: U3 (an external role needs an external company) and the last-manager guard
 * (the org must keep at least one ACTIVE user whose role holds MANAGE_USERS). The check and the
 * update share one transaction.
 */
export async function changeUserRole(
  session: SessionData,
  userId: string,
  newRoleId: string,
): Promise<void> {
  const organizationId = session.organizationId;
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, organizationId },
      select: { id: true, active: true, externalCompanyId: true },
    });
    if (!user) throw new Error("User not found or access denied");

    const role = await tx.role.findFirst({
      where: { id: newRoleId, organizationId },
      select: { id: true, isInternalRole: true },
    });
    if (!role) throw new Error("Role not found or access denied");

    // U3 on role change: same message as createUser.
    if (!role.isInternalRole && !user.externalCompanyId) {
      throw new Error("External company is required for this role");
    }

    // Last-manager guard: managers after the change = other active managers + this user if the new
    // role keeps MANAGE_USERS and they are active.
    const managerRoles = await tx.rolePermission.findMany({
      where: { permission: { code: PERMISSIONS.MANAGE_USERS }, role: { organizationId } },
      select: { roleId: true },
    });
    const managerRoleIds = managerRoles.map((r) => r.roleId);
    const otherManagers = await tx.user.count({
      where: {
        organizationId,
        active: true,
        id: { not: userId },
        roleId: { in: managerRoleIds },
      },
    });
    const staysManager = user.active && managerRoleIds.includes(newRoleId);
    if (otherManagers + (staysManager ? 1 : 0) === 0) {
      throw new Error(LAST_MANAGER_MESSAGE);
    }

    await tx.user.update({ where: { id: userId }, data: { roleId: newRoleId } });
  });
}

/**
 * Delete a user and keep their records (Stage 31 S31-4: people leave, records stay).
 * Shared by the org-admin and SuperAdmin delete paths; run it inside the caller's transaction.
 * Snapshots the user's name onto every project/inquiry they created, then deletes the user: the
 * FK (ON DELETE SET NULL) nulls `createdByUserId`; Session/Account rows cascade.
 */
export async function deleteUserKeepingRecords(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw new Error("User not found or access denied");
  await tx.project.updateMany({
    where: { createdByUserId: userId },
    data: { createdByName: user.name },
  });
  await tx.inquiry.updateMany({
    where: { createdByUserId: userId },
    data: { createdByName: user.name },
  });
  await tx.user.delete({ where: { id: userId } });
}

/**
 * Delete a user from the session org. Never blocked by the user's records (they stay, attributed
 * to a name snapshot). Tenancy guard: user must be in session org. Self-delete is refused.
 */
export async function deleteUser(session: SessionData, userId: string): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  if (userId === session.userId) {
    throw new Error("You cannot delete your own account");
  }
  await prisma.$transaction((tx) => deleteUserKeepingRecords(tx, userId));
}

/**
 * How many projects/inquiries each user of the session org created (users with none are absent).
 * Feeds the delete dialog ("Owns N project(s) and M inquiry(ies)").
 */
export async function getUserRecordCounts(
  session: SessionData,
): Promise<Record<string, { projects: number; inquiries: number }>> {
  const where = { organizationId: session.organizationId, createdByUserId: { not: null } };
  const [projects, inquiries] = await Promise.all([
    prisma.project.groupBy({ by: ["createdByUserId"], where, _count: { _all: true } }),
    prisma.inquiry.groupBy({ by: ["createdByUserId"], where, _count: { _all: true } }),
  ]);
  const out: Record<string, { projects: number; inquiries: number }> = {};
  for (const r of projects) {
    if (!r.createdByUserId) continue;
    (out[r.createdByUserId] ??= { projects: 0, inquiries: 0 }).projects = r._count._all;
  }
  for (const r of inquiries) {
    if (!r.createdByUserId) continue;
    (out[r.createdByUserId] ??= { projects: 0, inquiries: 0 }).inquiries = r._count._all;
  }
  return out;
}

/**
 * Reassign work (Stage 31 S31-4a): move every project and inquiry created by `fromUserId` to
 * `toUserId`. Both users must be in the session org (checked before any write; unknown/other-org
 * -> "not found or access denied"), the target must be active and different. An external target
 * may only receive records of its own company: otherwise nothing moves.
 */
export async function reassignUserWork(
  session: SessionData,
  fromUserId: string,
  toUserId: string,
): Promise<{ projects: number; inquiries: number }> {
  const organizationId = session.organizationId;
  return prisma.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      tx.user.findFirst({ where: { id: fromUserId, organizationId }, select: { id: true } }),
      tx.user.findFirst({
        where: { id: toUserId, organizationId },
        select: {
          id: true,
          active: true,
          externalCompanyId: true,
          role: { select: { isInternalRole: true } },
        },
      }),
    ]);
    if (!from || !to) throw new Error("User not found or access denied");
    if (fromUserId === toUserId) throw new Error("Cannot reassign work to the same user");
    if (!to.active) throw new Error("Target user must be active");

    const source = { organizationId, createdByUserId: fromUserId };

    // External target: every moved record must belong to the target's own company.
    if (!to.role.isInternalRole) {
      const outside = recordsOutsideCompanyWhere(to.externalCompanyId);
      const [p, i] = await Promise.all([
        tx.project.count({ where: { ...source, ...outside } }),
        tx.inquiry.count({ where: { ...source, ...outside } }),
      ]);
      if (p + i > 0) throw new Error(`Target user cannot access ${p + i} of these records`);
    }

    const [projects, inquiries] = await Promise.all([
      tx.project.updateMany({ where: source, data: { createdByUserId: toUserId } }),
      tx.inquiry.updateMany({ where: source, data: { createdByUserId: toUserId } }),
    ]);
    return { projects: projects.count, inquiries: inquiries.count };
  });
}

/**
 * Admin-set password: hashes the new password and writes it to the credential account, and revokes
 * the user's sessions in the same transaction (Stage 31 S31-2 P2/P3).
 * `keepSessionId` is the caller's own session when they reset their own password (kept so the admin
 * is not signed out of the page they are using); null otherwise.
 * The password is never logged, echoed, or returned.
 * Tenancy guard: user must be in session org.
 */
export async function setUserPassword(
  session: SessionData,
  userId: string,
  newPassword: string,
  keepSessionId: string | null = null,
): Promise<void> {
  await assertUserInOrg(userId, session.organizationId);
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(newPassword);
  await prisma.$transaction([
    prisma.account.updateMany({
      where: { userId, providerId: "credential" },
      data: { password: passwordHash },
    }),
    prisma.session.deleteMany({
      where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    }),
  ]);
}
