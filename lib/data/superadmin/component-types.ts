// superadmin-only — intentionally cross-org
// This file belongs to the SuperAdmin data-access layer (lib/data/superadmin/).
// Functions here INTENTIONALLY use organizationId filters supplied as explicit
// function arguments, not from a session — orgId is always passed by the caller
// (org picker selection). This keeps the superadmin layer cross-org-capable
// while still enforcing per-call tenancy.
// This is the only directory in lib/data/ where cross-org queries are permitted.
// See Stage 16 architecture rule 1 in profile.md.

import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { FieldEntry } from "@/lib/types/field-entry";
import {
  RESERVED_COMPONENT_TYPE_CODES,
  ReservedComponentTypeCodeError,
} from "@/lib/component-catalog-seed";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ComponentTypeRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  active: boolean;
  categoryId: string;
  category: { id: string; name: string };
  fieldsSchema: FieldEntry[];
  sortOrder: number;
}

export interface ComponentCategoryRow {
  id: string;
  name: string;
  organizationId: string;
}

export interface ComponentTypeInput {
  code: string;
  name: string;
  categoryId: string;
  fieldsSchema: FieldEntry[];
  active?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse the stored JSONB to a typed FieldEntry array (defensive).
 * Self-contained copy within the superadmin layer (intentional — keeps the
 * superadmin module self-contained and cross-org-annotated without import
 * coupling to the org-scoped lib/data/components.ts).
 *
 * superadmin-only — intentionally cross-org
 */
function parseFieldsSchema(raw: unknown): FieldEntry[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set(["field", "radio", "dropdown", "checkbox"]);
  return (raw as unknown[])
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as Record<string, unknown>;
      const type = (validTypes.has(obj.type as string) ? obj.type : "field") as FieldEntry["type"];
      const entry: FieldEntry = {
        key: String(obj.key ?? ""),
        label: String(obj.label ?? ""),
        type,
        required: Boolean(obj.required),
        basic: obj.basic !== undefined ? Boolean(obj.basic) : true,
      };
      if (type === "radio" || type === "dropdown") {
        entry.options = Array.isArray(obj.options)
          ? (obj.options as unknown[]).map(String).filter(Boolean)
          : [];
      }
      if (obj.hint) {
        entry.hint = String(obj.hint);
      }
      // Stage 20: pass through dependsOn if present (SuperAdmin-authored wiring).
      if (obj.dependsOn && typeof obj.dependsOn === "string") {
        entry.dependsOn = obj.dependsOn;
      }
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);
}

/**
 * Verify a categoryId belongs to the given org (tenancy guard against FK injection).
 * Throws if the category is not found in the org.
 *
 * superadmin-only — intentionally cross-org
 */
async function assertCategoryInOrg(orgId: string, categoryId: string): Promise<void> {
  // superadmin-only — intentionally cross-org
  const category = await prisma.componentCategory.findFirst({
    where: { id: categoryId, organizationId: orgId },
    select: { id: true },
  });
  if (!category) throw new Error("Category not found or does not belong to this organization");
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * List all ComponentTypes for a given org, in admin-reorderable `sortOrder` order
 * (code A→Z as the tiebreak — Stage 20 Batch 7 replaces the previous `code`-only sort,
 * decoupling list order from the now-editable `code` string).
 *
 * superadmin-only — intentionally cross-org
 */
export async function listComponentTypesForOrg(orgId: string): Promise<ComponentTypeRow[]> {
  // superadmin-only — intentionally cross-org
  const rows = await prisma.componentType.findMany({
    where: { organizationId: orgId },
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return rows.map((r) => ({ ...r, fieldsSchema: parseFieldsSchema(r.fieldsSchema) }));
}

/**
 * Get a single ComponentType by ID, verifying it belongs to the given org.
 * Returns null if not found or if it belongs to a different org (prevents enumeration).
 *
 * superadmin-only — intentionally cross-org
 */
export async function getComponentTypeForOrg(
  orgId: string,
  typeId: string,
): Promise<ComponentTypeRow | null> {
  // superadmin-only — intentionally cross-org
  const row = await prisma.componentType.findFirst({
    where: { id: typeId, organizationId: orgId },
    include: { category: { select: { id: true, name: true } } },
  });
  if (!row) return null;
  return { ...row, fieldsSchema: parseFieldsSchema(row.fieldsSchema) };
}

/**
 * List all ComponentCategories for a given org, A→Z by name.
 * Used by the create/edit form category dropdown.
 *
 * superadmin-only — intentionally cross-org
 */
export async function listComponentCategoriesForOrg(orgId: string): Promise<ComponentCategoryRow[]> {
  // superadmin-only — intentionally cross-org
  return prisma.componentCategory.findMany({
    where: { organizationId: orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, organizationId: true },
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new ComponentType scoped to the given org.
 * Validates that categoryId belongs to the same org before insert (FK injection guard).
 * Returns the created ComponentType.
 *
 * superadmin-only — intentionally cross-org
 */
export async function createComponentTypeForOrg(
  orgId: string,
  input: ComponentTypeInput,
): Promise<ComponentTypeRow> {
  // superadmin-only — intentionally cross-org
  await assertCategoryInOrg(orgId, input.categoryId);

  // Stage 20 Batch 7: new rows append to the end of the org's reorderable list rather
  // than defaulting to sortOrder 0 (which would jump them to the front, tied with
  // whatever else backfilled to 0).
  const maxSortOrder = await prisma.componentType.aggregate({
    where: { organizationId: orgId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  const row = await prisma.componentType.create({
    data: {
      organizationId: orgId,
      code: input.code.toUpperCase().trim(),
      name: input.name.trim(),
      categoryId: input.categoryId,
      fieldsSchema: input.fieldsSchema as unknown as Prisma.InputJsonValue,
      active: input.active ?? true,
      sortOrder,
    },
    include: { category: { select: { id: true, name: true } } },
  });
  return { ...row, fieldsSchema: parseFieldsSchema(row.fieldsSchema) };
}

/**
 * Update an existing ComponentType, verifying it belongs to the given org first.
 * Re-validates categoryId if it is being changed (FK injection guard).
 * Returns the updated ComponentType, or null if not found / wrong org.
 *
 * superadmin-only — intentionally cross-org
 */
export async function updateComponentTypeForOrg(
  orgId: string,
  typeId: string,
  patch: Partial<ComponentTypeInput>,
): Promise<ComponentTypeRow | null> {
  // superadmin-only — intentionally cross-org
  // Verify ownership before updating. Also fetch `code` so a code-rename attempt on one
  // of the 3 seeded/reserved codes can be rejected below (Stage 20 Batch 7).
  const existing = await prisma.componentType.findFirst({
    where: { id: typeId, organizationId: orgId },
    select: { id: true, code: true },
  });
  if (!existing) return null;

  if (patch.code !== undefined) {
    const normalizedCode = patch.code.toUpperCase().trim();
    if (RESERVED_COMPONENT_TYPE_CODES.has(existing.code) && normalizedCode !== existing.code) {
      throw new ReservedComponentTypeCodeError(
        `Cannot change the code of a reserved component type (${existing.code}).`,
      );
    }
  }

  if (patch.categoryId !== undefined) {
    await assertCategoryInOrg(orgId, patch.categoryId);
  }

  const row = await prisma.componentType.update({
    where: { id: typeId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.code !== undefined ? { code: patch.code.toUpperCase().trim() } : {}),
      ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}),
      ...(patch.fieldsSchema !== undefined
        ? { fieldsSchema: patch.fieldsSchema as unknown as Prisma.InputJsonValue }
        : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
    include: { category: { select: { id: true, name: true } } },
  });
  return { ...row, fieldsSchema: parseFieldsSchema(row.fieldsSchema) };
}

/**
 * Move a ComponentType up or down one position in the org's reorderable list — swaps
 * `sortOrder` with the adjacent row in the current `sortOrder asc, code asc` ordering.
 * No drag-and-drop; a solo dev reordering ~3-15 rows per org doesn't need one.
 *
 * Returns { notFound: true } if typeId doesn't belong to the org.
 * Returns { noop: true } if the type is already at that edge of the list (no adjacent row).
 * Returns { swapped: true } on success.
 *
 * superadmin-only — intentionally cross-org
 */
export async function moveComponentTypeForOrg(
  orgId: string,
  typeId: string,
  direction: "up" | "down",
): Promise<{ notFound: true } | { noop: true } | { swapped: true }> {
  // superadmin-only — intentionally cross-org
  const rows = await prisma.componentType.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, sortOrder: true },
  });

  const index = rows.findIndex((r) => r.id === typeId);
  if (index === -1) return { notFound: true };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= rows.length) return { noop: true };

  const current = rows[index];
  const neighbor = rows[swapIndex];

  await prisma.$transaction([
    prisma.componentType.update({
      where: { id: current.id },
      data: { sortOrder: neighbor.sortOrder },
    }),
    prisma.componentType.update({
      where: { id: neighbor.id },
      data: { sortOrder: current.sortOrder },
    }),
  ]);

  return { swapped: true };
}

/**
 * Delete a ComponentType, verifying it belongs to the given org first.
 * Returns { deleted: true } on success.
 * Returns { notFound: true } if the type doesn't exist or belongs to a different org.
 * Returns { inUse: true, selectionCount: number } if the type has existing Selections
 * (FK RESTRICT — cannot delete; caller returns 409).
 *
 * superadmin-only — intentionally cross-org
 */
export async function deleteComponentTypeForOrg(
  orgId: string,
  typeId: string,
): Promise<
  | { deleted: true }
  | { notFound: true }
  | { inUse: true; selectionCount: number }
> {
  // superadmin-only — intentionally cross-org
  const existing = await prisma.componentType.findFirst({
    where: { id: typeId, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return { notFound: true };

  // Guard: cannot delete a type that is referenced by existing Selections.
  const selectionCount = await prisma.selection.count({
    where: { componentTypeId: typeId, organizationId: orgId },
  });
  if (selectionCount > 0) return { inUse: true, selectionCount };

  // Stage 20 Batch 1: ComponentTypeOrgConfig carries an ON DELETE RESTRICT FK to ComponentType.
  // Delete the config row first (if any), then the type — same pattern as deleteOrganization's
  // FK-safe cascade in lib/data/superadmin/orgs.ts.
  await prisma.$transaction(async (tx) => {
    await tx.componentTypeOrgConfig.deleteMany({ where: { componentTypeId: typeId } });
    await tx.componentType.delete({ where: { id: typeId } });
  });
  return { deleted: true };
}

// ─── Audit log ────────────────────────────────────────────────────────────────

/**
 * Write a SuperAdminAuditLog row for a ComponentType mutation (append-only).
 *
 * Must be called after a successful mutation, not inside the mutation transaction
 * (so the audit log row is only written if the mutation committed).
 *
 * Intentionally NOT wrapped in try/catch here — an audit log write failure must
 * propagate as an error rather than being silently swallowed (Stage 16/17
 * discipline: every SuperAdmin mutation must have an audit row).
 *
 * superadmin-only — intentionally cross-org
 */
export async function createComponentTypeAuditLog(
  superAdminId: string,
  typeId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // superadmin-only — intentionally cross-org
  await prisma.superAdminAuditLog.create({
    data: {
      superAdminId,
      action,
      targetType: "ComponentType",
      targetId: typeId,
      ...(metadata !== undefined
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
    },
  });
}
