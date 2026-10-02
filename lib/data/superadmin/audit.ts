/**
 * Single writer for SuperAdminAuditLog rows (append-only).
 *
 * Snapshots the acting SuperAdmin's username at write time so the row still names them after the
 * account is deleted (superAdminId is ON DELETE SET NULL — hotfix 2026-10-02). Callers keep their
 * own per-target wrappers (createOrgAuditLog, createRoleAuditLog, …); they all funnel through here.
 *
 * Not wrapped in try/catch: a failed audit write must surface (Stage 16/17 discipline).
 *
 * superadmin-only — intentionally cross-org
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export async function writeSuperAdminAudit(entry: {
  superAdminId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // superadmin-only — intentionally cross-org
  const actor = await prisma.superAdmin.findUnique({
    where: { id: entry.superAdminId },
    select: { username: true },
  });

  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId: entry.superAdminId,
      superAdminUsername: actor?.username ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      // Prisma nullable Json: omit the key when no metadata rather than passing null.
      ...(entry.metadata !== undefined
        ? { metadata: entry.metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
