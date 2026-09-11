import type { FieldEntry } from "@/lib/types/field-entry";

/**
 * Shared validator for a ComponentType's `fieldsSchema` array — Stage 20 Batch 2.
 *
 * Enforces the two structural rules SuperAdmin authoring must satisfy now that
 * `dependsOn` wiring lives on `fieldsSchema` but option *values* no longer do
 * (see design-docs/04-data-model.md#componenttypeorgconfig, decisions #3/#4/#7
 * in stage-20.md):
 *
 *   1. No entry may carry an `options` key at all, regardless of type or
 *      emptiness — SuperAdmin no longer authors values, full stop. Values live
 *      in the org-owned `ComponentTypeOrgConfig` table instead.
 *   2. `dependsOn` is only valid on `dropdown`/`radio` fields, must name a key
 *      that exists earlier in the same array (not later, not itself — this is
 *      what rules out cycles by construction), and that earlier field must
 *      itself be `dropdown`/`radio` (a `field`/`checkbox` field has no value
 *      list to narrow).
 *
 * Deliberately pure (no `prisma`/`next` imports) so it can be imported both
 * server-side — wired into the SuperAdmin component-types POST/PATCH routes —
 * and client-side, by the create/edit forms' JSON-mode validator and their
 * reorder guard (a move that would put a dependent field before its parent,
 * or a parent before a field that depends on it, is invalid the same way).
 */

const VALID_TYPES = new Set<FieldEntry["type"]>(["field", "radio", "dropdown", "checkbox"]);
const CHOICE_TYPES = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

export type ValidateFieldsSchemaResult = { valid: true } | { valid: false; error: string };

function describeField(f: FieldEntry, index: number): string {
  return f.label || f.key || `#${index + 1}`;
}

export function validateFieldsSchema(fields: FieldEntry[]): ValidateFieldsSchemaResult {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];

    if (!VALID_TYPES.has(f.type)) {
      return { valid: false, error: `Field "${describeField(f, i)}": unknown type "${f.type}".` };
    }

    if (f.options !== undefined) {
      return {
        valid: false,
        error: `Field "${describeField(f, i)}": "options" is no longer accepted here — SuperAdmin authors field shape and dependsOn wiring only. Option values are configured by the org admin on the Catalog screen.`,
      };
    }

    if (f.dependsOn !== undefined && f.dependsOn !== "") {
      if (!CHOICE_TYPES.has(f.type)) {
        return {
          valid: false,
          error: `Field "${describeField(f, i)}": "dependsOn" is only valid on dropdown/radio fields (found type "${f.type}").`,
        };
      }

      const parentIndex = fields.findIndex((other) => other.key === f.dependsOn);
      if (parentIndex === -1) {
        return {
          valid: false,
          error: `Field "${describeField(f, i)}": dependsOn references unknown field key "${f.dependsOn}".`,
        };
      }
      if (parentIndex >= i) {
        return {
          valid: false,
          error: `Field "${describeField(f, i)}": dependsOn must reference a field earlier in the schema — "${f.dependsOn}" is at position ${parentIndex + 1}, this field is at position ${i + 1}.`,
        };
      }
      const parent = fields[parentIndex];
      if (!CHOICE_TYPES.has(parent.type)) {
        return {
          valid: false,
          error: `Field "${describeField(f, i)}": dependsOn target "${f.dependsOn}" must be a dropdown/radio field (found type "${parent.type}").`,
        };
      }
    }
  }

  return { valid: true };
}
