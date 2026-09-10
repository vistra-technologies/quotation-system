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
 * List all ComponentTypes for a given org, A→Z by code.
 *
 * superadmin-only — intentionally cross-org
 */
export async function listComponentTypesForOrg(orgId: string): Promise<ComponentTypeRow[]> {
  // superadmin-only — intentionally cross-org
  const rows = await prisma.componentType.findMany({
    where: { organizationId: orgId },
    include: { category: { select: { id: true, name: true } } },
    orderBy: { code: "asc" },
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

  const row = await prisma.componentType.create({
    data: {
      organizationId: orgId,
      code: input.code.toUpperCase().trim(),
      name: input.name.trim(),
      categoryId: input.categoryId,
      fieldsSchema: input.fieldsSchema as unknown as Prisma.InputJsonValue,
      active: input.active ?? true,
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
  // Verify ownership before updating.
  const existing = await prisma.componentType.findFirst({
    where: { id: typeId, organizationId: orgId },
    select: { id: true },
  });
  if (!existing) return null;

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

  await prisma.componentType.delete({ where: { id: typeId } });
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
