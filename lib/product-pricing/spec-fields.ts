import type { FieldEntry, ShowWhen } from "@/lib/types/field-entry";

/**
 * Stage 36 (S36-1, S36-2, F-3): the product spec fields of a ComponentType, ready for the combination generator.
 * Pure and dependency-free (type-only import), safe in server code and client components.
 *
 * Only dropdown/radio fields with `productSpec: true` are returned, in schema order. The existing visibility
 * pass (`applyFieldVisibility`) treats a `showWhen` whose controller is missing from the list it is given as
 * hidden forever. In spec mode the non-spec controllers are not in the list, so such a field would vanish from
 * every combination. O-2 (b): the controller's value is unknown, so the field is always visible. That is done
 * here, once: a `showWhen` whose controller is not itself a returned spec field is dropped.
 */

export interface SpecField {
  key: string;
  label: string;
  dependsOn?: string;
  showWhen?: ShowWhen;
}

const CHOICE = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

export function isSpecChoiceField(f: Pick<FieldEntry, "type" | "productSpec">): boolean {
  return f.productSpec === true && CHOICE.has(f.type);
}

/** Number of Product spec fields on a type (the SuperAdmin list column). */
export function countProductSpecs(fieldsSchema: ReadonlyArray<Pick<FieldEntry, "type" | "productSpec">>): number {
  return fieldsSchema.filter(isSpecChoiceField).length;
}

/**
 * The spec fields as full entries (for `isComponentTypeFullyConfigured`, S36-9), with the same F-3 rule as
 * `specFieldList`: a `showWhen` whose controller is not itself a spec field is dropped.
 */
export function specFieldEntries(fieldsSchema: ReadonlyArray<FieldEntry>): FieldEntry[] {
  const spec = fieldsSchema.filter(isSpecChoiceField);
  const specKeys = new Set(spec.map((f) => f.key));
  return spec.map((f) => {
    if (!f.showWhen || specKeys.has(f.showWhen.field)) return f;
    const rest = { ...f };
    delete rest.showWhen;
    return rest;
  });
}

export function specFieldList(
  fieldsSchema: ReadonlyArray<Pick<FieldEntry, "key" | "label" | "type" | "dependsOn" | "showWhen" | "productSpec">>,
): SpecField[] {
  const spec = fieldsSchema.filter(isSpecChoiceField);
  const specKeys = new Set(spec.map((f) => f.key));
  return spec.map((f) => ({
    key: f.key,
    label: f.label,
    ...(f.dependsOn ? { dependsOn: f.dependsOn } : {}),
    ...(f.showWhen && specKeys.has(f.showWhen.field) ? { showWhen: f.showWhen } : {}),
  }));
}
