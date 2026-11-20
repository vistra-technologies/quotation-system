/**
 * Stage 37 Batch 2: Matches rows on an InventoryItem (`InventoryItem.attributes`, Q-D26 / Q-D27).
 *
 * A Matches row is `fieldKey -> value` against the item's ComponentType schema. The stored shape is a plain
 * JSON object of string values (`{ "glassType": "ID1", "thickness": "12.76" }`). Anything else (an array, a
 * scalar, a non-string value) is "no rows": legacy free-form blobs never become a match.
 *
 * PURE and client-safe: type-only imports plus `producibleValues` from `lib/inventory-link` (itself pure).
 * One canonical-value function (`canonicalMatchValue`) is shared by the engine's matcher and the save checks,
 * so a stored row and a Selection value are always compared in the same form (S37-1).
 */
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { producibleValues } from "@/lib/inventory-link";

export type MatchRows = Record<string, string>;
export type MatchField = Pick<FieldEntry, "key" | "type" | "dependsOn">;

const CHOICE_TYPES = new Set(["dropdown", "radio"]);
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The one canonical string form of a value for matching, or null when the value cannot take part in a match
 * (blank, wrong shape). Choice (dropdown/radio): verbatim. Checkbox: boolean true/false (Selection config) or the
 * words "Yes"/"No" -> "Yes"/"No". Free text (`field`): trimmed; a plain decimal is written `String(Number(x))`
 * (so `12.760` becomes `12.76`), anything else stays the trimmed text.
 */
export function canonicalMatchValue(raw: unknown, fieldType: string): string | null {
  if (fieldType === "checkbox") {
    if (raw === true || raw === "Yes") return "Yes";
    if (raw === false || raw === "No") return "No";
    return null;
  }
  if (CHOICE_TYPES.has(fieldType)) {
    return typeof raw === "string" && raw !== "" ? raw : null;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t === "") return null;
  return PLAIN_DECIMAL.test(t) ? String(Number(t)) : t;
}

/** The Matches rows of a stored `attributes` blob; anything that is not an object of strings is "no rows". */
export function readMatchRows(attributes: unknown): MatchRows {
  if (!isRecord(attributes)) return {};
  const rows: MatchRows = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (typeof v !== "string") return {};
    rows[k] = v;
  }
  return rows;
}

export type MatchRowProblem =
  | "FIELD_REMOVED"
  | "VALUE_NOT_OFFERED"
  | "EMPTY"
  | "NOT_CANONICAL"
  | "NOT_BOOLEAN_WORD";

export interface CheckedMatchRow {
  key: string;
  value: string;
  problem: MatchRowProblem | null;
}

/** Per-row check against the LIVE schema and the org's options (S37-6). One code path for save and stale flags. */
export function checkMatchRows(
  rows: ReadonlyArray<{ key: string; value: string }>,
  liveFields: ReadonlyArray<MatchField>,
  fieldOptionsConfig: FieldOptionsConfig | null,
): CheckedMatchRow[] {
  const byKey = new Map(liveFields.map((f) => [f.key, f] as const));
  const offered = producibleValues(liveFields, fieldOptionsConfig);
  return rows.map(({ key, value }) => {
    const field = byKey.get(key);
    let problem: MatchRowProblem | null = null;
    if (!field) problem = "FIELD_REMOVED";
    else if (field.type === "checkbox") {
      if (value !== "Yes" && value !== "No") problem = "NOT_BOOLEAN_WORD";
    } else if (CHOICE_TYPES.has(field.type)) {
      if (value === "") problem = "EMPTY";
      else if (!(offered.get(key) ?? []).includes(value)) problem = "VALUE_NOT_OFFERED";
    } else if (value.trim() === "") {
      problem = "EMPTY";
    } else if (canonicalMatchValue(value, field.type) !== value) {
      problem = "NOT_CANONICAL";
    }
    return { key, value, problem };
  });
}

/** Rows whose field is gone from the live schema or whose value the org no longer offers (stale-row helper). */
export function staleRows(
  rows: ReadonlyArray<{ key: string; value: string }>,
  liveFields: ReadonlyArray<MatchField>,
  fieldOptionsConfig: FieldOptionsConfig | null,
): CheckedMatchRow[] {
  return checkMatchRows(rows, liveFields, fieldOptionsConfig).filter(
    (r) => r.problem === "FIELD_REMOVED" || r.problem === "VALUE_NOT_OFFERED",
  );
}

function describe(row: CheckedMatchRow, fieldsByKey: Map<string, MatchField>): string {
  switch (row.problem) {
    case "FIELD_REMOVED":
      return `Matches row "${row.key}": unknown field for this component type`;
    case "VALUE_NOT_OFFERED":
      return `Matches row "${row.key}": "${row.value}" is not a value this organization offers`;
    case "EMPTY":
      return `Matches row "${row.key}" needs a value`;
    case "NOT_BOOLEAN_WORD":
      return `Matches row "${row.key}": the value must be Yes or No`;
    case "NOT_CANONICAL": {
      const canon = canonicalMatchValue(row.value, fieldsByKey.get(row.key)?.type ?? "field");
      return `Matches row "${row.key}": "${row.value}" is not in canonical form${canon ? ` (use "${canon}")` : ""}`;
    }
    default:
      return "";
  }
}

/**
 * The S37-2 validator, array form (the drawer's rows): duplicate keys plus every per-row check. Returns error
 * strings, empty when valid. The drawer can show a duplicate key inline; over the wire a JSON object cannot carry
 * one (Q2), so the server entry point is `validateMatchAttributes`.
 */
export function validateMatchRows(
  rows: ReadonlyArray<{ key: string; value: string }>,
  liveFields: ReadonlyArray<MatchField>,
  fieldOptionsConfig: FieldOptionsConfig | null,
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.key)) errors.push(`Matches row "${r.key}" appears more than once`);
    seen.add(r.key);
  }
  const fieldsByKey = new Map(liveFields.map((f) => [f.key, f] as const));
  for (const checked of checkMatchRows(rows, liveFields, fieldOptionsConfig)) {
    if (checked.problem) errors.push(describe(checked, fieldsByKey));
  }
  return errors;
}

/** The S37-2 validator, wire form: `attributes` must be an object of string values; then the row checks. */
export function validateMatchAttributes(
  attributes: unknown,
  liveFields: ReadonlyArray<MatchField>,
  fieldOptionsConfig: FieldOptionsConfig | null,
): string[] {
  if (!isRecord(attributes)) return ["attributes must be an object of Matches rows"];
  const rows: Array<{ key: string; value: string }> = [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== "string") errors.push(`Matches row "${key}" must be a string value`);
    else rows.push({ key, value });
  }
  return [...errors, ...validateMatchRows(rows, liveFields, fieldOptionsConfig)];
}

/** True when two rows sets are the same set of key/value pairs (order-insensitive); for "Also matched by". */
export function identicalMatchSet(a: MatchRows, b: MatchRows): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}
