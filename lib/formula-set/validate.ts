/**
 * Publish-time validator for FormulaSetBody documents (Stage 24 Batch 2).
 *
 * PURE: no Prisma, no lib/data/* imports — plain data in, plain result out, unit-testable.
 * Implements formula-engine.md §6 exactly.
 */
import { Parser } from "expr-eval";

const parser = new Parser();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Implemented grains — ROOM_SIDE and ROOM_JUNCTION are defined but not built (formula-engine.md §3). */
const IMPLEMENTED_GRAINS = new Set(["CELL", "PARTITION"]);
const ALL_GRAINS = new Set(["CELL", "PARTITION", "ROOM_SIDE", "ROOM_JUNCTION"]);
const VALID_UNITS = new Set(["metres", "pieces"]);

/** /^[a-z][A-Za-z0-9]*$/ — camelCase starting with lowercase. */
const CAMEL_CASE_RE = /^[a-z][A-Za-z0-9]*$/;

/** Extract all `param.<key>` tokens from an expression string. */
function extractParamRefs(expr: string): string[] {
  const refs: string[] = [];
  const re = /\bparam\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) refs.push(m[1]);
  return refs;
}

/** Extract all `calc.<id>` tokens from an expression string. */
function extractCalcRefs(expr: string): string[] {
  const refs: string[] = [];
  const re = /\bcalc\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) refs.push(m[1]);
  return refs;
}

/** Try to parse an expression with expr-eval; return an error string on failure, null on success. */
function tryParse(expr: string): string | null {
  try {
    parser.parse(expr);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Validate a FormulaSetBody document.
 *
 * v1 (schemaVersion absent or 1): validates that formulas is absent or [], and that any
 * requiredParams entries are objects with a `key` string or bare strings. The Stage 23 seeded
 * document must always pass this path.
 *
 * v2 (schemaVersion: 2): runs full hygiene checks + Validator 1 (declared params) +
 * Validator 2 (backward/same-grain calc references). Every error names the formula id and
 * offending token.
 */
export function validateFormulaSetBody(body: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["body must be a non-null object"] };
  }

  // ── schemaVersion ─────────────────────────────────────────────────────────────────────────────
  const rawVersion = (body as Record<string, unknown>).schemaVersion;
  if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) {
    errors.push(`schemaVersion must be 1, 2, or absent; got ${JSON.stringify(rawVersion)}`);
    return { ok: false, errors };
  }
  const schemaVersion: 1 | 2 = rawVersion === 2 ? 2 : 1;

  // ── slots (required in both versions) ─────────────────────────────────────────────────────────
  if (!isRecord(body.slots)) {
    errors.push("slots must be a non-null object");
    return { ok: false, errors };
  }
  const slots = body.slots as Record<string, unknown>;

  // ── v1 path ───────────────────────────────────────────────────────────────────────────────────
  if (schemaVersion === 1) {
    // formulas must be absent or []
    if (body.formulas !== undefined) {
      if (!Array.isArray(body.formulas) || body.formulas.length > 0) {
        errors.push("v1 document must have formulas: [] or no formulas key");
      }
    }

    // validate slots: each must have a role string; requiredParams entries must be { key: string } or string
    for (const [code, slot] of Object.entries(slots)) {
      if (!isRecord(slot)) {
        errors.push(`slot "${code}" must be an object`);
        continue;
      }
      if (typeof (slot as Record<string, unknown>).role !== "string") {
        errors.push(`slot "${code}" must have a string role`);
      }
      const rp = (slot as Record<string, unknown>).requiredParams;
      if (rp !== undefined) {
        if (!Array.isArray(rp)) {
          errors.push(`slot "${code}".requiredParams must be an array`);
        } else {
          for (const entry of rp as unknown[]) {
            if (typeof entry !== "string" && !(isRecord(entry) && typeof (entry as Record<string, unknown>).key === "string")) {
              errors.push(`slot "${code}".requiredParams entries must be strings or { key: string }`);
            }
          }
        }
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  // ── v2 path ───────────────────────────────────────────────────────────────────────────────────

  // slots: same basic checks as v1
  for (const [code, slot] of Object.entries(slots)) {
    if (!isRecord(slot)) {
      errors.push(`slot "${code}" must be an object`);
      continue;
    }
    if (typeof (slot as Record<string, unknown>).role !== "string") {
      errors.push(`slot "${code}" must have a string role`);
    }
  }

  // formulas array
  if (body.formulas !== undefined && !Array.isArray(body.formulas)) {
    errors.push("formulas must be an array");
    return { ok: false, errors };
  }
  const formulas: unknown[] = Array.isArray(body.formulas) ? (body.formulas as unknown[]) : [];

  // Build maps for Validator 2 — track id → index and grain for backward/same-grain check
  const idToIndex = new Map<string, number>();
  const idToGrain = new Map<string, string>();
  const seenIds = new Set<string>();

  // Build requiredParams lookup per slot
  const slotRequiredParams = new Map<string, Set<string>>();
  for (const [code, slotVal] of Object.entries(slots)) {
    if (!isRecord(slotVal)) continue;
    const rp = (slotVal as Record<string, unknown>).requiredParams;
    const keys = new Set<string>();
    if (Array.isArray(rp)) {
      for (const entry of rp as unknown[]) {
        if (typeof entry === "string") keys.add(entry);
        else if (isRecord(entry) && typeof (entry as Record<string, unknown>).key === "string") {
          keys.add((entry as Record<string, unknown>).key as string);
        }
      }
    }
    slotRequiredParams.set(code, keys);
  }

  for (let i = 0; i < formulas.length; i++) {
    const f = formulas[i];
    if (!isRecord(f)) {
      errors.push(`formula[${i}] must be an object`);
      continue;
    }
    const fRec = f as Record<string, unknown>;
    const id = typeof fRec.id === "string" ? fRec.id : `[${i}]`;

    // id: unique and camelCase
    if (typeof fRec.id !== "string") {
      errors.push(`formula[${i}].id must be a string`);
    } else {
      if (!CAMEL_CASE_RE.test(fRec.id)) {
        errors.push(`formula "${id}": id must be camelCase (got "${fRec.id}")`);
      }
      if (seenIds.has(fRec.id)) {
        errors.push(`formula "${id}": duplicate id`);
      }
      seenIds.add(fRec.id);
    }

    // slot must exist in slots
    if (typeof fRec.slot !== "string" || !Object.prototype.hasOwnProperty.call(slots, fRec.slot)) {
      errors.push(`formula "${id}": slot "${fRec.slot}" does not exist in slots`);
    }

    // grain
    if (typeof fRec.grain !== "string" || !ALL_GRAINS.has(fRec.grain)) {
      errors.push(`formula "${id}": grain must be one of CELL, PARTITION, ROOM_SIDE, ROOM_JUNCTION`);
    } else if (!IMPLEMENTED_GRAINS.has(fRec.grain)) {
      errors.push(`formula "${id}": grain "${fRec.grain}" is not yet implemented`);
    }

    // unit
    if (typeof fRec.unit !== "string" || !VALID_UNITS.has(fRec.unit)) {
      errors.push(`formula "${id}": unit must be "metres" or "pieces" (got "${fRec.unit}")`);
    }

    // condition (optional) — parse
    if (fRec.condition !== undefined) {
      if (typeof fRec.condition !== "string") {
        errors.push(`formula "${id}": condition must be a string`);
      } else {
        const parseErr = tryParse(fRec.condition);
        if (parseErr) errors.push(`formula "${id}": condition is not a valid expression: ${parseErr}`);
      }
    }

    // quantity — required, parse
    if (typeof fRec.quantity !== "string") {
      errors.push(`formula "${id}": quantity must be a string expression`);
    } else {
      const parseErr = tryParse(fRec.quantity);
      if (parseErr) errors.push(`formula "${id}": quantity is not a valid expression: ${parseErr}`);
    }

    // materialCode — required string (plain substitution, not parsed)
    if (typeof fRec.materialCode !== "string") {
      errors.push(`formula "${id}": materialCode must be a string`);
    }

    // ── grain namespace checks ────────────────────────────────────────────────────────────────
    // cell.* must not appear in PARTITION-grain formulas; partition.* must not appear in CELL-grain.
    // materialCode is plain string substitution (not expr-eval), so a stale namespace token there
    // produces a literal code that surfaces as UNRESOLVED_CODE at runtime — intentionally out of
    // scope for this namespace check per formula-engine.md §6 ("expression references").
    const grain = typeof fRec.grain === "string" ? fRec.grain : "";
    const exprsToScan: string[] = [];
    if (typeof fRec.condition === "string") exprsToScan.push(fRec.condition);
    if (typeof fRec.quantity === "string") exprsToScan.push(fRec.quantity);

    if (grain === "PARTITION") {
      for (const expr of exprsToScan) {
        if (/\bcell\./.test(expr)) {
          errors.push(`formula "${id}": PARTITION-grain formula must not reference cell.* (in expression)`);
        }
      }
    }
    if (grain === "CELL") {
      for (const expr of exprsToScan) {
        if (/\bpartition\./.test(expr)) {
          errors.push(`formula "${id}": CELL-grain formula must not reference partition.* (in expression)`);
        }
      }
    }

    // ── Validator 1 — every param.* is declared in slot.requiredParams ────────────────────────
    const slotCode = typeof fRec.slot === "string" ? fRec.slot : "";
    const declaredParams = slotRequiredParams.get(slotCode) ?? new Set<string>();

    const allParamExprs: string[] = [];
    if (typeof fRec.condition === "string") allParamExprs.push(fRec.condition);
    if (typeof fRec.quantity === "string") allParamExprs.push(fRec.quantity);
    if (typeof fRec.materialCode === "string") allParamExprs.push(fRec.materialCode);

    for (const expr of allParamExprs) {
      for (const key of extractParamRefs(expr)) {
        if (!declaredParams.has(key)) {
          errors.push(`formula "${id}": param.${key} is not declared in slots.${slotCode}.requiredParams`);
        }
      }
    }

    // ── Validator 2 — calc.* references resolve backwards at same grain ───────────────────────
    // NOTE: idToIndex/idToGrain registration for this formula happens *after* this scan so that
    // a formula whose own condition/quantity references calc.<its own id> is correctly rejected as
    // "forward reference or unknown formula id" (a self-reference is not a prior formula).
    const calcExprs: string[] = [];
    if (typeof fRec.condition === "string") calcExprs.push(fRec.condition);
    if (typeof fRec.quantity === "string") calcExprs.push(fRec.quantity);

    for (const expr of calcExprs) {
      for (const refId of extractCalcRefs(expr)) {
        if (!idToIndex.has(refId)) {
          // forward reference, self-reference, or unknown id — all rejected
          errors.push(`formula "${id}": calc.${refId} is a forward reference or unknown formula id`);
        } else {
          const refGrain = idToGrain.get(refId);
          if (refGrain !== grain) {
            errors.push(`formula "${id}": calc.${refId} is a cross-grain reference (this grain: ${grain}, ref grain: ${refGrain})`);
          }
        }
      }
    }

    // Register this formula's id/grain only after its own calc.* references have been validated,
    // ensuring backward-only references are enforced and self-references are caught above.
    if (typeof fRec.id === "string" && typeof fRec.grain === "string" && IMPLEMENTED_GRAINS.has(fRec.grain)) {
      idToIndex.set(fRec.id, i);
      idToGrain.set(fRec.id, fRec.grain);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
