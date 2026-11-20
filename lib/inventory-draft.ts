/**
 * Stage 37 Batch 3 (commit 3): pure logic behind the Inventory drawer's edit form.
 *
 * No React, no I/O, client-safe. Holds the draft shape, the dirty check, the Matches row editor reducer and
 * per-row issues (built on the shared Batch 2 checks in `lib/inventory-matches`, so the drawer applies the same
 * rule as the server), the form validation, and `buildSavePayload`, which turns a draft into the ONE request
 * body (partKey only when changed, attributes only when the rows or the type changed).
 */
import { producibleValues } from "@/lib/inventory-link";
import type { ListItem, ListType } from "@/lib/inventory-list";
import { canonicalMatchValue, checkMatchRows, readMatchRows, validateMatchRows } from "@/lib/inventory-matches";
import type { MatchRowProblem, MatchRows } from "@/lib/inventory-matches";

export interface DraftRow {
  key: string;
  value: string;
}

export interface ItemDraft {
  code: string;
  name: string;
  /** "" = no component type. */
  componentTypeId: string;
  /** The stored key as-is (a stale key survives an unrelated edit); null = Other. */
  partKey: string | null;
  measurementUnit: string;
  /** The text of the Pack size input; blank means 1. */
  pack: string;
  soldInWholePacks: boolean;
  active: boolean;
  rows: DraftRow[];
}

/** Create defaults (plan B3-D8): unit empty, pack 1, whole packs on, active on. */
export function blankDraft(): ItemDraft {
  return {
    code: "",
    name: "",
    componentTypeId: "",
    partKey: null,
    measurementUnit: "",
    pack: "1",
    soldInWholePacks: true,
    active: true,
    rows: [],
  };
}

export function draftFromItem(item: ListItem): ItemDraft {
  return {
    code: item.code,
    name: item.name,
    componentTypeId: item.componentTypeId ?? "",
    partKey: item.partKey,
    measurementUnit: item.measurementUnit,
    pack: String(Number(item.perUnitQuantity)),
    soldInWholePacks: item.soldInWholePacks,
    active: item.active,
    rows: Object.entries(readMatchRows(item.attributes)).map(([key, value]) => ({ key, value })),
  };
}

function rowsEqual(a: DraftRow[], b: DraftRow[]): boolean {
  return a.length === b.length && a.every((r, i) => r.key === b[i].key && r.value === b[i].value);
}

/** True when the draft differs from the original (any field, or the rows list). Drives the "Discard changes?" confirm. */
export function isDirty(original: ItemDraft, draft: ItemDraft): boolean {
  return (
    original.code !== draft.code ||
    original.name !== draft.name ||
    original.componentTypeId !== draft.componentTypeId ||
    original.partKey !== draft.partKey ||
    original.measurementUnit !== draft.measurementUnit ||
    original.pack.trim() !== draft.pack.trim() ||
    original.soldInWholePacks !== draft.soldInWholePacks ||
    original.active !== draft.active ||
    !rowsEqual(original.rows, draft.rows)
  );
}

// ─── Matches row editor ────────────────────────────────────────────────────────────────────────────────────────

export type RowAction =
  | { type: "add" }
  | { type: "setKey"; index: number; key: string }
  | { type: "setValue"; index: number; value: string }
  | { type: "remove"; index: number };

/** The row editor reducer: a new row has no field yet; choosing another field clears the value. */
export function rowsReducer(rows: DraftRow[], action: RowAction): DraftRow[] {
  switch (action.type) {
    case "add":
      return [...rows, { key: "", value: "" }];
    case "setKey":
      return rows.map((r, i) => (i === action.index ? (r.key === action.key ? r : { key: action.key, value: "" }) : r));
    case "setValue":
      return rows.map((r, i) => (i === action.index ? { ...r, value: action.value } : r));
    case "remove":
      return rows.filter((_, i) => i !== action.index);
  }
}

/** Fields the picker of row `index` may offer: all the type's fields except keys other rows already use. */
export function pickableFields(type: ListType | undefined, rows: DraftRow[], index: number) {
  const usedElsewhere = new Set(rows.filter((_, i) => i !== index).map((r) => r.key));
  return (type?.fieldsSchema ?? []).filter((f) => !usedElsewhere.has(f.key));
}

/** "Add match" shows while no blank row is pending and the type still has an unused field. */
export function canAddRow(type: ListType | undefined, rows: DraftRow[]): boolean {
  if (!type || rows.some((r) => r.key === "")) return false;
  return rows.length < type.fieldsSchema.length;
}

/** The offered values of a field for the value dropdown: Yes/No for a checkbox, the producible values for a choice. */
export function valueOptions(type: ListType | undefined, key: string): string[] {
  const field = type?.fieldsSchema.find((f) => f.key === key);
  if (!field) return [];
  if (field.type === "checkbox") return ["Yes", "No"];
  if (field.type === "field") return [];
  return producibleValues(type!.fieldsSchema, type!.fieldOptionsConfig).get(key) ?? [];
}

/** Free-text values are written in their canonical form (so "12.760" is sent as "12.76"); other values are verbatim. */
export function canonicalRows(rows: DraftRow[], type: ListType | undefined): DraftRow[] {
  const byKey = new Map((type?.fieldsSchema ?? []).map((f) => [f.key, f] as const));
  return rows.map((r) => {
    const field = byKey.get(r.key);
    if (!field || field.type !== "field") return r;
    return { key: r.key, value: canonicalMatchValue(r.value, "field") ?? r.value };
  });
}

export type RowIssue = MatchRowProblem | "DUPLICATE" | "NO_FIELD" | null;

/**
 * One issue per row (null = fine), checked on the canonical rows with the shared `checkMatchRows`, plus a blank
 * field (`NO_FIELD`) and a repeated field (`DUPLICATE`, the second row onward). The picker never offers a used
 * field, so a duplicate is a belt for the same rule the array-form validator enforces.
 */
export function rowIssues(rows: DraftRow[], type: ListType | undefined): RowIssue[] {
  const canon = canonicalRows(rows, type);
  const checked = checkMatchRows(canon, type?.fieldsSchema ?? [], type?.fieldOptionsConfig ?? null);
  const seen = new Set<string>();
  return canon.map((r, i) => {
    if (r.key === "") return "NO_FIELD";
    if (seen.has(r.key)) return "DUPLICATE";
    seen.add(r.key);
    return checked[i].problem;
  });
}

/** Rows whose field is gone or whose value is no longer offered: the "No longer valid" flag. */
export function staleIssue(issue: RowIssue): boolean {
  return issue === "FIELD_REMOVED" || issue === "VALUE_NOT_OFFERED";
}

/** Complete rows (a field and a value) as an object, for "Also matched by" while the user is still typing. */
export function rowsToMatchObject(rows: DraftRow[], type: ListType | undefined): MatchRows {
  const out: MatchRows = {};
  for (const r of canonicalRows(rows, type)) {
    if (r.key !== "" && r.value !== "") out[r.key] = r.value;
  }
  return out;
}

// ─── Validation and the save payload ────────────────────────────────────────────────────────────────────────────

export type FieldErrorCode = "codeRequired" | "nameRequired" | "componentRequired" | "unitRequired" | "packPositive";

export interface DraftValidation {
  fields: Partial<Record<"code" | "name" | "component" | "unit" | "pack", FieldErrorCode>>;
  rows: RowIssue[];
  /** True when the rows must be valid to save (they changed, or the type changed so every row is new). */
  rowsBlock: boolean;
  ok: boolean;
}

/** The pack size as a number, or null when it is not a positive finite number. Blank means 1. */
export function parsePack(text: string): number | null {
  const t = text.trim();
  if (t === "") return 1;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function typeChanged(original: ItemDraft, draft: ItemDraft): boolean {
  return original.componentTypeId !== draft.componentTypeId;
}

/**
 * Client-side checks before the request. `original` is the saved state (blankDraft on create). Matches rows block
 * the save only when they changed or the type changed (stale legacy rows never block an unrelated edit); the rows
 * are then held to the same rule as the server, asserted against `validateMatchRows` in the unit tests.
 */
export function validateDraft(
  original: ItemDraft,
  draft: ItemDraft,
  type: ListType | undefined,
  mode: "create" | "edit",
  typeCount: number,
): DraftValidation {
  const fields: DraftValidation["fields"] = {};
  if (draft.code.trim() === "") fields.code = "codeRequired";
  if (draft.name.trim() === "") fields.name = "nameRequired";
  // D9: required on create when the org has types; an unassigned legacy item may stay unassigned on edit.
  if (mode === "create" && typeCount > 0 && draft.componentTypeId === "") fields.component = "componentRequired";
  if (draft.measurementUnit === "") fields.unit = "unitRequired";
  if (parsePack(draft.pack) === null) fields.pack = "packPositive";
  const rows = rowIssues(draft.rows, type);
  const rowsBlock = mode === "create" || typeChanged(original, draft) || !rowsEqual(original.rows, draft.rows);
  const rowsOk = !rowsBlock || rows.every((r) => r === null);
  return { fields, rows, rowsBlock, ok: Object.keys(fields).length === 0 && rowsOk };
}

/** True when the canonical rows pass the server's array-form validator (used by the tests to pin the shared rule). */
export function serverRowsValid(rows: DraftRow[], type: ListType | undefined): boolean {
  return validateMatchRows(canonicalRows(rows, type), type?.fieldsSchema ?? [], type?.fieldOptionsConfig ?? null).length === 0;
}

/**
 * The ONE request body (POST on create, PATCH on edit).
 * - Always: code, name, componentTypeId, measurementUnit, perUnitQuantity, soldInWholePacks, active.
 * - partKey: only when it differs from the stored one (a stale stored key survives an unrelated edit); a change to
 *   Other, including from a stale key, sends null. After a type change the server clears it, so only a newly chosen
 *   Part is sent.
 * - attributes: only when the rows changed or the type changed with rows entered (the server clears otherwise);
 *   then the full object of canonical rows.
 * Callers validate first (`validateDraft`); rows with a blank field are dropped here as a last guard.
 */
export function buildSavePayload(
  original: ItemDraft,
  draft: ItemDraft,
  type: ListType | undefined,
  mode: "create" | "edit",
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    code: draft.code.trim(),
    name: draft.name.trim(),
    componentTypeId: draft.componentTypeId === "" ? null : draft.componentTypeId,
    measurementUnit: draft.measurementUnit,
    perUnitQuantity: parsePack(draft.pack) ?? 1,
    soldInWholePacks: draft.soldInWholePacks,
    active: draft.active,
  };
  const changedType = mode === "edit" && typeChanged(original, draft);
  if (mode === "create" || changedType) {
    if (draft.partKey !== null) body.partKey = draft.partKey;
  } else if (draft.partKey !== original.partKey) {
    body.partKey = draft.partKey;
  }
  const rowsChanged = !rowsEqual(original.rows, draft.rows);
  if (rowsChanged || (mode === "create" && draft.rows.length > 0) || (changedType && draft.rows.length > 0)) {
    const attributes: Record<string, string> = {};
    for (const r of canonicalRows(draft.rows, type)) {
      if (r.key !== "") attributes[r.key] = r.value;
    }
    // Create with no rows and an unchanged-empty edit send nothing; a changed edit always sends the full object.
    if (mode === "edit" || Object.keys(attributes).length > 0) body.attributes = attributes;
  }
  return body;
}
