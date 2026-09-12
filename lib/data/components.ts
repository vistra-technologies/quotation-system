import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";
import type { FieldEntry as _FieldEntry } from "@/lib/types/field-entry";
import type {
  FieldOptionsEntry as _FieldOptionsEntry,
  FieldOptionsConfig as _FieldOptionsConfig,
} from "@/lib/types/field-options-config";
import {
  RESERVED_COMPONENT_TYPE_CODES,
  ReservedComponentTypeCodeError,
} from "@/lib/component-catalog-seed";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single field definition within a ComponentType's fieldsSchema.
 * Stored as JSONB; shape is admin-defined at runtime.
 *
 * Defined in lib/types/field-entry.ts and re-exported here so that callers
 * in app/api/** can continue using `import type { FieldEntry } from "@/lib/data/components"`.
 *
 * Stage 6 shape:
 *   type: "field" (plain text) | "radio" | "dropdown" | "checkbox"
 *   options: required (non-empty) when type is radio or dropdown
 *   hint: optional helper text shown under the input
 *   basic: true → shown in the Basic section; false → shown in Advanced section
 *
 * All ComponentTypes and fields are admin-created — there is no developer-seeded/"core"
 * distinction; every field is freely editable and inert until a developer wires it in.
 */
export type FieldEntry = _FieldEntry;

/**
 * Shape of a single field's entry in ComponentTypeOrgConfig.fieldOptionsConfig.
 * Stage 20 Batch 1. Defined in lib/types/field-options-config.ts (Stage 20 Batch 3 — extracted
 * so org-scoped app/[orgSlug]/** components can import the type without importing lib/data/*)
 * and re-exported here for backward compatibility with app/api/** callers.
 *
 * A flat field (no dependsOn in fieldsSchema) → { options: string[] }
 * A dependent field (has dependsOn) → { valueMap: Record<parentValue, string[]> }
 */
export type FieldOptionsEntry = _FieldOptionsEntry;

/**
 * Parsed fieldOptionsConfig map — keyed by fieldKey.
 * Returned alongside fieldsSchema wherever ComponentTypeOrgConfig is included.
 * Stage 20 Batch 1.
 */
export type FieldOptionsConfig = _FieldOptionsConfig;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse the stored JSONB to a typed FieldEntry array (defensive). */
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
        // `basic` defaults to true when absent (backwards-compat with old rows)
        basic: obj.basic !== undefined ? Boolean(obj.basic) : true,
      };
      // options: conditionally included for radio/dropdown.
      // Reads are intentionally lenient here (empty options → options: []) because
      // the write-path in actions.ts throws if options are missing, so well-formed data
      // never reaches the DB. Area 3 renderers should guard defensively on options.length
      // rather than trusting type alone.
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
 * Parse the stored JSONB fieldOptionsConfig into a typed FieldOptionsConfig map.
 * Defensive: unknown shapes are dropped; only entries with an `options` array or
 * a `valueMap` object are preserved.
 * Stage 20 Batch 1.
 */
function parseFieldOptionsConfig(raw: unknown): FieldOptionsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const result: FieldOptionsConfig = {};
  for (const [key, entry] of Object.entries(obj)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (Array.isArray(e.options)) {
      result[key] = { options: (e.options as unknown[]).map(String).filter(Boolean) };
    } else if (e.valueMap && typeof e.valueMap === "object" && !Array.isArray(e.valueMap)) {
      const valueMap: Record<string, string[]> = {};
      for (const [parentVal, vals] of Object.entries(e.valueMap as Record<string, unknown>)) {
        if (Array.isArray(vals)) {
          valueMap[parentVal] = (vals as unknown[]).map(String).filter(Boolean);
        }
      }
      result[key] = { valueMap };
    }
  }
  return result;
}

// ─── Read functions ───────────────────────────────────────────────────────────

/** List all ComponentCategories for the session org, A→Z by name — for the category dropdown. */
export async function listComponentCategories(session: SessionData) {
  return prisma.componentCategory.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
  });
}

/**
 * List all ComponentTypes for the session org, in admin-reorderable `sortOrder` order (code
 * A→Z as the tiebreak — Stage 20 Batch 7 replaces the previous `code`-only sort, decoupling
 * the "Add Component" palette order from the now-editable `code` string), with their
 * org-level field option config (Stage 20 Batch 1 introduced the join, Batch 4 folded it into
 * this function directly — see review-B3 MINOR #3: this used to be a separate
 * `listComponentTypesWithConfig` pair that never got a caller other than the Catalog screen,
 * which now also reads this function's result).
 *
 * `fieldOptionsConfig` is null when no ComponentTypeOrgConfig row exists yet for that type (i.e.
 * the org hasn't configured any of its dropdown/radio fields).
 */
export async function listComponentTypes(session: SessionData) {
  const rows = await prisma.componentType.findMany({
    where: { organizationId: session.organizationId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    include: { category: true, orgConfig: true },
  });
  return rows.map((r) => {
    const { orgConfig, ...rest } = r;
    return {
      ...rest,
      fieldsSchema: parseFieldsSchema(rest.fieldsSchema),
      fieldOptionsConfig: orgConfig ? parseFieldOptionsConfig(orgConfig.fieldOptionsConfig) : null,
    };
  });
}

/**
 * Get a single ComponentType by id, scoped to the session org (tenancy guard), with its
 * org-level field option config (Stage 20 Batch 4 — folded in, see `listComponentTypes` above).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getComponentTypeById(session: SessionData, id: string) {
  const row = await prisma.componentType.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { category: true, orgConfig: true },
  });
  if (!row) return null;
  const { orgConfig, ...rest } = row;
  return {
    ...rest,
    fieldsSchema: parseFieldsSchema(rest.fieldsSchema),
    fieldOptionsConfig: orgConfig ? parseFieldOptionsConfig(orgConfig.fieldOptionsConfig) : null,
  };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export type ComponentTypeInput = {
  code: string;
  name: string;
  categoryId: string; // FK → ComponentCategory, chosen from the dropdown
  fieldsSchema: FieldEntry[];
  active?: boolean;
};

/** Verify a categoryId belongs to the session org (tenancy guard against FK injection). */
async function assertCategoryInOrg(session: SessionData, categoryId: string) {
  const category = await prisma.componentCategory.findFirst({
    where: { id: categoryId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!category) throw new Error("Category not found or access denied");
}

/** Create a new ComponentType scoped to the session org. */
export async function createComponentType(session: SessionData, input: ComponentTypeInput) {
  await assertCategoryInOrg(session, input.categoryId);

  // Stage 20 Batch 7: new rows append to the end of the org's reorderable list rather
  // than defaulting to sortOrder 0.
  const maxSortOrder = await prisma.componentType.aggregate({
    where: { organizationId: session.organizationId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  return prisma.componentType.create({
    data: {
      organizationId: session.organizationId,
      code: input.code.toUpperCase().trim(),
      name: input.name.trim(),
      categoryId: input.categoryId,
      fieldsSchema: input.fieldsSchema,
      active: input.active ?? true,
      sortOrder,
    },
  });
}

/**
 * Update a ComponentType, scoped to the session org (tenancy guard).
 * Throws if the type is not found or belongs to a different org.
 */
export async function updateComponentType(
  session: SessionData,
  id: string,
  input: Partial<ComponentTypeInput>,
) {
  // Tenancy guard — verify the record belongs to the session's org. Also fetch `code` so
  // a code-rename attempt on one of the 3 seeded/reserved codes can be rejected below
  // (Stage 20 Batch 7).
  const existing = await prisma.componentType.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true, code: true },
  });
  if (!existing) throw new Error("ComponentType not found or access denied");

  if (input.code !== undefined) {
    const normalizedCode = input.code.toUpperCase().trim();
    if (RESERVED_COMPONENT_TYPE_CODES.has(existing.code) && normalizedCode !== existing.code) {
      throw new ReservedComponentTypeCodeError(
        `Cannot change the code of a reserved component type (${existing.code}).`,
      );
    }
  }

  if (input.categoryId !== undefined) {
    await assertCategoryInOrg(session, input.categoryId);
  }

  return prisma.componentType.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code.toUpperCase().trim() } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.fieldsSchema !== undefined ? { fieldsSchema: input.fieldsSchema } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

/**
 * Replace the whole `fieldOptionsConfig` blob for a ComponentType's org-level config row.
 * Stage 20 Batch 3 — backs the Catalog screen's PUT.
 *
 * Tenancy guard: verifies the ComponentType belongs to the session org before writing (same
 * `findFirst({ id, organizationId })` pattern as `updateComponentType`) — throws if not found or
 * cross-org, which the route maps to 404.
 *
 * Upserts on `componentTypeId` (Batch 1's 1:1 unique index) — creates the config row on first
 * save, replaces it wholesale on every subsequent save. Caller (the API route) is responsible for
 * running the payload through `validateFieldOptionsConfig` first; this function does not
 * re-validate against `fieldsSchema`.
 */
export async function setComponentTypeOrgConfig(
  session: SessionData,
  typeId: string,
  fieldOptionsConfig: FieldOptionsConfig,
) {
  const existing = await prisma.componentType.findFirst({
    where: { id: typeId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) throw new Error("ComponentType not found or access denied");

  return prisma.componentTypeOrgConfig.upsert({
    where: { componentTypeId: typeId },
    create: {
      organizationId: session.organizationId,
      componentTypeId: typeId,
      fieldOptionsConfig: fieldOptionsConfig as unknown as Prisma.InputJsonValue,
    },
    update: {
      fieldOptionsConfig: fieldOptionsConfig as unknown as Prisma.InputJsonValue,
    },
  });
}
