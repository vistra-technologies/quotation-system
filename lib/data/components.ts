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
 *   core: true → seeded by the platform; false → admin-created
 */
export type FieldEntry = {
  key: string; // machine key used by the configurator
  label: string; // human-readable display label
  type: "field" | "radio" | "dropdown" | "checkbox";
  options?: string[]; // required for radio and dropdown; absent for field/checkbox
  hint?: string; // optional helper text
  required: boolean;
  basic: boolean; // true = Basic section, false = Advanced section
  core: boolean; // true = seeded by platform
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Seeded core codes — these will be wired into the configurator in Stage 6. */
const CORE_CODES = new Set(["GLASS", "DOOR", "PROFILE_STOP"]);

/** True for ComponentTypes whose codes were seeded by the platform (core). */
export function isCoreComponentType(code: string): boolean {
  return CORE_CODES.has(code);
}

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
        core: Boolean(obj.core),
      };
      // options: conditionally included for radio/dropdown
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

/** List all ComponentTypes for the session org, A→Z by code. */
export async function listComponentTypes(session: SessionData) {
  const rows = await prisma.componentType.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { code: "asc" },
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
  });
  if (!row) return null;
  return { ...row, fieldsSchema: parseFieldsSchema(row.fieldsSchema) };
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export type ComponentTypeInput = {
  code: string;
  name: string;
  category: string; // admin-defined grouping label (e.g. "Glass Partitions") — added Stage 6
  fieldsSchema: FieldEntry[];
  active?: boolean;
};

/** Create a new ComponentType scoped to the session org. */
export async function createComponentType(session: SessionData, input: ComponentTypeInput) {
  return prisma.componentType.create({
    data: {
      organizationId: session.organizationId,
      code: input.code.toUpperCase().trim(),
      name: input.name.trim(),
      category: input.category.trim(),
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

  return prisma.componentType.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.code !== undefined ? { code: input.code.toUpperCase().trim() } : {}),
      ...(input.category !== undefined ? { category: input.category.trim() } : {}),
      ...(input.fieldsSchema !== undefined ? { fieldsSchema: input.fieldsSchema } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}
