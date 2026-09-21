/**
 * Formula-set compatibility helpers (Stage 23 Batch 3; Batch 6 adds the key-edit guard here).
 *
 * PURE: no Prisma, no lib/data/* imports — plain data in, plain data out, unit-testable.
 *
 * `keysReferencedBySet()` is the ONE definition of "which fieldsSchema keys of a ComponentType does a
 * formula set depend on" (D-36). The creation-time check (13a, below) and Batch 6's key-edit guard must
 * both call it — never re-derive it, so the two can never drift.
 */
import type { ConfigSnapshot } from "./config-snapshot";
import type { FormulaSetBody } from "./summary/types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Keys of the ComponentType `code`'s fieldsSchema that `setBody` references through that code's slot:
 * `requiredParams` keys ∪ `summaryParams` values (D-24, D-36). Empty (never throws) when the set has no
 * slot for `code`. `requiredParams` is `[]` in v1 (D-38); entries may be plain strings or `{ key }`.
 */
export function keysReferencedBySet(setBody: FormulaSetBody | null | undefined, code: string): string[] {
  const slots = isRecord(setBody?.slots) ? setBody.slots : {};
  const slot = Object.prototype.hasOwnProperty.call(slots, code) ? slots[code] : undefined;
  if (!isRecord(slot)) return [];

  const keys = new Set<string>();
  const required: unknown = slot.requiredParams;
  if (Array.isArray(required)) {
    for (const p of required) {
      if (typeof p === "string") keys.add(p);
      else if (isRecord(p) && typeof p.key === "string") keys.add(p.key);
    }
  }
  const summary: unknown = slot.summaryParams;
  if (isRecord(summary)) {
    for (const v of Object.values(summary)) if (typeof v === "string") keys.add(v);
  }
  return [...keys];
}

export interface MissingParam {
  code: string;
  key: string;
}

export type CompatResult =
  | { ok: true }
  | { ok: false; missingCodes: string[]; missingParams: MissingParam[] };

/**
 * Field keys declared in a fieldsSchema JSON value (presence only — `required` is not consulted).
 * Exported (was private through Batch 3) — Batch 6's `removedReferencedKeys()` needs it too; still the
 * one definition.
 */
export function schemaKeys(fieldsSchema: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(fieldsSchema)) {
    for (const f of fieldsSchema) if (isRecord(f) && typeof f.key === "string") out.add(f.key);
  }
  return out;
}

/** The slot for `code` in `setBody`, or `undefined` if there is none (or no body at all). */
export function slotForCode(
  setBody: FormulaSetBody | null | undefined,
  code: string,
): Record<string, unknown> | undefined {
  const slots = isRecord(setBody?.slots) ? setBody.slots : {};
  const slot = Object.prototype.hasOwnProperty.call(slots, code) ? slots[code] : undefined;
  return isRecord(slot) ? slot : undefined;
}

/**
 * 13a — structural compatibility of a formula set with an org's config snapshot: every slot code must
 * exist in `snapshot.componentTypes` AND be `active`, and every key from `keysReferencedBySet()` must be
 * present in that type's fieldsSchema (presence only, not `required: true` — see stage-23.md "Are summary
 * keys required:true?"). A null/undefined/malformed snapshot is reported as incompatible (every slot code
 * missing) rather than throwing. Inactive types are reported under `missingCodes`.
 */
export function checkStructuralCompatibility(
  setBody: FormulaSetBody | null | undefined,
  snapshot: ConfigSnapshot | null | undefined,
): CompatResult {
  const slots = isRecord(setBody?.slots) ? setBody.slots : {};
  const types = Array.isArray(snapshot?.componentTypes) ? snapshot.componentTypes : [];
  const byCode = new Map(types.map((t) => [t.code, t]));

  const missingCodes: string[] = [];
  const missingParams: MissingParam[] = [];

  for (const code of Object.keys(slots)) {
    const type = byCode.get(code);
    if (!type || type.active !== true) {
      missingCodes.push(code);
      continue;
    }
    const present = schemaKeys(type.fieldsSchema);
    for (const key of keysReferencedBySet(setBody, code)) {
      if (!present.has(key)) missingParams.push({ code, key });
    }
  }

  if (missingCodes.length === 0 && missingParams.length === 0) return { ok: true };
  return { ok: false, missingCodes, missingParams };
}

/** Human-readable detail for a 409 body — names codes/keys only (never another org's data). */
export function describeIncompatibility(
  result: Extract<CompatResult, { ok: false }>,
  set: { name: string; version: number },
): string {
  const parts: string[] = [];
  if (result.missingCodes.length > 0) {
    parts.push(`missing or inactive component type(s): ${result.missingCodes.join(", ")}`);
  }
  if (result.missingParams.length > 0) {
    parts.push(`missing field(s): ${result.missingParams.map((p) => `${p.code}.${p.key}`).join(", ")}`);
  }
  return `Formula set ${set.name} v${set.version} is incompatible with this organization's component configuration — ${parts.join("; ")}.`;
}

// ─── Batch 6 — key-edit + type-lifecycle guard (#12/D-36, D-24, D-26) ─────────────────────────────
//
// Pure decision logic only. The Prisma glue (load the org's activeFormulaSet, call these functions, throw
// ComponentTypeGuardError) is duplicated in each of the three verified DAL entry points — see
// stage-23.md's Batch 6 "Verified mutation entry points for ComponentType" table and D-26 (the two edit
// routes share no DAL function). This is the ONE place the guard's *logic* lives.

export interface RemovedKeyInfo {
  key: string;
  /** Whether the disappearing key was referenced as a summary display param or a formula param — every
   * referenced key is a summary param in v1 (D-24), but the distinction is threaded through now so
   * Stage 25 (formula params via requiredParams) needs no change here. */
  paramKind: "summary" | "formula";
}

/**
 * Referenced keys of `code`'s slot (via `keysReferencedBySet()` — never re-derived, D-36) that were
 * present in `oldFieldsSchema` but are missing from `newFieldsSchema`. A key that disappears is
 * removed-or-renamed — indistinguishable from here, and both break the summary the same way. Empty when
 * the set has no slot for `code`, or when no referenced key actually disappeared.
 */
export function removedReferencedKeys(
  setBody: FormulaSetBody | null | undefined,
  code: string,
  oldFieldsSchema: unknown,
  newFieldsSchema: unknown,
): RemovedKeyInfo[] {
  const slot = slotForCode(setBody, code);
  if (!slot) return [];
  const referenced = keysReferencedBySet(setBody, code);
  if (referenced.length === 0) return [];

  const oldKeys = schemaKeys(oldFieldsSchema);
  const newKeys = schemaKeys(newFieldsSchema);
  const summaryValues = new Set(
    isRecord(slot.summaryParams)
      ? Object.values(slot.summaryParams).filter((v): v is string => typeof v === "string")
      : [],
  );

  return referenced
    .filter((key) => oldKeys.has(key) && !newKeys.has(key))
    .map((key) => ({ key, paramKind: summaryValues.has(key) ? ("summary" as const) : ("formula" as const) }));
}

export type ComponentTypeGuardViolation =
  | { kind: "KEY_REMOVED"; code: string; key: string; paramKind: "summary" | "formula" }
  | { kind: "CODE_CHANGED"; oldCode: string; newCode: string }
  | { kind: "DEACTIVATED"; code: string }
  | { kind: "DELETED"; code: string };

export type ComponentTypeGuardResult = { ok: true } | { ok: false; violation: ComponentTypeGuardViolation };

export interface ComponentTypeGuardCheck {
  /** The type's current (pre-patch) `code`. */
  code: string;
  /** The type's current (pre-patch) `fieldsSchema` JSON value. Unused (may be omitted) when `isDelete`. */
  fieldsSchema?: unknown;
  /** Fields actually present in this patch — omit a key entirely if it isn't part of the patch. */
  patch?: { code?: string; fieldsSchema?: unknown; active?: boolean };
  /** True when this check guards a delete rather than a PATCH — `patch` is ignored in that case. */
  isDelete?: boolean;
}

/**
 * The guard decision (#12, widened by D-36): for the org's **currently assigned** formula set only, block
 * an edit or delete of a ComponentType that the set depends on as a slot. `setBody` should be the org's
 * `activeFormulaSet.body`, or `null`/`undefined` if the org has none — either way, no slot for `code`
 * (including "no set at all") always allows.
 *
 * Deliberately does NOT block (see stage-23.md Batch 6 "Deliberate NON-blocks", documented here too so the
 * omission reads as intentional to a future reader): editing a field's `label`/`hint`/`options`/`type`/
 * `required`/`dependsOn`; `ComponentTypeOrgConfig` option-**value** edits (a separate write path,
 * `setComponentTypeOrgConfig()` — never routed through this guard); adding a new field; reordering
 * (`sortOrder` only); renaming the type's `name` or changing its `categoryId`.
 */
export function checkComponentTypeGuard(
  setBody: FormulaSetBody | null | undefined,
  check: ComponentTypeGuardCheck,
): ComponentTypeGuardResult {
  const slot = slotForCode(setBody, check.code);
  if (!slot) return { ok: true };

  if (check.isDelete) {
    return { ok: false, violation: { kind: "DELETED", code: check.code } };
  }

  const patch = check.patch ?? {};

  // Case 2 — code change. Checked against the OLD code (the slot key the set currently depends on).
  if (patch.code !== undefined && patch.code !== check.code) {
    return { ok: false, violation: { kind: "CODE_CHANGED", oldCode: check.code, newCode: patch.code } };
  }

  // Case 3 — deactivation. 13a requires slot types to be active, so a deactivation would 409 every
  // subsequent project creation for this org — refuse it up front and say why.
  if (patch.active === false) {
    return { ok: false, violation: { kind: "DEACTIVATED", code: check.code } };
  }

  // Case 1 — a referenced fieldsSchema key removed or renamed. Only meaningful when fieldsSchema is
  // actually part of this patch.
  if (patch.fieldsSchema !== undefined) {
    const removed = removedReferencedKeys(setBody, check.code, check.fieldsSchema, patch.fieldsSchema);
    if (removed.length > 0) {
      const first = removed[0];
      return {
        ok: false,
        violation: { kind: "KEY_REMOVED", code: check.code, key: first.key, paramKind: first.paramKind },
      };
    }
  }

  return { ok: true };
}

/** Human-readable 409 detail — names the set, its version, the slot (component type code) and, for a
 * removed key, the parameter and whether it was a summary or formula param. Never another org's data. */
export function describeGuardViolation(
  violation: ComponentTypeGuardViolation,
  set: { name: string; version: number },
): string {
  const setRef = `${set.name} v${set.version}`;
  switch (violation.kind) {
    case "KEY_REMOVED":
      return (
        `Cannot remove or rename field "${violation.key}" on component type ${violation.code} — it is a ` +
        `${violation.paramKind} parameter referenced by slot "${violation.code}" in formula set ${setRef}, ` +
        `currently assigned to this organization.`
      );
    case "CODE_CHANGED":
      return (
        `Cannot change the code of component type ${violation.oldCode} to ${violation.newCode} — it is ` +
        `slot "${violation.oldCode}" in formula set ${setRef}, currently assigned to this organization.`
      );
    case "DEACTIVATED":
      return (
        `Cannot deactivate component type ${violation.code} — it is slot "${violation.code}" in formula ` +
        `set ${setRef}, currently assigned to this organization.`
      );
    case "DELETED":
      return (
        `Cannot delete component type ${violation.code} — it is slot "${violation.code}" in formula set ` +
        `${setRef}, currently assigned to this organization.`
      );
  }
}

/** Typed error thrown by the three DAL entry points' guard checks — routes map it to 409. */
export class ComponentTypeGuardError extends Error {
  constructor(
    public readonly violation: ComponentTypeGuardViolation,
    message: string,
  ) {
    super(message);
    this.name = "ComponentTypeGuardError";
  }
}
