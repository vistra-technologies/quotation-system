import { prisma } from "@/lib/prisma";
import type { SessionData } from "@/lib/session";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A single field definition within a ComponentType's fieldsSchema.
 * Stored as JSONB; shape is admin-defined at runtime.
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
export type FieldEntry = {
  key: string; // machine key used by the configurator
  label: string; // human-readable display label
  type: "field" | "radio" | "dropdown" | "checkbox";
  options?: string[]; // required for radio and dropdown; absent for field/checkbox
  hint?: string; // optional helper text
  required: boolean;
  basic: boolean; // true = Basic section, false = Advanced section
};

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
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);
}

// ─── Read functions ───────────────────────────────────────────────────────────

/** List all ComponentCategories for the session org, A→Z by name — for the category dropdown. */
export async function listComponentCategories(session: SessionData) {
  return prisma.componentCategory.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { name: "asc" },
  });
}

/** List all ComponentTypes for the session org, A→Z by code. */
export async function listComponentTypes(session: SessionData) {
  const rows = await prisma.componentType.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { code: "asc" },
    include: { category: true },
  });
  return rows.map((r) => ({ ...r, fieldsSchema: parseFieldsSchema(r.fieldsSchema) }));
}

/**
 * Get a single ComponentType by id, scoped to the session org (tenancy guard).
 * Returns null if not found or if it belongs to a different org.
 */
export async function getComponentTypeById(session: SessionData, id: string) {
  const row = await prisma.componentType.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { category: true },
  });
  if (!row) return null;
  return { ...row, fieldsSchema: parseFieldsSchema(row.fieldsSchema) };
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
  return prisma.componentType.create({
    data: {
      organizationId: session.organizationId,
      code: input.code.toUpperCase().trim(),
      name: input.name.trim(),
      categoryId: input.categoryId,
      fieldsSchema: input.fieldsSchema,
      active: input.active ?? true,
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
  // Tenancy guard — verify the record belongs to the session's org.
  const existing = await prisma.componentType.findFirst({
    where: { id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!existing) throw new Error("ComponentType not found or access denied");
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
