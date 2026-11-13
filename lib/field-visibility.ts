import type { FieldEntry, ShowWhen } from "@/lib/types/field-entry";

/**
 * Stage 35 S35-3 — the single field-visibility pass.
 *
 * Pure and dependency-free (type-only import), importable from server code and client components.
 * Every reader of a ComponentType's field rules uses this; none re-implements it.
 *
 * `visible(f)` = no `showWhen`, or the controller is visible AND the controller's value is in `in`.
 * `fieldsSchema` is ordered (a controller is always earlier than the field it gates, enforced at
 * authoring time), so one forward pass resolves every field and cascades by construction: a hidden
 * controller hides everything it gates, regardless of any stale value left in `values`.
 */

/** The part of a FieldEntry the pass reads. A full `FieldEntry[]` is accepted as is. */
export type VisibilityField = Pick<FieldEntry, "key" | "showWhen">;

/** Which field keys are visible for these values, plus `values` with every hidden key removed. */
export function applyFieldVisibility<V = unknown>(
  fieldsSchema: ReadonlyArray<VisibilityField>,
  values: Record<string, V>,
): { visibleKeys: Set<string>; values: Record<string, V> } {
  const visibleKeys = new Set<string>();
  for (const f of fieldsSchema) {
    const sw = f.showWhen;
    if (!sw) {
      visibleKeys.add(f.key);
      continue;
    }
    const controllerValue = values[sw.field];
    if (
      visibleKeys.has(sw.field) &&
      typeof controllerValue === "string" &&
      sw.in.includes(controllerValue)
    ) {
      visibleKeys.add(f.key);
    }
  }
  const cleaned: Record<string, V> = {};
  for (const [k, v] of Object.entries(values)) {
    // Keys that are not in the schema at all are left to the caller's own unknown-key handling.
    const known = fieldsSchema.some((f) => f.key === k);
    if (!known || visibleKeys.has(k)) cleaned[k] = v;
  }
  return { visibleKeys, values: cleaned };
}

/**
 * Lenient read normaliser for the stored-JSON parsers: returns a well-formed `showWhen` or
 * `undefined` (a malformed stored value is dropped on read, never thrown on). Authoring
 * validation is strict and lives in `validateFieldsSchema`.
 */
export function readShowWhen(raw: unknown): ShowWhen | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.field !== "string" || o.field === "" || !Array.isArray(o.in)) return undefined;
  if (!o.in.every((v) => typeof v === "string" && v !== "")) return undefined;
  return { field: o.field, in: [...(o.in as string[])] };
}

/**
 * Raw stored `fieldsSchema` JSON (e.g. a `configSnapshot` type) -> the fields `applyFieldVisibility` reads.
 * Lenient like the parsers: non-object entries and entries without a string `key` are skipped, a malformed
 * `showWhen` is dropped (the field is then always visible).
 */
export function visibilityFieldsFromRaw(raw: unknown): VisibilityField[] {
  if (!Array.isArray(raw)) return [];
  const out: VisibilityField[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.key !== "string") continue;
    const showWhen = readShowWhen(o.showWhen);
    out.push(showWhen ? { key: o.key, showWhen } : { key: o.key });
  }
  return out;
}
