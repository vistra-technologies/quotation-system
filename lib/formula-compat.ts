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

/** Field keys declared in a fieldsSchema JSON value (presence only — `required` is not consulted). */
function schemaKeys(fieldsSchema: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(fieldsSchema)) {
    for (const f of fieldsSchema) if (isRecord(f) && typeof f.key === "string") out.add(f.key);
  }
  return out;
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
