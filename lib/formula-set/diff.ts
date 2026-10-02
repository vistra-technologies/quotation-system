/**
 * Structured diff between two FormulaSet bodies, for the SuperAdmin "new version" draft page
 * (hotfix 2026-10-02, item 5). PURE: no Prisma, no React, no I/O — runs in the browser.
 *
 * Formulas are matched by `id`, so reordering is never reported as a change. Slots are matched by
 * code, `requiredParams` by `key`. Anything else at the top level (e.g. `schemaVersion`) is reported
 * as a plain field change. The draft side may be mid-edit and invalid; a parse failure is returned as
 * `{ ok: false }`, never thrown.
 */

export interface FieldChange {
  field: string;
  /** `undefined` when the field did not exist on the base side (added). */
  before: unknown;
  /** `undefined` when the field does not exist on the draft side (removed). */
  after: unknown;
}

export interface FormulaDiff {
  id: string;
  kind: "added" | "removed" | "changed";
  /** slot · grain · unit of the draft formula (base formula when removed) — header context only. */
  meta: { slot?: string; grain?: string; unit?: string };
  /** Changed fields for "changed"; every field for "added"/"removed" (before/after one side only). */
  fields: FieldChange[];
}

export interface SlotDiff {
  slot: string;
  kind: "added" | "removed" | "changed";
  /** Human-readable lines, e.g. `requiredParams: + hingeCode`, `role: "door" → "glass"`. */
  details: string[];
}

export interface BodyDiffOk {
  ok: true;
  formulas: FormulaDiff[];
  unchangedIds: string[];
  slots: SlotDiff[];
  /** Top-level keys other than `slots` / `formulas`. */
  other: FieldChange[];
  counts: { changed: number; added: number; removed: number; unchanged: number };
  /** True when the two bodies are semantically identical. */
  identical: boolean;
}

export interface BodyDiffError {
  ok: false;
  /** Which side failed to parse / has the wrong shape. */
  side: "base" | "draft";
  message: string;
}

export type BodyDiff = BodyDiffOk | BodyDiffError;

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Key-order-insensitive deep equality for JSON values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRec(a) && isRec(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function fieldChanges(before: Rec | undefined, after: Rec | undefined): FieldChange[] {
  const keys = new Set<string>([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: FieldChange[] = [];
  for (const field of keys) {
    const b = before?.[field];
    const a = after?.[field];
    if (!deepEqual(b, a)) out.push({ field, before: b, after: a });
  }
  return out;
}

/** Show order that matches how formulas read: quantity first, then the rest as authored. */
const FIELD_ORDER = ["quantity", "condition", "materialCode", "unit", "grain", "slot"];
function sortFields(fields: FieldChange[]): FieldChange[] {
  const rank = (f: string) => {
    const i = FIELD_ORDER.indexOf(f);
    return i === -1 ? FIELD_ORDER.length : i;
  };
  return [...fields].sort((x, y) => rank(x.field) - rank(y.field));
}

function parse(json: string, side: "base" | "draft"): { value: Rec } | BodyDiffError {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch (e) {
    return { ok: false, side, message: e instanceof Error ? e.message : "Invalid JSON" };
  }
  if (!isRec(v)) return { ok: false, side, message: "Body must be a JSON object" };
  return { value: v };
}

/** Formulas by id. Entries without a string id (mid-edit garbage) are skipped, not fatal. */
function formulasById(body: Rec): Map<string, Rec> {
  const m = new Map<string, Rec>();
  const list = body.formulas;
  if (Array.isArray(list)) {
    for (const f of list) {
      if (isRec(f) && typeof f.id === "string") m.set(f.id, f);
    }
  }
  return m;
}

function slotMap(body: Rec): Map<string, Rec> {
  const m = new Map<string, Rec>();
  if (isRec(body.slots)) {
    for (const [code, s] of Object.entries(body.slots)) {
      if (isRec(s)) m.set(code, s);
    }
  }
  return m;
}

function paramKeys(slot: Rec): string[] {
  const rp = slot.requiredParams;
  if (!Array.isArray(rp)) return [];
  return rp.flatMap(p => (isRec(p) && typeof p.key === "string" ? [p.key] : []));
}

export function formatValue(v: unknown): string {
  if (v === undefined) return "(none)";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function slotDetails(before: Rec, after: Rec): string[] {
  const details: string[] = [];
  const bk = paramKeys(before);
  const ak = paramKeys(after);
  for (const k of ak) if (!bk.includes(k)) details.push(`requiredParams: + ${k}`);
  for (const k of bk) if (!ak.includes(k)) details.push(`requiredParams: − ${k}`);
  // requiredParams entries may carry more than `key`; report non-key edits generically.
  const rest = (s: Rec) => {
    const { requiredParams, ...others } = s;
    void requiredParams;
    return others;
  };
  for (const c of fieldChanges(rest(before), rest(after))) {
    details.push(`${c.field}: ${formatValue(c.before)} → ${formatValue(c.after)}`);
  }
  if (details.length === 0 && !deepEqual(before.requiredParams, after.requiredParams)) {
    details.push("requiredParams: edited");
  }
  return details;
}

/**
 * Compare a draft body against the version it was started from. Both arguments are raw JSON text
 * (the base is whatever the page was seeded with; the draft is the live textarea contents).
 */
export function diffFormulaSetBodies(baseJson: string, draftJson: string): BodyDiff {
  const base = parse(baseJson, "base");
  if ("ok" in base) return base;
  const draft = parse(draftJson, "draft");
  if ("ok" in draft) return draft;

  const bf = formulasById(base.value);
  const df = formulasById(draft.value);

  const formulas: FormulaDiff[] = [];
  const unchangedIds: string[] = [];

  // Draft order first (what the author is looking at), then removals in base order.
  for (const [id, after] of df) {
    const before = bf.get(id);
    const meta = { slot: str(after.slot), grain: str(after.grain), unit: str(after.unit) };
    if (!before) {
      formulas.push({ id, kind: "added", meta, fields: sortFields(fieldChanges(undefined, after).filter(c => c.field !== "id")) });
    } else {
      const fields = sortFields(fieldChanges(before, after).filter(c => c.field !== "id"));
      if (fields.length > 0) formulas.push({ id, kind: "changed", meta, fields });
      else unchangedIds.push(id);
    }
  }
  for (const [id, before] of bf) {
    if (!df.has(id)) {
      formulas.push({
        id,
        kind: "removed",
        meta: { slot: str(before.slot), grain: str(before.grain), unit: str(before.unit) },
        fields: sortFields(fieldChanges(before, undefined).filter(c => c.field !== "id")),
      });
    }
  }

  const bs = slotMap(base.value);
  const ds = slotMap(draft.value);
  const slots: SlotDiff[] = [];
  for (const [code, after] of ds) {
    const before = bs.get(code);
    if (!before) slots.push({ slot: code, kind: "added", details: [`new slot (${paramKeys(after).length} required params)`] });
    else {
      const details = slotDetails(before, after);
      if (details.length > 0) slots.push({ slot: code, kind: "changed", details });
    }
  }
  for (const [code, before] of bs) {
    if (!ds.has(code)) slots.push({ slot: code, kind: "removed", details: [`slot removed (${paramKeys(before).length} required params)`] });
  }

  const strip = (b: Rec): Rec => {
    const { slots: s, formulas: f, ...rest } = b;
    void s;
    void f;
    return rest;
  };
  const other = fieldChanges(strip(base.value), strip(draft.value));

  const counts = {
    changed: formulas.filter(f => f.kind === "changed").length,
    added: formulas.filter(f => f.kind === "added").length,
    removed: formulas.filter(f => f.kind === "removed").length,
    unchanged: unchangedIds.length,
  };

  return {
    ok: true,
    formulas,
    unchangedIds,
    slots,
    other,
    counts,
    identical: formulas.length === 0 && slots.length === 0 && other.length === 0,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// ─── Token-level highlight for a single changed string ───────────────────────

export interface Highlight {
  prefix: string;
  beforeMid: string;
  afterMid: string;
  suffix: string;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);

/**
 * Split two strings into `prefix + mid + suffix` around the changed region, snapped to word
 * boundaries so an identifier is highlighted whole (`doorWidthMmFullHeight` → `doorWidthMm`, not
 * just `FullHeight`).
 */
export function highlightChange(before: string, after: string): Highlight {
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before[p] === after[p]) p++;
  // Back off so we do not start the highlight inside a word.
  while (p > 0 && isWordChar(before[p - 1]) && (isWordChar(before[p]) || isWordChar(after[p]))) p--;

  let s = 0; // length of common suffix, not overlapping the prefix
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  // Shrink the suffix so it does not begin inside a word.
  while (
    s > 0 &&
    isWordChar(before[before.length - s]) &&
    (isWordChar(before[before.length - s - 1]) || isWordChar(after[after.length - s - 1]))
  ) s--;

  return {
    prefix: before.slice(0, p),
    beforeMid: before.slice(p, before.length - s),
    afterMid: after.slice(p, after.length - s),
    suffix: s > 0 ? before.slice(before.length - s) : "",
  };
}
