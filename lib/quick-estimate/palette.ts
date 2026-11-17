import { isComponentTypeFullyConfigured } from "@/lib/configurator-gating";
import { applyFieldVisibility } from "@/lib/field-visibility";
import type { FieldEntry, ShowWhen } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { UNIT_AREA, UNIT_PIECE, type EstimateUnit } from "./estimate";

/**
 * Quick Estimate palette: the setup guard (S33-2), unit derivation (S33-4) and the item combinations (S33-5).
 * Client-safe: imports only types and the pure configurator-gating helper.
 */

/** The seeded Partition type; locked by RESERVED_COMPONENT_TYPE_CODES, so matching on the code is safe. */
export const PARTITION_CODE = "GLASS";

/** One basic choice field, trimmed for the client. */
export interface EstimateField {
  key: string;
  label: string;
  dependsOn?: string;
  /** Stage 35 S35-6: visible only while its (basic) controller's chosen value is in `in`. */
  showWhen?: ShowWhen;
}

/** A usable component type, trimmed to what the estimator needs. */
export interface EstimateType {
  id: string;
  code: string;
  name: string;
  unit: EstimateUnit;
  /** Basic dropdown/radio fields, in schema order. */
  basicFields: EstimateField[];
  /** The org's option config, narrowed to the basic fields' keys. */
  options: FieldOptionsConfig;
}

/** The shape of one row of `GET /component-types` that this module reads. */
export interface ComponentTypeInput {
  id: string;
  code: string;
  name: string;
  active: boolean;
  fieldsSchema: FieldEntry[];
  fieldOptionsConfig: FieldOptionsConfig | null;
}

export function unitForCode(code: string): EstimateUnit {
  return code === PARTITION_CODE ? UNIT_AREA : UNIT_PIECE;
}

const CHOICE = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

/**
 * S33-2: a type is usable when it is active and its BASIC fields are fully configured. Quick Estimate is
 * enabled only when a usable type has the code GLASS. Every usable type is offered.
 */
export function usableEstimateTypes(componentTypes: ComponentTypeInput[]): { enabled: boolean; types: EstimateType[] } {
  const types: EstimateType[] = [];
  for (const ct of componentTypes) {
    if (!ct.active) continue;
    const basic = ct.fieldsSchema.filter((f) => f.basic);
    if (!isComponentTypeFullyConfigured(basic, ct.fieldOptionsConfig)) continue;
    const basicFields = basic
      .filter((f) => CHOICE.has(f.type))
      .map((f) => ({
        key: f.key,
        label: f.label,
        ...(f.dependsOn ? { dependsOn: f.dependsOn } : {}),
        ...(f.showWhen ? { showWhen: f.showWhen } : {}),
      }));
    const config = ct.fieldOptionsConfig ?? {};
    const options: FieldOptionsConfig = {};
    for (const f of basicFields) {
      if (config[f.key]) options[f.key] = config[f.key];
    }
    types.push({ id: ct.id, code: ct.code, name: ct.name, unit: unitForCode(ct.code), basicFields, options });
  }
  return { enabled: types.some((t) => t.code === PARTITION_CODE), types };
}

export interface EstimateOption {
  /** The chosen value of each basic field, in order. */
  parts: string[];
  /** The parts joined with " · ". */
  text: string;
  /** Stage 36: the chosen value by field key (only the visible fields). */
  values: Record<string, string>;
}

export const VARIANT_SEPARATOR = " · ";

/**
 * Every combination of the type's basic fields, walking the `dependsOn` chain through the option config.
 * Full variants only (D-9): a type with no basic choice fields yields no options. A branch with no mapped
 * values yields nothing. Stage 35 S35-6: before each field the one visibility pass runs over the choices made so
 * far (the palette only knows basic fields, so a gated field whose controller is not one is never offered); a
 * hidden field adds no part to the combination.
 */
export function buildCombinations(type: EstimateType): EstimateOption[] {
  return generateCombinations(type.basicFields, type.options);
}

/**
 * The generator core (Stage 36 S36-7): same walk for any ordered field list. Quick Estimate passes the basic
 * fields; the Product Pricing page and spec mode pass `specFieldList(...)`. Each option also carries its chosen
 * `values` by field key, the input of `combinationKey`.
 */
export function generateCombinations(fields: EstimateField[], config: FieldOptionsConfig): EstimateOption[] {
  if (fields.length === 0) return [];
  let partials: Record<string, string>[] = [{}];
  for (const field of fields) {
    const entry = config[field.key];
    const next: Record<string, string>[] = [];
    for (const partial of partials) {
      if (!applyFieldVisibility(fields, partial).visibleKeys.has(field.key)) {
        next.push(partial);
        continue;
      }
      let values: string[] = [];
      if (!field.dependsOn) {
        values = entry && "options" in entry ? entry.options : [];
      } else {
        const parent = partial[field.dependsOn];
        values = parent !== undefined && entry && "valueMap" in entry ? (entry.valueMap[parent] ?? []) : [];
      }
      for (const v of values) next.push({ ...partial, [field.key]: v });
    }
    partials = next;
  }
  // A combination with no chosen part (every field hidden) is not an option, same as "no basic choice fields".
  return partials.filter((p) => Object.keys(p).length > 0).map((p) => {
    const parts = fields.filter((f) => p[f.key] !== undefined).map((f) => p[f.key]);
    return { parts, text: parts.join(VARIANT_SEPARATOR), values: p };
  });
}
