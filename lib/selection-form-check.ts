import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { applyFieldVisibility } from "@/lib/field-visibility";
import { resolveOptions } from "@/lib/configurator-gating";

/**
 * Stage 35 S35-4 (form side) — pure checks for the Configuration form, so the rules are unit-testable
 * and the form stays thin. Visibility comes from the one module (`applyFieldVisibility`); nothing here
 * re-implements it.
 */

type Values = Record<string, string | boolean>;

/** The values the form may submit: hidden keys removed (the saved `config` never holds one). */
export function visibleSelectionValues(fields: FieldEntry[], values: Values): Values {
  return applyFieldVisibility(fields, values).values;
}

/**
 * First reason the form must refuse to save, or null. Visible fields only, in schema order:
 *  - a visible dropdown/radio whose resolved options are empty -> "No values configured for <label>"
 *    (not for a dependent field whose parent has no value yet: its options are empty only because
 *    the parent is blank, which is today's allowed state);
 *  - a visible required field left empty -> `"<label>" is required.` (as before).
 */
export function firstSelectionFormIssue(
  fields: FieldEntry[],
  values: Values,
  fieldOptionsConfig: FieldOptionsConfig | null,
): string | null {
  const { visibleKeys, values: clean } = applyFieldVisibility(fields, values);
  for (const field of fields) {
    if (!visibleKeys.has(field.key)) continue;
    const name = field.label || field.key;
    const isChoice = field.type === "dropdown" || field.type === "radio";
    if (isChoice) {
      const parentValue = field.dependsOn ? clean[field.dependsOn] : undefined;
      const parentBlank = Boolean(field.dependsOn) && (typeof parentValue !== "string" || parentValue === "");
      if (!parentBlank && resolveOptions(field, clean, fieldOptionsConfig).length === 0) {
        return `No values configured for ${name}`;
      }
    }
    if (!field.required) continue;
    const val = clean[field.key];
    const isEmpty = val === undefined || val === "" || (field.type === "checkbox" && val === false);
    if (isEmpty) return `"${name}" is required.`;
  }
  return null;
}
