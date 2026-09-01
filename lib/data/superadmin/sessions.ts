/**
 * SuperAdmin session data functions.
 * superadmin-only — intentionally cross-org, no organizationId filter.
 *
 * Called from app/api/v1/superadmin/login and app/api/v1/superadmin/logout.
 * Lives in lib/data/superadmin/ per architecture rule 1 (profile.md Stage 16):
 * cross-org superadmin reads/writes are explicitly carved out here, not in
 * lib/data/*.ts where the tenancy-scoped helpers live.
 */

import { prisma } from "@/lib/prisma";

/** Session lifetime: 24 hours. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Look up a SuperAdmin by their platform email ({username}@platform.internal).
 * Returns null if not found — caller decides whether to short-circuit or
 * continue with a constant-time dummy hash verify.
 */
export async function findSuperAdminByEmail(
  platformEmail: string,
): Promise<{ id: string; username: string; passwordHash: string } | null> {
  return prisma.superAdmin.findUnique({
    where: { email: platformEmail },
    select: { id: true, username: true, passwordHash: true },
  });
}

/**
 * Create a new SuperAdminSession row and return the token + expiry.
 * Token is a pair of UUIDs joined with "-" for extra entropy.
 */
export async function createSuperAdminSession(
  superAdminId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.superAdminSession.create({
    data: { token, superAdminId, expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Delete all SuperAdminSession rows matching the given token.
 * Idempotent — returns safely if the token is absent (deleteMany returns 0).
 */
export async function deleteSuperAdminSession(token: string): Promise<void> {
  await prisma.superAdminSession.deleteMany({ where: { token } });
}
