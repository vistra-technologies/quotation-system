// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY omit organizationId filters — they operate across all orgs.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { DEFAULT_ROLE_DEFS } from "@/lib/org-role-defaults";
import { COMPONENT_TYPE_DEFS, SEEDED_CATALOG_CATEGORY_NAME } from "@/lib/component-catalog-seed";

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
  | { ok: true; org: { id: string; slug: string; name: string }; adminUserId: string }
  | { ok: false; reason: "slug_conflict" | "unknown_error"; message: string };

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch a single organization by ID. Returns null if not found.
 * Used by route handlers that need to verify org existence without a full list.
 *
 * superadmin-only — intentionally cross-org
 */
export async function getOrgById(
  orgId: string,
): Promise<{ id: string; name: string } | null> {
  // superadmin-only — intentionally cross-org
  return prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
}

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
  adminPassword: string,
): Promise<CreateOrgResult> {
  // superadmin-only — intentionally cross-org

  // Hash the admin password before entering the transaction (better-auth uses Scrypt —
  // the same hasher as the regular sign-in path in lib/data/users.ts).
  const authCtx = await auth.$context;
  const passwordHash = await authCtx.password.hash(adminPassword);

  // Fetch global permissions upfront (outside the transaction — read-only).
  const allPermissions = await prisma.permission.findMany({
    select: { id: true, code: true },
  });
  const permByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  try {
    const { org, adminUserId } = await prisma.$transaction(async (tx) => {
      // 1. Create the organization row.
      const newOrg = await tx.organization.create({
        data: { name, slug },
        select: { id: true, slug: true, name: true },
      });

      // 2. Create default roles and link permissions.
      // Track the Admin role id so we can assign it to the auto-created admin user.
      let adminRoleId: string | null = null;
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

        if (roleDef.name === "Admin") {
          adminRoleId = role.id;
        }

        for (const code of roleDef.permissions) {
          const permId = permByCode.get(code);
          if (!permId) continue; // missing permission — skip (same as seed.ts)
          await tx.rolePermission.create({
            data: { roleId: role.id, permissionId: permId },
          });
        }
      }

      if (!adminRoleId) {
        throw new Error(
          'DEFAULT_ROLE_DEFS did not produce an "Admin" role — cannot create admin user',
        );
      }

      // 3. Create the admin User + Account inside the same transaction.
      // Synthetic email follows the same convention as lib/data/users.ts: {username}@{slug}.internal
      const adminUser = await tx.user.create({
        data: {
          name: "Admin",
          email: `admin@${newOrg.slug}.internal`,
          emailVerified: false,
          organizationId: newOrg.id,
          username: "admin",
          firstName: "Admin",
          lastName: "User",
          mobile: null,
          profileEmail: null,
          active: true,
          roleId: adminRoleId,
          externalCompanyId: null,
        },
        select: { id: true },
      });

      await tx.account.create({
        data: {
          userId: adminUser.id,
          providerId: "credential",
          accountId: adminUser.id,
          password: passwordHash,
        },
      });

      // 4. Seed the starter ComponentType catalog for this new org.
      // Uses plain .create() (not .upsert()) because this path only ever runs
      // once, at org-creation time — unlike prisma/seed.ts which uses upsert
      // because it re-runs against pre-existing orgs.
      const category = await tx.componentCategory.create({
        data: { organizationId: newOrg.id, name: SEEDED_CATALOG_CATEGORY_NAME },
        select: { id: true },
      });

      for (const def of COMPONENT_TYPE_DEFS) {
        await tx.componentType.create({
          data: {
            organizationId: newOrg.id,
            categoryId: category.id,
            code: def.code,
            name: def.name,
            fieldsSchema: def.fieldsSchema,
            active: true,
          },
        });
      }

      return { org: newOrg, adminUserId: adminUser.id };
    });

    return { ok: true, org, adminUserId };
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
 * Typed result for deleteOrganization.
 * "not_found"    → org does not exist (caller should return 404).
 * "not_suspended" → org exists but is not suspended (caller should return 400).
 */
export type DeleteOrgResult =
  | { ok: true; org: { id: string; slug: string; name: string } }
  | {
      ok: false;
      reason: "not_found" | "not_suspended" | "unknown_error";
      message: string;
    };

/**
 * Hard-delete an organization and all of its org-scoped child rows.
 *
 * Safety gate: only a currently-suspended org may be deleted. Returns
 * `reason: "not_suspended"` (400) if the org is active.
 *
 * Deletes every organizationId-scoped table in FK-safe order inside a single
 * $transaction, then deletes the Organization row itself. Session and Account
 * rows cascade automatically from User (onDelete: Cascade declared on both).
 * ItemPrice rows cascade from CatalogItem but are deleted explicitly for
 * clarity. SuperAdminAuditLog is untouched — targetId is polymorphic with no
 * FK to Organization, so the permanent audit trail survives the deletion.
 *
 * Returns { ok: true, org: { id, slug, name } } on success, capturing the
 * org identity BEFORE deletion so the caller can write the audit log row.
 *
 * Does NOT write the audit log — the caller is responsible for calling
 * createOrgAuditLog() after this returns ok: true.
 *
 * superadmin-only — intentionally cross-org
 */
export async function deleteOrganization(
  orgId: string,
): Promise<DeleteOrgResult> {
  // superadmin-only — intentionally cross-org

  // Fetch the org first (outside the transaction — read-only).
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, slug: true, name: true, isSuspended: true },
  });

  if (!org) {
    return { ok: false, reason: "not_found", message: `Organization "${orgId}" not found` };
  }

  if (!org.isSuspended) {
    return {
      ok: false,
      reason: "not_suspended",
      message: `Organization "${org.slug}" must be suspended before it can be deleted`,
    };
  }

  const orgIdentity = { id: org.id, slug: org.slug, name: org.name };

  try {
    await prisma.$transaction(async (tx) => {
      // FK-safe deletion order — children before parents.
      // Session and Account cascade from User; no need to delete them explicitly.

      // 1. Selection — references Project + ComponentType
      await tx.selection.deleteMany({ where: { organizationId: orgId } });

      // 2. Partition — references Floor
      await tx.partition.deleteMany({ where: { organizationId: orgId } });

      // 3. Floor — references Project
      await tx.floor.deleteMany({ where: { organizationId: orgId } });

      // 4. Project — references User (createdByUserId), ExternalCompany, Inquiry (SetNull)
      await tx.project.deleteMany({ where: { organizationId: orgId } });

      // 5. Inquiry — references User (createdByUserId), ExternalCompany
      await tx.inquiry.deleteMany({ where: { organizationId: orgId } });

      // 6. ItemPrice — references CatalogItem (also cascades, but explicit for clarity)
      await tx.itemPrice.deleteMany({ where: { organizationId: orgId } });

      // 7. CatalogItem
      await tx.catalogItem.deleteMany({ where: { organizationId: orgId } });

      // 8. ComponentType — references ComponentCategory (Selection already gone)
      await tx.componentType.deleteMany({ where: { organizationId: orgId } });

      // 9. ComponentCategory
      await tx.componentCategory.deleteMany({ where: { organizationId: orgId } });

      // 10. User — Session + Account cascade via onDelete: Cascade on both
      //     Must come after Project/Inquiry (which reference User.createdByUserId)
      await tx.user.deleteMany({ where: { organizationId: orgId } });

      // 11. RolePermission — no organizationId column; filter via the Role relation
      await tx.rolePermission.deleteMany({
        where: { role: { organizationId: orgId } },
      });

      // 12. ExternalCompany — User/Project/Inquiry already deleted
      await tx.externalCompany.deleteMany({ where: { organizationId: orgId } });

      // 13. Role — User (roleId FK) and RolePermission already deleted
      await tx.role.deleteMany({ where: { organizationId: orgId } });

      // 14. Organization — all children gone
      await tx.organization.delete({ where: { id: orgId } });
    });

    return { ok: true, org: orgIdentity };
  } catch (err) {
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
  targetId: string,
  action: string,
  metadata?: Record<string, unknown>,
  targetType: string = "Organization",
): Promise<void> {
  // superadmin-only — intentionally cross-org
  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId,
      action,
      targetType,
      targetId,
      // Prisma nullable Json: omit the key when no metadata rather than passing null.
      ...(metadata !== undefined
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
