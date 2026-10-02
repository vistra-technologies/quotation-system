/**
 * Update-configuration wizard — pure logic (Hotfix 2026-10-01, H-6).
 *
 * Prisma-free so it is unit-testable and importable from both the DAL and the wizard's client component.
 * Compares a Selection's stored config against a ComponentType's CURRENT fieldsSchema + org option values,
 * and diffs two config snapshots into human-readable change lines.
 */
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { collectDescendants, resolveOptions } from "@/lib/configurator-gating";

export type ConfigValue = string | boolean | number | null;
export type SelectionConfig = Record<string, ConfigValue>;

export interface FieldIssue {
  key: string;
  label: string;
  kind: "missing" | "invalid";
  /** The stored value that is no longer valid (null when missing). */
  oldValue: string | null;
}

export interface ConfigCheck {
  /** Config with keys no longer in the schema removed. */
  cleaned: SelectionConfig;
  /** Keys that were removed because the field no longer exists. */
  dropped: string[];
  issues: FieldIssue[];
}

const CHOICE = new Set<FieldEntry["type"]>(["dropdown", "radio"]);

function isEmpty(v: ConfigValue | undefined): boolean {
  return v === undefined || v === null || v === "";
}

/**
 * Validate one Selection config against the type's current schema/options.
 * Schema order is parent-before-dependent, so each choice field is checked against the options its
 * parent's stored value currently yields (cascade-aware).
 */
export function validateSelectionConfig(
  fieldsSchema: FieldEntry[],
  fieldOptionsConfig: FieldOptionsConfig | null,
  config: SelectionConfig,
): ConfigCheck {
  const keys = new Set(fieldsSchema.map((f) => f.key));
  const cleaned: SelectionConfig = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(config)) {
    if (keys.has(k)) cleaned[k] = v;
    else dropped.push(k);
  }

  const strValues: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(cleaned)) {
    if (typeof v === "string" || typeof v === "boolean") strValues[k] = v;
  }

  const issues: FieldIssue[] = [];
  for (const field of fieldsSchema) {
    if (field.type === "checkbox") continue;
    const value = cleaned[field.key];
    if (isEmpty(value)) {
      if (field.required) issues.push({ key: field.key, label: field.label, kind: "missing", oldValue: null });
      continue;
    }
    if (CHOICE.has(field.type)) {
      const options = resolveOptions(field, strValues, fieldOptionsConfig);
      if (!options.includes(String(value))) {
        issues.push({ key: field.key, label: field.label, kind: "invalid", oldValue: String(value) });
      }
    }
  }
  return { cleaned, dropped, issues };
}

/**
 * Apply a user's choice for one field: sets it and clears every descendant that depended on it, so a
 * changed parent forces its dependents to be re-picked (no stale orphan values).
 */
export function applyFieldChoice(
  fieldsSchema: FieldEntry[],
  config: SelectionConfig,
  key: string,
  value: string | boolean,
): SelectionConfig {
  const next: SelectionConfig = { ...config, [key]: value };
  for (const d of collectDescendants(fieldsSchema, key)) delete next[d];
  return next;
}

// ─── Snapshot diff ──────────────────────────────────────────────────────────

export interface DiffType {
  id: string;
  code: string;
  name: string;
  active: boolean;
  fieldsSchema: FieldEntry[];
  fieldOptionsConfig: FieldOptionsConfig;
}

export interface TypeChange {
  typeName: string;
  items: string[];
}

function optionSets(f: FieldEntry, cfg: FieldOptionsConfig): Map<string, Set<string>> {
  const entry = cfg[f.key];
  const out = new Map<string, Set<string>>();
  if (!entry) return out;
  if ("options" in entry) out.set("", new Set(entry.options));
  else for (const [parent, vals] of Object.entries(entry.valueMap)) out.set(parent, new Set(vals));
  return out;
}

/** Human-readable differences between the project's frozen types and the org's current ones. */
export function diffConfigs(oldTypes: DiffType[], newTypes: DiffType[]): TypeChange[] {
  const out: TypeChange[] = [];
  const oldById = new Map(oldTypes.map((t) => [t.id, t]));
  for (const nt of newTypes) {
    const ot = oldById.get(nt.id);
    const items: string[] = [];
    if (!ot) {
      items.push("Component type added");
    } else {
      if (ot.name !== nt.name) items.push(`Renamed from "${ot.name}"`);
      if (ot.active !== nt.active) items.push(nt.active ? "Re-activated" : "Deactivated");
      const oldF = new Map(ot.fieldsSchema.map((f) => [f.key, f]));
      const newF = new Map(nt.fieldsSchema.map((f) => [f.key, f]));
      for (const f of nt.fieldsSchema) {
        const of = oldF.get(f.key);
        if (!of) {
          items.push(`Field "${f.label}" added${f.required ? " (required)" : " (optional)"}`);
          continue;
        }
        if (of.label !== f.label) items.push(`Field "${of.label}" renamed to "${f.label}"`);
        if (!of.required && f.required) items.push(`Field "${f.label}" is now required`);
        if (of.required && !f.required) items.push(`Field "${f.label}" is now optional`);
        const a = optionSets(of, ot.fieldOptionsConfig);
        const b = optionSets(f, nt.fieldOptionsConfig);
        for (const parent of new Set([...a.keys(), ...b.keys()])) {
          const before = a.get(parent) ?? new Set<string>();
          const after = b.get(parent) ?? new Set<string>();
          const scope = parent ? ` (when ${parent})` : "";
          for (const v of before) if (!after.has(v)) items.push(`"${f.label}"${scope}: option "${v}" removed`);
          for (const v of after) if (!before.has(v)) items.push(`"${f.label}"${scope}: option "${v}" added`);
        }
      }
      for (const f of ot.fieldsSchema) if (!newF.has(f.key)) items.push(`Field "${f.label}" removed`);
    }
    if (items.length) out.push({ typeName: nt.name, items });
  }
  for (const ot of oldTypes) {
    if (!newTypes.some((t) => t.id === ot.id)) out.push({ typeName: ot.name, items: ["Component type removed"] });
  }
  return out;
}

// ─── Preview shape (shared by the DAL, API and wizard UI) ────────────────────

export interface ConfigUpdateSelection {
  id: string;
  label: string;
  typeId: string;
  typeName: string;
  config: SelectionConfig;
  /** Config keys that will be removed automatically (field no longer exists). */
  dropped: string[];
  /** Fields the user must pick/fill. */
  issues: FieldIssue[];
  /** Set when the selection cannot be fixed in the wizard. */
  blocking: string | null;
}

export interface ConfigUpdatePreview {
  /** False => nothing differs and nothing needs fixing. */
  needsUpdate: boolean;
  changes: TypeChange[];
  formula: {
    changed: boolean;
    from: string | null;
    to: string | null;
    /** Non-null when the active set is structurally incompatible with the new config (apply would 409). */
    problem: string | null;
  };
  /** Types referenced by affected selections, with the CURRENT schema/options (client resolves cascades). */
  types: Record<string, { name: string; fieldsSchema: FieldEntry[]; fieldOptionsConfig: FieldOptionsConfig }>;
  /** Only selections that are affected (dropped keys, issues or blocking). */
  selections: ConfigUpdateSelection[];
  totalSelections: number;
}

