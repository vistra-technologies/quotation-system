import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

/**
 * Pure, framework-free model helpers for the Catalog tree UI — Stage 27.
 *
 * Ported from the locked mockup's model helpers
 * (`design-docs/mockups/catalog-page-poc.html`, `findAttr`/`kids`/`depth`/`isChain`/`valuesOf`/
 * `parentVals`/`emptyGroups`/`sync`/`descendants`/`removalImpact`), rewritten to operate directly
 * on the real `(fieldsSchema: FieldEntry[], config: FieldOptionsConfig)` pair instead of the
 * mockup's synthetic `{ attrs, dep, values, groups }` shape.
 *
 * S27-3: no `optionCount`/total helper here — dropped, not just unused (see stage-27.md).
 *
 * Every function is a pure read (or returns a new object) — no mutation of the inputs. Callers
 * (`AttributeEditorModal`) own the draft state and call `sync()` after every edit, exactly as the
 * mockup calls `sync(ed.draft)` after every `doAdd`/`doRemove`/`doRename`.
 */

// ─── Basic lookups ────────────────────────────────────────────────────────────

export function findAttr(schema: FieldEntry[], key: string): FieldEntry | null {
  return schema.find((f) => f.key === key) ?? null;
}

/** Direct children only — fields whose `dependsOn` is exactly `key`. */
export function kids(schema: FieldEntry[], key: string): FieldEntry[] {
  return schema.filter((f) => f.dependsOn === key);
}

/** 1 for a root (no dependsOn) field; 1 + parent's depth otherwise. */
export function depth(schema: FieldEntry[], f: FieldEntry): number {
  if (!f.dependsOn) return 1;
  const parent = findAttr(schema, f.dependsOn);
  return parent ? depth(schema, parent) + 1 : 1;
}

/** True if `f` is part of a dependency chain — either depends on something, or has dependents. */
export function isChain(schema: FieldEntry[], f: FieldEntry): boolean {
  return Boolean(f.dependsOn) || kids(schema, f.key).length > 0;
}

/** Every field in the schema that has a dropdown/radio choice list to configure here. */
export function choiceFields(schema: FieldEntry[]): FieldEntry[] {
  return schema.filter((f) => f.type === "dropdown" || f.type === "radio");
}

/**
 * The tree's dependent-attribute columns: tier d (1-based) holds the chain fields at depth d, ordered by
 * their parent's position in the previous tier, then schema order. The one definition of "tree order" —
 * `CatalogTree` renders these columns and `offenderKeys` walks them.
 */
export function tiersOf(fields: FieldEntry[]): FieldEntry[][] {
  const chain = fields.filter((f) => isChain(fields, f));
  const maxDepth = chain.reduce((m, f) => Math.max(m, depth(fields, f)), 0);
  const tiers: FieldEntry[][] = [];
  for (let d = 1; d <= maxDepth; d++) {
    const prevTier = tiers[d - 2] ?? [];
    tiers[d - 1] = chain
      .filter((f) => depth(fields, f) === d)
      .map((f, i) => ({
        f,
        i,
        p: f.dependsOn ? prevTier.findIndex((x) => x.key === f.dependsOn) : 0,
      }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .map((o) => o.f);
  }
  return tiers;
}

/** Stage 35 S35-8: the keys of fields with a missing inventory value, in tree order (tiers, then the independent lane). */
export function offenderKeys(fields: FieldEntry[], issues: Record<string, string[]>): string[] {
  const ordered = [...tiersOf(fields).flat(), ...fields.filter((f) => !isChain(fields, f))];
  return ordered.filter((f) => (issues[f.key]?.length ?? 0) > 0).map((f) => f.key);
}

/** Stage 35 S35-8: the pill's N — missing values summed across the type's linked fields. */
export function missingCount(issues: Record<string, string[]>): number {
  return Object.values(issues).reduce((n, list) => n + list.length, 0);
}

/** Stage 35: the issues map after `code` became an active same-type item (it is no longer missing anywhere). */
export function withoutCode(issues: Record<string, string[]>, code: string): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(issues)) {
    const rest = list.filter((v) => v !== code);
    if (rest.length > 0) next[k] = rest;
  }
  return next;
}

// ─── Values / groups ──────────────────────────────────────────────────────────

/**
 * The full set of distinct values `f` can currently produce.
 * Flat field: its own `options` list. Dependent field: the union of every group (keyed by a
 * currently-live parent value) in its `valueMap` — mirrors the mockup's `valuesOf`.
 */
export function valuesOf(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry): string[] {
  if (!f.dependsOn) {
    const entry = config[f.key];
    return entry && "options" in entry ? entry.options : [];
  }
  const parent = findAttr(schema, f.dependsOn);
  if (!parent) return [];
  const parentValues = valuesOf(schema, config, parent);
  const entry = config[f.key];
  const valueMap = entry && "valueMap" in entry ? entry.valueMap : {};
  const out: string[] = [];
  for (const k of parentValues) {
    for (const v of valueMap[k] ?? []) {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

/** `f`'s parent's current live values — the set of group keys `f` should have one list per. */
export function parentValuesOf(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry): string[] {
  if (!f.dependsOn) return [];
  const parent = findAttr(schema, f.dependsOn);
  return parent ? valuesOf(schema, config, parent) : [];
}

/**
 * Parent-value keys with no options yet. Flat field: `['*']` as a single sentinel if it has zero
 * options at all, `[]` otherwise (mirrors the mockup's `a.values.length ? [] : ['*']`).
 */
export function emptyGroups(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry): string[] {
  if (!f.dependsOn) {
    return valuesOf(schema, config, f).length ? [] : ["*"];
  }
  const parentValues = parentValuesOf(schema, config, f);
  const entry = config[f.key];
  const valueMap = entry && "valueMap" in entry ? entry.valueMap : {};
  return parentValues.filter((k) => !(valueMap[k]?.length));
}

export function emptyGroupCount(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry): number {
  return emptyGroups(schema, config, f).length;
}

/**
 * Keep every dependent field's `valueMap` in step with its parent's current live values: drop
 * orphaned keys, add empty lists for new parent values. Depth-ordered so a change several hops up
 * the chain propagates all the way down in one pass — mirrors the mockup's `sync`.
 *
 * Also normalizes the *shape* of the output to exactly the current schema: only fields that are
 * currently dropdown/radio (`choiceFields`) get an entry, each in the shape its *current*
 * `dependsOn` implies (`options` for a flat field, `valueMap` for a dependent one). Any key in
 * `config` for a field that's been deleted, retyped away from dropdown/radio, or had its
 * `dependsOn` removed/added is dropped rather than carried through — mirrors the old
 * `catalog-type-editor.tsx`'s `choiceFields`-only PUT body, which this replaced. Without this, a
 * schema edit made elsewhere (SuperAdmin) leaves a stale/mismatched key in the stored config that
 * this page would otherwise round-trip back to the server on every later save, and the API 400s.
 */
export function sync(schema: FieldEntry[], config: FieldOptionsConfig): FieldOptionsConfig {
  const out: FieldOptionsConfig = {};
  const fields = choiceFields(schema)
    .slice()
    .sort((a, b) => depth(schema, a) - depth(schema, b));
  for (const f of fields) {
    if (!f.dependsOn) {
      const entry = config[f.key];
      out[f.key] = { options: entry && "options" in entry ? entry.options : [] };
      continue;
    }
    const parent = findAttr(schema, f.dependsOn);
    const parentValues = parent ? valuesOf(schema, out, parent) : [];
    const entry = config[f.key];
    const oldMap = entry && "valueMap" in entry ? entry.valueMap : {};
    const newMap: Record<string, string[]> = {};
    for (const k of parentValues) {
      newMap[k] = oldMap[k] ?? [];
    }
    out[f.key] = { valueMap: newMap };
  }
  return out;
}

// ─── Dependency-chain traversal (the cascade flow) ────────────────────────────

/** Every descendant of `key`, at any depth, in BFS (tier) order — mirrors the mockup's `descendants`. */
export function descendants(schema: FieldEntry[], key: string): string[] {
  const out: string[] = [];
  const queue: string[] = [key];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const k of kids(schema, cur)) {
      out.push(k.key);
      queue.push(k.key);
    }
  }
  return out;
}

// ─── Hover/focus path tracing (tree canvas) ───────────────────────────────────

/**
 * The set of node ids that should "light up" when tracing the path through `id` — root,
 * ancestors, descendants (any depth), or (for the independent lane) the hub + rail + every
 * independent node. Returns null for "root" (nothing to trace) or an unknown id.
 * Mirrors the mockup's `related`.
 */
export function relatedIds(schema: FieldEntry[], id: string): Set<string> | null {
  const set = relatedByDependsOn(schema, id);
  if (!set || id === "hub") return set;
  return expandShowWhen(schema, id, set);
}

/**
 * Stage 35 S35-5 focus rule for `showWhen` edges, applied on top of the `dependsOn` trace: a controller
 * lights every field it gates (any depth, every value set, so its Yes and No bands light together); a
 * gated field lights its controller (and that controller's own controllers) plus the other fields the
 * same controller gates — the mockup's "click a card in a band = focus its controller group".
 */
function expandShowWhen(schema: FieldEntry[], id: string, base: Set<string>): Set<string> {
  const set = new Set(base);
  const gatedBy = (key: string) => schema.filter((f) => f.showWhen?.field === key);
  const addGated = (key: string) => {
    for (const g of gatedBy(key)) {
      if (set.has(g.key)) continue;
      set.add(g.key);
      addGated(g.key);
    }
  };
  const focus = findAttr(schema, id);
  if (!focus) return set;
  let controllerKey = focus.showWhen?.field ?? null;
  while (controllerKey) {
    set.add(controllerKey);
    controllerKey = findAttr(schema, controllerKey)?.showWhen?.field ?? null;
  }
  addGated(id);
  if (focus.showWhen) addGated(focus.showWhen.field);
  return set;
}

function relatedByDependsOn(schema: FieldEntry[], id: string): Set<string> | null {
  if (id === "root") return null;
  const set = new Set<string>([id]);
  if (id === "hub") {
    set.add("root");
    set.add("rail");
    for (const f of schema) if (!isChain(schema, f)) set.add(f.key);
    return set;
  }
  const f = findAttr(schema, id);
  if (!f) return null;
  if (!isChain(schema, f)) {
    set.add("root");
    set.add("hub");
    set.add("rail");
    return set;
  }
  set.add("root");
  let p: FieldEntry | null = f;
  while (p.dependsOn) {
    set.add(p.dependsOn);
    p = findAttr(schema, p.dependsOn);
    if (!p) break;
  }
  const down = (x: string) => {
    for (const k of kids(schema, x)) {
      set.add(k.key);
      down(k.key);
    }
  };
  down(id);
  return set;
}

// ─── Visibility bands (Stage 35 S35-5) ────────────────────────────────────────

export interface ShowBand {
  /** Stable per render: `band-<index>`. */
  id: string;
  controller: string;
  /** The `in` values, in authored order (the first member's set; an equal set in another order shares the band). */
  values: string[];
  /** Gated fields of this band, in schema order. */
  fieldKeys: string[];
  /** `in` values the controller cannot produce in this org (warn-only). */
  badValues: string[];
  /** Every member can never appear (no producible `in` value, or its controller is itself never shown). */
  allNever: boolean;
}

/**
 * Gated field keys that can never appear in this org: none of their `in` values is a value the controller
 * can produce, or the controller is itself never shown (cascade). A controller with no values configured
 * yet cannot be judged, so nothing is flagged until it has options (an unconfigured type already says so).
 */
export function neverShownKeys(schema: FieldEntry[], config: FieldOptionsConfig): Set<string> {
  const never = new Set<string>();
  for (const f of schema) {
    const sw = f.showWhen;
    if (!sw) continue;
    const controller = findAttr(schema, sw.field);
    if (!controller) continue;
    if (never.has(controller.key)) {
      never.add(f.key);
      continue;
    }
    const produced = valuesOf(schema, config, controller);
    if (produced.length > 0 && !sw.in.some((v) => produced.includes(v))) never.add(f.key);
  }
  return never;
}

/** One band per (controller, value set), in order of first appearance. A Yes set and a No set are two bands. */
export function bandsOf(schema: FieldEntry[], config: FieldOptionsConfig): ShowBand[] {
  const never = neverShownKeys(schema, config);
  const bands: ShowBand[] = [];
  const index = new Map<string, ShowBand>();
  for (const f of schema) {
    const sw = f.showWhen;
    if (!sw) continue;
    const controller = findAttr(schema, sw.field);
    if (!controller) continue;
    const sig = JSON.stringify([sw.field, [...new Set(sw.in)].sort()]);
    let band = index.get(sig);
    if (!band) {
      const produced = valuesOf(schema, config, controller);
      band = {
        id: `band-${bands.length}`,
        controller: sw.field,
        values: [...new Set(sw.in)],
        fieldKeys: [],
        badValues: produced.length > 0 ? sw.in.filter((v) => !produced.includes(v)) : [],
        allNever: false,
      };
      index.set(sig, band);
      bands.push(band);
    }
    band.fieldKeys.push(f.key);
  }
  for (const b of bands) b.allNever = b.fieldKeys.every((k) => never.has(k));
  return bands;
}

// ─── Removal impact (cross-field cascade warning) ─────────────────────────────

export interface RemovalImpactEntry {
  label: string;
  groups: string[];
  vals: number;
}

/**
 * What removing `value` from `fieldKey`'s group `groupKey` (null for a flat field's single list)
 * would do to every *other* dependent field in the schema, at any depth — mirrors the mockup's
 * `removalImpact`, which already walks the whole schema, not just direct children, so grandchild
 * losses surface correctly.
 */
export function removalImpact(
  schema: FieldEntry[],
  config: FieldOptionsConfig,
  fieldKey: string,
  groupKey: string | null,
  value: string,
): { after: FieldOptionsConfig; impact: RemovalImpactEntry[] } {
  const before = sync(schema, config);
  const draft: FieldOptionsConfig = structuredClone(before);

  if (groupKey === null) {
    const entry = draft[fieldKey];
    const opts = entry && "options" in entry ? entry.options : [];
    draft[fieldKey] = { options: opts.filter((v) => v !== value) };
  } else {
    const entry = draft[fieldKey];
    const valueMap = entry && "valueMap" in entry ? { ...entry.valueMap } : {};
    valueMap[groupKey] = (valueMap[groupKey] ?? []).filter((v) => v !== value);
    draft[fieldKey] = { valueMap };
  }

  const after = sync(schema, draft);
  const impact: RemovalImpactEntry[] = [];
  for (const f of schema) {
    if (!f.dependsOn) continue;
    const beforeEntry = before[f.key];
    const beforeMap = beforeEntry && "valueMap" in beforeEntry ? beforeEntry.valueMap : {};
    const afterEntry = after[f.key];
    const afterMap = afterEntry && "valueMap" in afterEntry ? afterEntry.valueMap : {};
    const lostKeys = Object.keys(beforeMap).filter((k) => !(k in afterMap));
    if (!lostKeys.length) continue;
    const vals = lostKeys.reduce((n, k) => n + (beforeMap[k]?.length ?? 0), 0);
    impact.push({ label: f.label, groups: lostKeys, vals });
  }
  return { after, impact };
}

// ─── Misc small helpers ────────────────────────────────────────────────────────

export function attrMatches(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry, q: string): boolean {
  if (f.label.toLowerCase().includes(q)) return true;
  return valuesOf(schema, config, f).some((v) => v.toLowerCase().includes(q));
}

/** The chip list for one group of `f` — its flat `options` (groupKey null) or one `valueMap` entry. */
export function listFor(config: FieldOptionsConfig, f: FieldEntry, groupKey: string | null): string[] {
  const entry = config[f.key];
  if (groupKey === null) {
    return entry && "options" in entry ? entry.options : [];
  }
  const valueMap = entry && "valueMap" in entry ? entry.valueMap : {};
  return valueMap[groupKey] ?? [];
}

/** Number of groups (parent values) a dependent field currently has — 0 for a flat field. */
export function groupCountOf(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry): number {
  if (!f.dependsOn) return 0;
  return parentValuesOf(schema, config, f).length;
}

/**
 * Short "preview" string for a tree node — the node's current values collapsed into one line, or
 * "No options yet" / "X · same for all N" for the common all-groups-identical case. Mirrors the
 * mockup's `nodeHTML` preview logic. Deliberately does not include an option-count total (S27-3).
 */
export function nodePreview(schema: FieldEntry[], config: FieldOptionsConfig, f: FieldEntry): string {
  const vals = valuesOf(schema, config, f);
  const empties = emptyGroups(schema, config, f);
  const nGroups = groupCountOf(schema, config, f);
  if (!vals.length) return "No options yet";
  if (f.dependsOn && vals.length === 1 && nGroups > 1 && empties.length === 0) {
    return `${vals[0]} · same for all ${nGroups}`;
  }
  return vals.join(" · ");
}
