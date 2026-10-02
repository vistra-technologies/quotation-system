/**
 * SuperAdmin account management (hotfix 2026-10-02): list / create / change password / delete.
 *
 * SuperAdmin rows are platform identities, not org-scoped, so there is no organizationId filter here.
 * Password hashing uses better-auth's own hasher — the same one the seed uses — so
 * POST /api/v1/superadmin/login verifies these accounts unchanged.
 *
 * superadmin-only — intentionally cross-org
 */

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { toPlatformAuthEmail } from "@/lib/auth-utils";
import { checkDeleteAllowed, isProtectedSuperAdmin } from "@/lib/superadmin-accounts";

export interface SuperAdminListRow {
  id: string;
  username: string;
  createdAt: Date;
  protected: boolean;
  isSelf: boolean;
}

/** All SuperAdmins, oldest first. Never selects passwordHash. */
export async function listSuperAdmins(actingId: string): Promise<SuperAdminListRow[]> {
  // superadmin-only — intentionally cross-org
  const rows = await prisma.superAdmin.findMany({
    select: { id: true, username: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    ...r,
    protected: isProtectedSuperAdmin(r.username),
    isSelf: r.id === actingId,
  }));
}

export type CreateSuperAdminResult =
  | { ok: true; admin: { id: string; username: string } }
  | { ok: false; reason: "username_conflict"; message: string };

/** Caller has already validated + normalised (trim/lowercase) username and password. */
export async function createSuperAdmin(
  username: string,
  password: string,
): Promise<CreateSuperAdminResult> {
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(password);

  try {
    // superadmin-only — intentionally cross-org
    const admin = await prisma.superAdmin.create({
      data: { username, email: toPlatformAuthEmail(username), passwordHash },
      select: { id: true, username: true },
    });
    return { ok: true, admin };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "username_conflict", message: `Username "${username}" is already taken` };
    }
    throw err;
  }
}

export type ChangeSuperAdminPasswordResult =
  | { ok: true; username: string; sessionsRevoked: number }
  | { ok: false; reason: "not_found"; message: string };

/**
 * Replace a SuperAdmin's password and revoke their sessions. When an admin changes their *own*
 * password, `keepSessionId` (the acting session) survives so they aren't signed out of the page
 * they're using; every other session of that account is revoked.
 */
export async function changeSuperAdminPassword(
  adminId: string,
  newPassword: string,
  keepSessionId: string | null,
): Promise<ChangeSuperAdminPasswordResult> {
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(newPassword);

  // superadmin-only — intentionally cross-org
  return prisma.$transaction(async (tx) => {
    const target = await tx.superAdmin.findUnique({
      where: { id: adminId },
      select: { username: true },
    });
    if (!target) return { ok: false as const, reason: "not_found" as const, message: "SuperAdmin not found" };

    await tx.superAdmin.update({ where: { id: adminId }, data: { passwordHash } });
    const revoked = await tx.superAdminSession.deleteMany({
      where: { superAdminId: adminId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    });
    return { ok: true as const, username: target.username, sessionsRevoked: revoked.count };
  });
}

export type DeleteSuperAdminResult =
  | { ok: true; username: string }
  | { ok: false; reason: "not_found"; message: string }
  | { ok: false; reason: "protected" | "self" | "last_admin"; message: string };

/**
 * Delete a SuperAdmin (sessions cascade; audit rows survive with a null link + username snapshot).
 * Guards live in checkDeleteAllowed(): `devadmin` is permanent, no self-delete, never the last admin.
 * The existence check, count and delete share one transaction so two concurrent deletes can't both
 * pass the last-admin guard against the same snapshot.
 */
export async function deleteSuperAdmin(
  adminId: string,
  actingId: string,
): Promise<DeleteSuperAdminResult> {
  // superadmin-only — intentionally cross-org
  return prisma.$transaction(
    async (tx) => {
      const target = await tx.superAdmin.findUnique({
        where: { id: adminId },
        select: { id: true, username: true },
      });
      if (!target) return { ok: false as const, reason: "not_found" as const, message: "SuperAdmin not found" };

      const totalAdmins = await tx.superAdmin.count();
      const guard = checkDeleteAllowed({
        targetUsername: target.username,
        targetId: target.id,
        actingId,
        totalAdmins,
      });
      if (!guard.allowed) return { ok: false as const, reason: guard.reason, message: guard.message };

      await tx.superAdmin.delete({ where: { id: adminId } });
      return { ok: true as const, username: target.username };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
