import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

/**
 * Shared, pure Configurator gating helpers — Stage 20 Batch 4.
 *
 * Deliberately dependency-free (no `prisma`/`next` imports), same class of file as
 * `lib/validate-fields-schema.ts` / `lib/validate-field-options-config.ts` — importable from both
 * server DAL code (`lib/data/selections.ts`, the server-side "reject an unconfigured type" gate)
 * and client components (`add-selection-form.tsx`, the "Add Component" palette's live gating +
 * cascading UI).
 */

const CHOICE_TYPES = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

/**
 * Whole-ComponentType configuredness check — decision #5, stage-20.md: if *any* dropdown/radio
 * field on the type (root or dependent, including any unmapped `valueMap` branch for some parent
 * value) is unconfigured, the entire type is unselectable. There is no partial pass.
 *
 * Walks `fieldsSchema` in array order — parents are always earlier than their dependents
 * (enforced at authoring time, decision #4) — building up the transitive set of values each
 * choice field can actually produce given the org's current `fieldOptionsConfig`:
 *   - A root field (no `dependsOn`) is configured iff its `options` list is non-empty.
 *   - A dependent field is configured iff, for *every* value its parent can produce, there is a
 *     non-empty `valueMap` entry. Its own producible-value set (used by anything depending on it,
 *     for multi-hop chains) is the union of every branch's values.
 * The first failure short-circuits the whole check to false.
 */
export function isComponentTypeFullyConfigured(
  fieldsSchema: FieldEntry[],
  fieldOptionsConfig: FieldOptionsConfig | null,
): boolean {
  const config = fieldOptionsConfig ?? {};
  const resolvedValues = new Map<string, string[]>();

  for (const field of fieldsSchema) {
    if (!CHOICE_TYPES.has(field.type)) continue;

    if (!field.dependsOn) {
      const entry = config[field.key];
      const options = entry && "options" in entry ? entry.options : [];
      if (options.length === 0) return false;
      resolvedValues.set(field.key, options);
      continue;
    }

    // Parent must already be resolved (earlier in the array, per decision #4). If it isn't —
    // an invalid/dangling dependsOn, which server-side validation should already prevent — fail
    // closed rather than silently treating the field as vacuously configured.
    const parentValues = resolvedValues.get(field.dependsOn);
    if (!parentValues) return false;

    const entry = config[field.key];
    const valueMap = entry && "valueMap" in entry ? entry.valueMap : {};
    const produced: string[] = [];
    for (const parentVal of parentValues) {
      const vals = valueMap[parentVal];
      if (!vals || vals.length === 0) return false;
      produced.push(...vals);
    }
    resolvedValues.set(field.key, [...new Set(produced)]);
  }

  return true;
}

/**
 * Resolve the current value list for a dropdown/radio field in an *open* configure form —
 * "live" meaning based on the parent's currently-selected value in this form session, not the
 * parent's full producible-value set (that's `isComponentTypeFullyConfigured`'s job, and Batch 3's
 * `liveValuesOf` in the Catalog editor's different job of previewing every branch at once).
 *
 * - Root field (no `dependsOn`): its configured `options` list.
 * - Dependent field: looks up `currentFieldValues[field.dependsOn]` — the value the user has
 *   currently picked for the immediate parent in this form — and returns that value's `valueMap`
 *   branch. Returns `[]` if the parent hasn't been given a value yet, or if the field/branch
 *   isn't configured (the type wouldn't have passed `isComponentTypeFullyConfigured` in that case,
 *   but this stays defensive rather than throwing).
 */
export function resolveOptions(
  field: FieldEntry,
  currentFieldValues: Record<string, string | boolean>,
  fieldOptionsConfig: FieldOptionsConfig | null,
): string[] {
  const config = fieldOptionsConfig ?? {};
  const entry = config[field.key];

  if (!field.dependsOn) {
    return entry && "options" in entry ? entry.options : [];
  }

  const parentValue = currentFieldValues[field.dependsOn];
  if (typeof parentValue !== "string" || !parentValue) return [];
  return entry && "valueMap" in entry ? (entry.valueMap[parentValue] ?? []) : [];
}

/**
 * All field keys that transitively depend on `key` (children, grandchildren, ...), in a linear
 * `dependsOn` chain (decision: no diamond/multi-parent dependencies this stage). Used to clear
 * descendant values from an open form's state when their parent's selected value changes — no
 * orphaned stale values should survive in `Selection.config`.
 */
export function collectDescendants(fieldsSchema: FieldEntry[], key: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const f of fieldsSchema) {
    if (!f.dependsOn) continue;
    const siblings = childrenOf.get(f.dependsOn) ?? [];
    siblings.push(f.key);
    childrenOf.set(f.dependsOn, siblings);
  }

  const result: string[] = [];
  const stack = [...(childrenOf.get(key) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    result.push(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return result;
}
