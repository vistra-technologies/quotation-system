/**
 * Single writer for SuperAdminAuditLog rows (append-only).
 *
 * Snapshots, at write time, everything the audit-log page needs to stay readable after the world moves on:
 *   - the acting SuperAdmin's username (superAdminId is ON DELETE SET NULL — hotfix 2026-10-02);
 *   - the organization the change happened in (organizationId / organizationSlug; NULL ⇒ platform-level);
 *   - the entity's display name (targetLabel).
 * All three are derived here from (targetType, targetId, metadata), so the per-target wrappers
 * (createOrgAuditLog, createRoleAuditLog, …) and their ~25 call sites stay unchanged. Callers may pass
 * explicit values to override the derivation.
 *
 * Deletes are written after the row is gone, so the label/org fall back to what the caller saved in
 * `metadata` (see labelFromMetadata / deriveOrganizationId).
 *
 * Not wrapped in try/catch: a failed audit write must surface (Stage 16/17 discipline).
 *
 * superadmin-only — intentionally cross-org
 */

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { deriveOrganizationId, labelFromMetadata } from "@/lib/superadmin-audit-view";

/** Look up the entity's current display name; null when the row is gone (caller falls back to metadata). */
async function lookupLabel(targetType: string, targetId: string): Promise<string | null> {
  // superadmin-only — intentionally cross-org
  switch (targetType) {
    case "Organization":
      return (await prisma.organization.findUnique({ where: { id: targetId }, select: { slug: true } }))?.slug ?? null;
    case "User":
      return (await prisma.user.findUnique({ where: { id: targetId }, select: { username: true } }))?.username ?? null;
    case "Role":
      return (await prisma.role.findUnique({ where: { id: targetId }, select: { name: true } }))?.name ?? null;
    case "FormulaSet": {
      const f = await prisma.formulaSet.findUnique({ where: { id: targetId }, select: { name: true, version: true } });
      return f ? `${f.name} v${f.version}` : null;
    }
    case "ComponentType":
      return (await prisma.componentType.findUnique({ where: { id: targetId }, select: { code: true } }))?.code ?? null;
    case "SuperAdmin":
      return (await prisma.superAdmin.findUnique({ where: { id: targetId }, select: { username: true } }))?.username ?? null;
    default:
      return null;
  }
}

export async function writeSuperAdminAudit(entry: {
  superAdminId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  /** Override the derived org (rare). `null` forces platform-level. */
  organizationId?: string | null;
  /** Override the derived entity name. */
  targetLabel?: string | null;
}): Promise<void> {
  const organizationId =
    entry.organizationId !== undefined
      ? entry.organizationId
      : deriveOrganizationId(entry.targetType, entry.targetId, entry.metadata);

  // superadmin-only — intentionally cross-org
  const [actor, looked, org] = await Promise.all([
    prisma.superAdmin.findUnique({ where: { id: entry.superAdminId }, select: { username: true } }),
    entry.targetLabel !== undefined ? Promise.resolve(entry.targetLabel) : lookupLabel(entry.targetType, entry.targetId),
    organizationId
      ? prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
      : Promise.resolve(null),
  ]);

  const metaSlug = typeof entry.metadata?.slug === "string" ? entry.metadata.slug : null;

  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId: entry.superAdminId,
      superAdminUsername: actor?.username ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      organizationId,
      organizationSlug: organizationId ? (org?.slug ?? (entry.targetType === "Organization" ? metaSlug : null)) : null,
      targetLabel: looked ?? labelFromMetadata(entry.metadata),
      // Prisma nullable Json: omit the key when no metadata rather than passing null.
      ...(entry.metadata !== undefined
        ? { metadata: entry.metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
