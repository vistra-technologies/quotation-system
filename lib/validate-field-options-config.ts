import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig, FieldOptionsEntry } from "@/lib/types/field-options-config";

/**
 * Shared validator for a ComponentType's `fieldOptionsConfig` payload — Stage 20 Batch 3.
 *
 * This is the org-admin-side counterpart to `lib/validate-fields-schema.ts` (Batch 2, which
 * validates SuperAdmin's `fieldsSchema` shape/dependsOn wiring). This validator guards the
 * *values* org admins submit from the Catalog screen, checked against the ComponentType's
 * current `fieldsSchema`:
 *
 *   1. Every key in the payload must exist in `fieldsSchema`.
 *   2. Only `dropdown`/`radio` fields may carry an entry — a `field`/`checkbox` field has no
 *      value list to configure.
 *   3. Shape must match the field's `dependsOn`-ness: a field with `dependsOn` set on
 *      `fieldsSchema` must submit `{ valueMap: Record<string, string[]> }`; a field with no
 *      `dependsOn` must submit `{ options: string[] }`. Submitting the wrong shape is rejected.
 *   4. **`dependsOn` may never appear in a submitted entry** — wiring is SuperAdmin-owned and
 *      read-only on this screen by construction (decision #3 in stage-20.md). The parsed entry
 *      shape (`{ options }` / `{ valueMap }`) has no natural slot for it, so this only fires
 *      against a hand-rolled payload — defense in depth, not a UI affordance.
 *   5. All values must be strings; empty strings are dropped (same leniency as
 *      `parseFieldOptionsConfig` in `lib/data/components.ts`).
 *   6. A dependent field's `valueMap` keys must each name one of its parent field's currently
 *      submitted values (checked only when the parent's own entry is present in the same
 *      payload — review-B3 MINOR #2).
 *
 * Deliberately pure (no `prisma`/`next` imports) — imported server-side only for now (the PUT
 * route), but kept dependency-free in case a future client-side pre-check wants it too, same
 * class of file as `lib/validate-fields-schema.ts`.
 */

const CHOICE_TYPES = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

export type ValidateFieldOptionsConfigResult =
  | { valid: true; parsed: FieldOptionsConfig }
  | { valid: false; error: string };

export function validateFieldOptionsConfig(
  fieldsSchema: FieldEntry[],
  payload: Record<string, unknown>,
): ValidateFieldOptionsConfigResult {
  const byKey = new Map(fieldsSchema.map((f) => [f.key, f]));
  const parsed: FieldOptionsConfig = {};

  for (const [key, rawEntry] of Object.entries(payload)) {
    const field = byKey.get(key);
    if (!field) {
      return {
        valid: false,
        error: `Unknown field key "${key}" — not present in this ComponentType's fieldsSchema.`,
      };
    }
    if (!CHOICE_TYPES.has(field.type)) {
      return {
        valid: false,
        error: `Field "${key}" is type "${field.type}" — only dropdown/radio fields accept configured values.`,
      };
    }
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      return { valid: false, error: `Field "${key}": entry must be an object.` };
    }
    const entry = rawEntry as Record<string, unknown>;

    if ("dependsOn" in entry) {
      return {
        valid: false,
        error: `Field "${key}": "dependsOn" cannot be set from this endpoint — the dependency wiring is authored by SuperAdmin only.`,
      };
    }

    const hasDependsOn = Boolean(field.dependsOn);
    let parsedEntry: FieldOptionsEntry;

    if (hasDependsOn) {
      if (
        !("valueMap" in entry) ||
        typeof entry.valueMap !== "object" ||
        entry.valueMap === null ||
        Array.isArray(entry.valueMap)
      ) {
        return {
          valid: false,
          error: `Field "${key}" depends on "${field.dependsOn}" — expected a "valueMap" object keyed by the parent field's values.`,
        };
      }
      const valueMap: Record<string, string[]> = {};
      for (const [parentVal, vals] of Object.entries(entry.valueMap as Record<string, unknown>)) {
        if (!Array.isArray(vals) || !vals.every((v) => typeof v === "string")) {
          return {
            valid: false,
            error: `Field "${key}": valueMap["${parentVal}"] must be an array of strings.`,
          };
        }
        valueMap[parentVal] = (vals as string[]).map((v) => v.trim()).filter(Boolean);
      }
      parsedEntry = { valueMap };
    } else {
      if (
        !("options" in entry) ||
        !Array.isArray(entry.options) ||
        !entry.options.every((v) => typeof v === "string")
      ) {
        return {
          valid: false,
          error: `Field "${key}": expected an "options" array of strings.`,
        };
      }
      parsedEntry = {
        options: (entry.options as string[]).map((v) => v.trim()).filter(Boolean),
      };
    }

    parsed[key] = parsedEntry;
  }

  // review-B3 MINOR #2: cross-check that every valueMap key actually names one of the parent
  // field's currently-submitted values — the design doc's "one value-list per parent value"
  // otherwise isn't enforced (any string key would be silently accepted). Only checked when the
  // parent's own entry is present in this same payload (a whole-blob PUT always includes it in
  // practice — the editor submits every choice field together); a payload that omits the parent
  // entirely skips this check rather than rejecting on incomplete information.
  for (const [key, entry] of Object.entries(parsed)) {
    if (!("valueMap" in entry)) continue;
    const field = byKey.get(key);
    const parentKey = field?.dependsOn;
    if (!parentKey) continue;
    const parentEntry = parsed[parentKey];
    if (!parentEntry) continue;
    const allowedParentValues =
      "options" in parentEntry
        ? parentEntry.options
        : [...new Set(Object.values(parentEntry.valueMap).flat())];
    for (const parentVal of Object.keys(entry.valueMap)) {
      if (!allowedParentValues.includes(parentVal)) {
        return {
          valid: false,
          error: `Field "${key}": valueMap key "${parentVal}" is not one of "${parentKey}"'s currently configured values.`,
        };
      }
    }
  }

  return { valid: true, parsed };
}
