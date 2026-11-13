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
 *   2. (Stage 35: `showWhen` / `inventoryLinked` rules are enforced at the end of the per-entry loop below.)
 *   3. `dependsOn` is only valid on `dropdown`/`radio` fields, must name a key
 *      that exists earlier in the same array (not later, not itself — this is
 *      what rules out cycles by construction), and that earlier field must
 *      itself be `dropdown`/`radio` (a `field`/`checkbox` field has no value
 *      list to narrow).
 *
 * Also enforces that every `key` in the array is unique (review-B2 MINOR #3)
 * — otherwise the `dependsOn` lookup below silently resolves to the *first*
 * matching key, which can falsely reject a valid reference today and would
 * silently collide with Batch 3's `fieldOptionsConfig` keying (also keyed by
 * field key) later.
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
  // review-B2 MINOR #3: duplicate keys make the dependsOn lookup below
  // ambiguous (findIndex silently picks the first match) — reject up front,
  // one pass, before the per-entry loop needs a well-defined key→index map.
  const seenKeys = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (typeof f !== "object" || f === null) continue; // caught by the shape check below
    if (f.key && seenKeys.has(f.key)) {
      return {
        valid: false,
        error: `Field "${describeField(f, i)}": key "${f.key}" is used by more than one field — keys must be unique within a ComponentType's schema.`,
      };
    }
    if (f.key) seenKeys.add(f.key);
  }

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];

    // review-B2 MINOR #2: a malformed entry (e.g. `null`, a bare string) must
    // be a normal validation failure, not an uncaught TypeError reading `.type`
    // off a non-object — that surfaced as a 500 from the API routes.
    if (typeof f !== "object" || f === null) {
      return { valid: false, error: `Field #${i + 1}: each entry must be an object.` };
    }

    if (!VALID_TYPES.has(f.type)) {
      return { valid: false, error: `Field "${describeField(f, i)}": unknown type "${f.type}".` };
    }

    if ((f as { options?: unknown }).options !== undefined) {
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

    // Stage 35 S35-2 / G0-a: showWhen is exactly { field, in[] } — one controller, no AND/OR.
    if (f.showWhen !== undefined) {
      const sw = f.showWhen as unknown;
      const name = describeField(f, i);
      if (typeof sw !== "object" || sw === null || Array.isArray(sw)) {
        return { valid: false, error: `Field "${name}": "showWhen" must be an object { field, in }.` };
      }
      const extra = Object.keys(sw).filter((k) => k !== "field" && k !== "in");
      if (extra.length > 0) {
        return {
          valid: false,
          error: `Field "${name}": "showWhen" takes exactly one controller as { field, in } — unexpected key "${extra[0]}".`,
        };
      }
      const { field: controller, in: values } = sw as { field?: unknown; in?: unknown };
      if (typeof controller !== "string" || controller === "") {
        return { valid: false, error: `Field "${name}": showWhen.field must be a non-empty field key.` };
      }
      if (controller === f.key) {
        return { valid: false, error: `Field "${name}": showWhen cannot reference the field itself.` };
      }
      const controllerIndex = fields.findIndex((other) => other.key === controller);
      if (controllerIndex === -1) {
        return { valid: false, error: `Field "${name}": showWhen references unknown field key "${controller}".` };
      }
      if (controllerIndex >= i) {
        return {
          valid: false,
          error: `Field "${name}": showWhen must reference a field earlier in the schema — "${controller}" is at position ${controllerIndex + 1}, this field is at position ${i + 1}.`,
        };
      }
      if (!CHOICE_TYPES.has(fields[controllerIndex].type)) {
        return {
          valid: false,
          error: `Field "${name}": showWhen controller "${controller}" must be a dropdown/radio field (found type "${fields[controllerIndex].type}").`,
        };
      }
      if (!Array.isArray(values) || values.length === 0) {
        return { valid: false, error: `Field "${name}": showWhen.in must be a non-empty array of values.` };
      }
      if (!values.every((v) => typeof v === "string" && v !== "")) {
        return { valid: false, error: `Field "${name}": showWhen.in must contain only non-empty strings.` };
      }
      if (new Set(values as string[]).size !== values.length) {
        return { valid: false, error: `Field "${name}": showWhen.in must not contain duplicate values.` };
      }
    }

    // Stage 35 S35-2: inventoryLinked only on dropdown/radio. `false` is allowed (stored absent).
    if (f.inventoryLinked !== undefined) {
      if (typeof f.inventoryLinked !== "boolean") {
        return { valid: false, error: `Field "${describeField(f, i)}": "inventoryLinked" must be a boolean.` };
      }
      if (f.inventoryLinked && !CHOICE_TYPES.has(f.type)) {
        return {
          valid: false,
          error: `Field "${describeField(f, i)}": "inventoryLinked" is only valid on dropdown/radio fields (found type "${f.type}").`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Stage 31 S31-8: the single server-side write gate for a ComponentType `fieldsSchema`, used by all four
 * component-type write routes (SuperAdmin POST/PATCH and org POST/PATCH). Rejects any `options` key
 * (Stage 20: option values live in ComponentTypeOrgConfig, never in fieldsSchema) and enforces the
 * structural rules above. `validateFieldsSchema` already rejects `options`, so this is that validator
 * under one name; it exists so the routes share one call and the rule has one definition.
 */
export function checkFieldsSchemaForWrite(raw: FieldEntry[]): ValidateFieldsSchemaResult {
  return validateFieldsSchema(raw);
}

/**
 * Clears `dependsOn` on every field that currently points at `key` — used by
 * the create/edit forms whenever an authoring action invalidates that
 * reference (review-B2 IMPORTANT #1): removing the parent's row, changing the
 * parent's type away from `dropdown`/`radio`, or renaming the parent's `key`.
 * Without this, a child field is left silently pointing at a stale/missing
 * key — invisible in the UI (the controlled `<select>` just renders as "None"
 * with no matching `<option>`) until Save throws a page-level error.
 *
 * Single-level only (clears direct children of `key`), which is sufficient:
 * a grandchild's `dependsOn` targets its own direct parent's key, which is
 * unaffected unless that parent is also being removed/retyped/renamed in the
 * same edit — each such action calls this once against the field it invalidates.
 */
export function clearDependentsOf(fields: FieldEntry[], key: string): FieldEntry[] {
  if (!key) return fields;
  return fields.map((f) => {
    let next = f;
    if (next.dependsOn === key) next = { ...next, dependsOn: undefined };
    // Stage 35 S35-2: a showWhen whose controller is removed/renamed/retyped is cleared the same way.
    if (next.showWhen?.field === key) next = { ...next, showWhen: undefined };
    return next;
  });
}

/**
 * Stage 35 (review-b2-1 MINOR 2): retype a field in the SuperAdmin forms. `dependsOn` and `inventoryLinked`
 * only make sense on dropdown/radio, so switching to another type drops them (a stale `inventoryLinked: true`
 * on a text field would otherwise 400 on Save). `showWhen` is allowed on any type and stays.
 */
export function applyFieldTypeChange(entry: FieldEntry, newType: FieldEntry["type"]): FieldEntry {
  const updated: FieldEntry = { ...entry, type: newType };
  if (newType !== "dropdown" && newType !== "radio") {
    delete updated.dependsOn;
    delete updated.inventoryLinked;
  }
  return updated;
}

/**
 * Stage 35 S35-1: `inventoryLinked: false` is stored absent. Applied at the data-layer write sites
 * (after `checkFieldsSchemaForWrite`); everything else is stored as authored.
 */
export function normalizeFieldsSchemaForStore<T extends FieldEntry>(fields: T[]): T[] {
  return fields.map((f) => {
    if (f.inventoryLinked !== false) return f;
    const rest = { ...f };
    delete rest.inventoryLinked;
    return rest;
  });
}
