/**
 * Stage 35 S35-7 / S35-8 — the `inventoryLinked` check.
 *
 * A ComponentType field flagged `inventoryLinked` (dropdown/radio) must only offer values that are the
 * `code` of an ACTIVE InventoryItem of the org whose `componentTypeId` is that ComponentType. An inactive
 * item, another type's item and a legacy NULL-type item all count as missing.
 *
 * PURE: type-only imports, no Prisma, no lib/data/*. Two consumers:
 *   - the Catalog GET (`inventoryLinkIssues`): every PRODUCIBLE value of every linked field;
 *   - Submit Design / Recompute (`addUnlinkedCodeProblems`): every VISIBLE linked value a used Selection holds.
 */
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { applyFieldVisibility, visibilityFieldsFromRaw } from "@/lib/field-visibility";
import type { ProblemCollector } from "@/lib/materials/problems";

const CHOICE_TYPES = new Set(["dropdown", "radio"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Every value each dropdown/radio field can produce given the org's option config, keyed by field key, in
 * branch order. A root field produces its `options`; a dependent field produces the union of the `valueMap`
 * branches of the parent values the PARENT can itself produce (a branch keyed by a value the parent cannot
 * produce is unreachable). `showWhen` prunes nothing: a hidden-only branch is still producible, since the
 * controller can change later (S35-7).
 */
export function producibleValues(
  fields: ReadonlyArray<Pick<FieldEntry, "key" | "type" | "dependsOn">>,
  fieldOptionsConfig: FieldOptionsConfig | null,
): Map<string, string[]> {
  const config = fieldOptionsConfig ?? {};
  const out = new Map<string, string[]>();
  for (const field of fields) {
    if (!CHOICE_TYPES.has(field.type)) continue;
    const entry = config[field.key];
    if (!field.dependsOn) {
      out.set(field.key, entry && "options" in entry ? [...new Set(entry.options)] : []);
      continue;
    }
    const valueMap = entry && "valueMap" in entry ? entry.valueMap : {};
    const produced: string[] = [];
    for (const parentValue of out.get(field.dependsOn) ?? []) {
      for (const v of valueMap[parentValue] ?? []) if (!produced.includes(v)) produced.push(v);
    }
    out.set(field.key, produced);
  }
  return out;
}

/**
 * Catalog: per `inventoryLinked` field key, the producible values with no active same-type item, in branch
 * order. Fields with nothing missing are omitted, so `{}` means "no issue". `isLinked(code)` answers for ONE
 * ComponentType (the caller binds the type).
 */
export function inventoryLinkIssues(
  fields: ReadonlyArray<Pick<FieldEntry, "key" | "type" | "dependsOn" | "inventoryLinked">>,
  fieldOptionsConfig: FieldOptionsConfig | null,
  isLinked: (code: string) => boolean,
): Record<string, string[]> {
  const issues: Record<string, string[]> = {};
  if (!fields.some((f) => f.inventoryLinked === true)) return issues;
  const produced = producibleValues(fields, fieldOptionsConfig);
  for (const field of fields) {
    if (field.inventoryLinked !== true || !CHOICE_TYPES.has(field.type)) continue;
    const missing = (produced.get(field.key) ?? []).filter((v) => !isLinked(v));
    if (missing.length > 0) issues[field.key] = missing;
  }
  return issues;
}

/** Selection ids referenced by a cell of the design, in stored (floor, room, wall, section, cell) order. */
export function usedSelectionIds(
  floors: ReadonlyArray<{ rooms: ReadonlyArray<{ partitions: ReadonlyArray<{ design: unknown }> }> }>,
): string[] {
  const seen = new Set<string>();
  for (const floor of floors) {
    for (const room of floor.rooms) {
      for (const partition of room.partitions) {
        const design = partition.design;
        const sections = isRecord(design) && Array.isArray(design.sections) ? design.sections : [];
        for (const section of sections) {
          if (!isRecord(section) || !Array.isArray(section.cells)) continue;
          for (const cell of section.cells as unknown[]) {
            const id = isRecord(cell) ? cell.selectionId : undefined;
            if (typeof id === "string" && id !== "") seen.add(id);
          }
        }
      }
    }
  }
  return [...seen];
}

/**
 * Submit Design / Recompute: for every used Selection, every VISIBLE `inventoryLinked` value (the project's
 * snapshot schema) with no active same-type item becomes an INVENTORY-scope `UNLINKED_CODE`. A code the
 * engine already reported as UNRESOLVED_CODE / INACTIVE_ITEM is not reported again; a hidden linked value
 * is not reported (the visibility pass removes it first).
 */
export function addUnlinkedCodeProblems(
  collector: ProblemCollector,
  input: {
    selections: ReadonlyArray<{ id: string; componentTypeId: string; config: unknown }>;
    usedSelectionIds: ReadonlyArray<string>;
    snapshotTypes: ReadonlyArray<{ id: string; code: string; name: string; fieldsSchema: unknown }>;
    /** Is `code` an ACTIVE InventoryItem of this org whose componentTypeId is `typeId`? */
    isLinked: (typeId: string, code: string) => boolean;
  },
): void {
  const selectionById = new Map(input.selections.map((s) => [s.id, s]));
  const typeById = new Map(input.snapshotTypes.map((t) => [t.id, t]));
  for (const id of input.usedSelectionIds) {
    const sel = selectionById.get(id);
    const type = sel ? typeById.get(sel.componentTypeId) : undefined;
    if (!sel || !type || !Array.isArray(type.fieldsSchema) || !isRecord(sel.config)) continue;
    const { visibleKeys } = applyFieldVisibility(visibilityFieldsFromRaw(type.fieldsSchema), sel.config);
    for (const raw of type.fieldsSchema as unknown[]) {
      if (!isRecord(raw) || raw.inventoryLinked !== true || typeof raw.key !== "string") continue;
      if (typeof raw.type !== "string" || !CHOICE_TYPES.has(raw.type)) continue;
      if (!visibleKeys.has(raw.key)) continue;
      const value = sel.config[raw.key];
      if (typeof value !== "string" || value === "") continue;
      if (input.isLinked(type.id, value)) continue;
      if (collector.hasCode(value, ["UNRESOLVED_CODE", "INACTIVE_ITEM"])) continue;
      collector.add({
        kind: "UNLINKED_CODE",
        scope: "INVENTORY",
        message: `${value} is not an active ${type.name} inventory item`,
        code: value,
        locus: { selectionId: sel.id, componentTypeCode: type.code, fieldKey: raw.key },
      });
    }
  }
}
