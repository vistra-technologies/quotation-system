import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { resolveOptions } from "@/lib/configurator-gating";

/**
 * Pure validator for `Selection.config` values — Stage 31 S31-7.
 *
 * Deliberately dependency-free (no `prisma`/`next` imports), the same class of file as
 * `lib/configurator-gating.ts`. The DAL (`lib/data/selections.ts`) calls it on create and on a config
 * update, handing it the project's frozen `configSnapshot` type (or the live type when there is no
 * snapshot).
 *
 * Rules:
 *  - a key that is not in `fieldsSchema` is rejected;
 *  - a dropdown/radio value must be in the field's configured `options`; a dependent field's value must
 *    be in `valueMap[parentValue]`; a child set while its parent is blank is rejected;
 *  - `null` / `""` is always allowed (blank);
 *  - `required` is NOT enforced here (Submit Design's MISSING_PARAM gate owns it);
 *  - non-choice (field / checkbox) values are not type-checked in this stage.
 */

export type ValidateSelectionConfigResult = { ok: true } | { ok: false; key: string; error: string };

const CHOICE_TYPES = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

const isBlank = (v: unknown) => v === null || v === undefined || v === "";

export function validateSelectionConfig(
  fieldsSchema: FieldEntry[],
  fieldOptionsConfig: FieldOptionsConfig | null,
  config: Record<string, string | boolean | number | null>,
): ValidateSelectionConfigResult {
  const byKey = new Map(fieldsSchema.map((f) => [f.key, f]));
  const cfg = fieldOptionsConfig ?? {};

  for (const [key, value] of Object.entries(config)) {
    const field = byKey.get(key);
    if (!field) {
      return { ok: false, key, error: `Unknown configuration field "${key}".` };
    }
    if (isBlank(value) || !CHOICE_TYPES.has(field.type)) continue;

    if (field.dependsOn && isBlank(config[field.dependsOn])) {
      return { ok: false, key, error: `"${key}" cannot be set while "${field.dependsOn}" is blank.` };
    }
    // One copy of the allowed-values rule: the same resolver the Configuration form uses for its dropdowns.
    const allowed = resolveOptions(field, config as Record<string, string | boolean>, cfg);
    if (typeof value !== "string" || !allowed.includes(value)) {
      return { ok: false, key, error: `"${key}" has a value that is not one of its configured options.` };
    }
  }
  return { ok: true };
}
