// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY omit organizationId filters — they operate across all orgs.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ROLE_DEFS } from "@/lib/org-role-defaults";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  isSuspended: boolean;
  createdAt: Date;
  userCount: number;
}

/**
 * Typed result for createOrganizationWithDefaults.
 * "slug_conflict" indicates the slug is already taken (caller should return 409).
 */
export type CreateOrgResult =
  | { ok: true; org: { id: string; slug: string; name: string } }
  | { ok: false; reason: "slug_conflict" | "unknown_error"; message: string };

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List all organizations with suspension status and user count. Cross-org by design.
 * Used by the SuperAdmin console org list (/controls/orgs).
 *
 * superadmin-only — intentionally cross-org
 */
export async function listAllOrganizations(): Promise<OrgRow[]> {
  // superadmin-only — intentionally cross-org
  const rows = await prisma.organization.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      isSuspended: true,
      createdAt: true,
      _count: { select: { users: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    isSuspended: r.isSuspended,
    createdAt: r.createdAt,
    userCount: r._count.users,
  }));
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new organization and seed its default roles + role-permission links.
 *
 * Default roles mirror the seed (see lib/org-role-defaults.ts).
 * Permissions are expected to already exist in the DB (seeded globally).
 * Missing permission codes are silently skipped (same behaviour as seed.ts).
 *
 * superadmin-only — intentionally cross-org
 *
 * @returns CreateOrgResult — ok: true with { id, slug, name } on success;
 *   ok: false with reason "slug_conflict" if the slug is already taken.
 */
export async function createOrganizationWithDefaults(
  name: string,
  slug: string,
): Promise<CreateOrgResult> {
  // superadmin-only — intentionally cross-org

  // Fetch global permissions upfront (outside the transaction — read-only).
  const allPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  try {
    const org = await prisma.$transaction(async (tx) => {
      // 1. Create the organization row.
      const newOrg = await tx.organization.create({
        data: { name, slug },
        select: { id: true, slug: true, name: true },
      });

      // 2. Create default roles and link permissions.
      for (const roleDef of DEFAULT_ROLE_DEFS) {
        const role = await tx.role.create({
          data: {
            organizationId: newOrg.id,
            name: roleDef.name,
            description: roleDef.description,
            isInternalRole: roleDef.isInternalRole,
          },
          select: { id: true },
        });

        for (const code of roleDef.permissions) {
          const permId = permByCode.get(code);
          if (!permId) continue; // missing permission — skip (same as seed.ts)
          await tx.rolePermission.create({
            data: { roleId: role.id, permissionId: permId },
          });
        }
      }

      return newOrg;
    });

    return { ok: true, org };
  } catch (err) {
    // Prisma unique-constraint violation on slug
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        reason: "slug_conflict",
        message: `Slug "${slug}" is already taken`,
      };
    }
    return {
      ok: false,
      reason: "unknown_error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Typed result for toggleOrgSuspension.
 * "not_found" indicates the orgId does not exist in the DB.
 */
export type ToggleOrgSuspensionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unknown_error"; message: string };

/**
 * Flip the isSuspended flag on an Organization row.
 *
 * Pass suspend=true to suspend, suspend=false to reactivate.
 * Idempotent: calling suspend on an already-suspended org is a no-op (same result).
 *
 * Does NOT write the audit log — the caller is responsible for calling
 * createOrgAuditLog() after this returns ok: true, following the same
 * pattern as createOrganizationWithDefaults + createOrgAuditLog.
 *
 * superadmin-only — intentionally cross-org
 */
export async function toggleOrgSuspension(
  orgId: string,
  suspend: boolean,
): Promise<ToggleOrgSuspensionResult> {
  // superadmin-only — intentionally cross-org
  try {
    await prisma.organization.update({
      where: { id: orgId },
      data: { isSuspended: suspend },
      select: { id: true },
    });
    return { ok: true };
  } catch (err) {
    // Prisma P2025 = record not found
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return {
        ok: false,
        reason: "not_found",
        message: `Organization "${orgId}" not found`,
      };
    }
    return {
      ok: false,
      reason: "unknown_error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Write a SuperAdminAuditLog row (append-only).
 *
 * Must be called after a successful mutation, not inside the mutation transaction
 * (so the audit log row is only written if the transaction committed).
 *
 * superadmin-only — intentionally cross-org
 */
export async function createOrgAuditLog(
  superAdminId: string,
  orgId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // superadmin-only — intentionally cross-org
  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId,
      action,
      targetType: "Organization",
      targetId: orgId,
      // Prisma nullable Json: omit the key when no metadata rather than passing null.
      ...(metadata !== undefined
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
