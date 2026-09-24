// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY omit organizationId filters — they operate across all orgs.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { DEFAULT_ROLE_DEFS } from "@/lib/org-role-defaults";
import {
  COMPONENT_TYPE_DEFS,
  COMPONENT_TYPE_ORG_CONFIG_DEFS,
  SEEDED_CATALOG_CATEGORY_NAME,
} from "@/lib/component-catalog-seed";
import {
  checkStructuralCompatibility,
  type CompatResult,
  type MissingParam,
} from "@/lib/formula-compat";
import type { FormulaSetBody } from "@/lib/summary/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  isSuspended: boolean;
  createdAt: Date;
  userCount: number;
  /** null when the org has no active formula set assigned */
  activeFormulaSetId: string | null;
  /** Human-readable label e.g. "glass-partition-standard v1", or null if none assigned */
  formulaSetLabel: string | null;
  /** True when the assigned formula set references ComponentType codes/keys that don't exist or are inactive in this org */
  hasMismatch: boolean;
}

/** Warning item returned in create/edit responses when a formula set is incompatible */
export interface OrgFormulaWarning {
  kind: "missing_code" | "missing_param";
  code: string;
  key?: string;
  message: string;
}

/** Detail returned by getOrgForEdit — includes active formula set and component type info */
export interface OrgForEditDetail {
  id: string;
  name: string;
  slug: string;
  isSuspended: boolean;
  activeFormulaSetId: string | null;
  activeFormulaSet: { id: string; name: string; version: number } | null;
  /** Current mismatch state, computed on read */
  mismatch: CompatResult;
}

/** Result type for updateOrgSettings */
export type UpdateOrgResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unknown_error"; message: string };

/**
 * Typed result for createOrganizationWithDefaults.
 * "slug_conflict" indicates the slug is already taken (caller should return 409).
 */
export type CreateOrgResult =
  | { ok: true; org: { id: string; slug: string; name: string }; adminUserId: string }
  | { ok: false; reason: "slug_conflict" | "unknown_error"; message: string };

// ─── Private helpers ─────────────────────────────────────────────────────────

/** Build ConfigSnapshot-compatible type list from Prisma componentTypes select */
type ComponentTypeRow = { code: string; active: boolean; fieldsSchema: Prisma.JsonValue };

/**
 * Compute whether a formula set body has a structural mismatch with an org's component types.
 * Returns true when the set references codes/keys that are missing or inactive.
 * Returns false when body is null/undefined (no set assigned → no mismatch).
 */
function computeMismatchFlag(
  body: Prisma.JsonValue | null | undefined,
  componentTypes: ComponentTypeRow[],
): boolean {
  if (!body) return false;
  const snapshot = {
    takenAt: new Date().toISOString(),
    componentTypes: componentTypes.map((ct) => ({
      id: "",
      code: ct.code,
      name: "",
      active: ct.active,
      fieldsSchema: ct.fieldsSchema,
      fieldOptionsConfig: {},
    })),
  };
  const result = checkStructuralCompatibility(body as unknown as FormulaSetBody, snapshot);
  return !result.ok;
}

/**
 * Convert a CompatResult's failure details into the warnings array shape returned by
 * the create/edit API responses (S25-13 — warnings, never blocking).
 */
export function compatResultToWarnings(
  result: CompatResult,
  setName: string,
  setVersion: number,
): OrgFormulaWarning[] {
  if (result.ok) return [];
  const warnings: OrgFormulaWarning[] = [];
  for (const code of result.missingCodes) {
    warnings.push({
      kind: "missing_code",
      code,
      message: `Formula set ${setName} v${setVersion}: component type "${code}" is missing or inactive in this org.`,
    });
  }
  for (const { code, key } of result.missingParams as MissingParam[]) {
    warnings.push({
      kind: "missing_param",
      code,
      key,
      message: `Formula set ${setName} v${setVersion}: field key "${key}" on component type "${code}" is missing in this org.`,
    });
  }
  return warnings;
}

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
 * Fetch org detail needed for the edit page — includes active formula set identity and
 * the current mismatch state (computed on read, not stored).
 *
 * superadmin-only — intentionally cross-org
 */
export async function getOrgForEdit(orgId: string): Promise<OrgForEditDetail | null> {
  // superadmin-only — intentionally cross-org
  const row = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      slug: true,
      isSuspended: true,
      activeFormulaSetId: true,
      activeFormulaSet: { select: { id: true, name: true, version: true, body: true } },
      componentTypes: { select: { code: true, active: true, fieldsSchema: true } },
    },
  });
  if (!row) return null;
  const snapshot = {
    takenAt: new Date().toISOString(),
    componentTypes: row.componentTypes.map((ct) => ({
      id: "",
      code: ct.code,
      name: "",
      active: ct.active,
      fieldsSchema: ct.fieldsSchema,
      fieldOptionsConfig: {},
    })),
  };
  const mismatch: CompatResult = row.activeFormulaSet
    ? checkStructuralCompatibility(
        row.activeFormulaSet.body as unknown as FormulaSetBody,
        snapshot,
      )
    : { ok: true };
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isSuspended: row.isSuspended,
    activeFormulaSetId: row.activeFormulaSetId,
    activeFormulaSet: row.activeFormulaSet
      ? { id: row.activeFormulaSet.id, name: row.activeFormulaSet.name, version: row.activeFormulaSet.version }
      : null,
    mismatch,
  };
}

/**
 * List all organizations with suspension status, user count, formula set label, and mismatch flag.
 * Cross-org by design. Used by the SuperAdmin console org list (/controls/orgs).
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
      activeFormulaSetId: true,
      _count: { select: { users: true } },
      activeFormulaSet: { select: { id: true, name: true, version: true, body: true } },
      componentTypes: { select: { code: true, active: true, fieldsSchema: true } },
    },
  });

  return rows.map((r) => {
    const formulaSetLabel = r.activeFormulaSet
      ? `${r.activeFormulaSet.name} v${r.activeFormulaSet.version}`
      : null;
    const hasMismatch = computeMismatchFlag(r.activeFormulaSet?.body, r.componentTypes);
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      isSuspended: r.isSuspended,
      createdAt: r.createdAt,
      userCount: r._count.users,
      activeFormulaSetId: r.activeFormulaSetId,
      formulaSetLabel,
      hasMismatch,
    };
  });
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
  formulaSetId: string,
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
    // Stage 25 Batch 5: formulaSetId is passed explicitly by the route handler,
    // which has already validated it exists. Pin it directly on the new org.

    const { org, adminUserId } = await prisma.$transaction(async (tx) => {
      // 1. Create the organization row.
      const newOrg = await tx.organization.create({
        data: { name, slug, activeFormulaSetId: formulaSetId },
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

      // Build a lookup from code → fieldOptionsConfig for O(1) access below.
      const configByCode = new Map(
        COMPONENT_TYPE_ORG_CONFIG_DEFS.map((c) => [c.code, c.fieldOptionsConfig]),
      );

      for (const [sortOrder, def] of COMPONENT_TYPE_DEFS.entries()) {
        const ct = await tx.componentType.create({
          data: {
            organizationId: newOrg.id,
            categoryId: category.id,
            code: def.code,
            name: def.name,
            fieldsSchema: def.fieldsSchema,
            active: true,
            // Stage 20 Batch 7: seed in definition order so a fresh org's list/palette
            // starts in the same order as COMPONENT_TYPE_DEFS.
            sortOrder,
          },
          select: { id: true, code: true },
        });

        // Stage 20 Batch 1: seed the starter option values into ComponentTypeOrgConfig.
        const fieldOptionsConfig = configByCode.get(ct.code);
        if (fieldOptionsConfig) {
          await tx.componentTypeOrgConfig.create({
            data: {
              organizationId: newOrg.id,
              componentTypeId: ct.id,
              fieldOptionsConfig: fieldOptionsConfig as object,
            },
          });
        }
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
 * Update org name and/or formula set assignment.
 *
 * At least one of `name` or `formulaSetId` must be supplied (validated by caller).
 * Slug is never editable (it is the subdomain — changing it would invalidate all existing
 * session cookies and subdomain routing). The formula set pin may be changed freely;
 * existing Projects keep their own pinned formulaSetId and are not affected.
 *
 * Does NOT write the audit log — the caller is responsible for calling createOrgAuditLog().
 *
 * superadmin-only — intentionally cross-org
 */
export async function updateOrgSettings(
  orgId: string,
  patch: { name?: string; formulaSetId?: string },
): Promise<UpdateOrgResult> {
  // superadmin-only — intentionally cross-org
  try {
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.formulaSetId !== undefined ? { activeFormulaSetId: patch.formulaSetId } : {}),
      },
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
      return { ok: false, reason: "not_found", message: `Organization "${orgId}" not found` };
    }
    return {
      ok: false,
      reason: "unknown_error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Compute mismatch warnings for a formula set assignment on a given org.
 * Fetches the formula set body + org's component types, then runs checkStructuralCompatibility.
 * Returns an empty array when the set is null/not found (treat as no-op).
 *
 * Used by both POST /orgs (create) and PATCH /orgs/[orgId] (edit) to return advisory warnings.
 *
 * superadmin-only — intentionally cross-org
 */
export async function computeOrgMismatchWarnings(
  orgId: string,
  formulaSetId: string,
): Promise<OrgFormulaWarning[]> {
  // superadmin-only — intentionally cross-org
  const [formulaSet, componentTypes] = await Promise.all([
    prisma.formulaSet.findUnique({
      where: { id: formulaSetId },
      select: { name: true, version: true, body: true },
    }),
    prisma.componentType.findMany({
      where: { organizationId: orgId },
      select: { code: true, active: true, fieldsSchema: true },
    }),
  ]);
  if (!formulaSet) return []; // set not found — route already returned 404 before this
  const snapshot = {
    takenAt: new Date().toISOString(),
    componentTypes: componentTypes.map((ct) => ({
      id: "",
      code: ct.code,
      name: "",
      active: ct.active,
      fieldsSchema: ct.fieldsSchema,
      fieldOptionsConfig: {},
    })),
  };
  const result = checkStructuralCompatibility(
    formulaSet.body as unknown as FormulaSetBody,
    snapshot,
  );
  return compatResultToWarnings(result, formulaSet.name, formulaSet.version);
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
 * ItemPrice rows cascade from InventoryItem but are deleted explicitly for
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
      // Step 0 — re-verify isSuspended INSIDE the transaction to close the TOCTOU
      // window: the pre-flight check above is a fast-path UX guard, but a concurrent
      // reactivate could flip isSuspended between that read and this transaction start.
      // Re-reading under the transaction lock (Postgres serializable snapshot) ensures
      // the gate is atomic with the deletions that follow.
      const locked = await tx.organization.findUnique({
        where: { id: orgId },
        select: { isSuspended: true },
      });
      if (!locked || !locked.isSuspended) {
        // Throw a sentinel error that the catch block maps to "not_suspended".
        // If !locked, the org disappeared between the pre-flight check and now —
        // still treated as not_suspended so the caller returns 400, not 500.
        throw Object.assign(new Error("not_suspended"), { code: "NOT_SUSPENDED" });
      }

      // FK-safe deletion order — children before parents.
      // Session and Account cascade from User; no need to delete them explicitly.

      // 1. Selection — references Project + ComponentType
      await tx.selection.deleteMany({ where: { organizationId: orgId } });

      // 2. Partition — references Room
      await tx.partition.deleteMany({ where: { organizationId: orgId } });

      // 3. Room — references Floor (Stage 18; not strictly required since
      //    Room_floorId_fkey is onDelete: Cascade from Floor, but explicit for
      //    the same belt-and-braces reason as the other tables here — a Room
      //    whose organizationId is this org but whose floorId points at
      //    another org's Floor would otherwise abort the transaction on
      //    Room_organizationId_fkey when Organization is deleted in step 15).
      await tx.room.deleteMany({ where: { organizationId: orgId } });

      // 4. Floor — references Project
      await tx.floor.deleteMany({ where: { organizationId: orgId } });

      // 4b. ProjectCalculation — references Project + Organization (Stage 23 D-20; also Cascade at the DB,
      //     explicit here so the delete order never depends on it)
      await tx.projectCalculation.deleteMany({ where: { organizationId: orgId } });

      // 5. Project — references User (createdByUserId), ExternalCompany, Inquiry (SetNull)
      await tx.project.deleteMany({ where: { organizationId: orgId } });

      // 6. Inquiry — references User (createdByUserId), ExternalCompany
      await tx.inquiry.deleteMany({ where: { organizationId: orgId } });

      // 7. ItemPrice — references InventoryItem (also cascades, but explicit for clarity)
      await tx.itemPrice.deleteMany({ where: { organizationId: orgId } });

      // 8. InventoryItem
      await tx.inventoryItem.deleteMany({ where: { organizationId: orgId } });

      // 9a. ComponentTypeOrgConfig — references ComponentType (FK RESTRICT); must precede it.
      //     Stage 20 Batch 1: new table — easy to forget in cascade deletes, so called out
      //     explicitly here. See design-docs/04-data-model.md — ComponentTypeOrgConfig.
      //     Belt-and-braces filter (matches this file's convention from step 3's comment):
      //     catches any row where organizationId matches OR where the parent ComponentType
      //     belongs to this org, guarding against mismatched rows from a hypothetical bug.
      await tx.componentTypeOrgConfig.deleteMany({
        where: {
          OR: [
            { organizationId: orgId },
            { componentType: { organizationId: orgId } },
          ],
        },
      });

      // 9b. ComponentType — references ComponentCategory (Selection already gone)
      await tx.componentType.deleteMany({ where: { organizationId: orgId } });

      // 10. ComponentCategory
      await tx.componentCategory.deleteMany({ where: { organizationId: orgId } });

      // 11. User — Session + Account cascade via onDelete: Cascade on both
      //     Must come after Project/Inquiry (which reference User.createdByUserId)
      await tx.user.deleteMany({ where: { organizationId: orgId } });

      // 12. RolePermission — no organizationId column; filter via the Role relation
      await tx.rolePermission.deleteMany({
        where: { role: { organizationId: orgId } },
      });

      // 13. ExternalCompany — User/Project/Inquiry already deleted
      await tx.externalCompany.deleteMany({ where: { organizationId: orgId } });

      // 14. Role — User (roleId FK) and RolePermission already deleted
      await tx.role.deleteMany({ where: { organizationId: orgId } });

      // 15. Organization — all children gone
      await tx.organization.delete({ where: { id: orgId } });
    });

    return { ok: true, org: orgIdentity };
  } catch (err) {
    // Map the NOT_SUSPENDED sentinel (thrown inside the transaction) to the typed result.
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code: string }).code === "NOT_SUSPENDED"
    ) {
      return {
        ok: false,
        reason: "not_suspended",
        message: `Organization "${orgIdentity.slug}" must be suspended before it can be deleted`,
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
