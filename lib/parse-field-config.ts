import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

/**
 * Shared, pure JSONB parsers for ComponentType.fieldsSchema / ComponentTypeOrgConfig's
 * fieldOptionsConfig — extracted from lib/data/components.ts (Stage 22 B5) so org-scoped
 * Server/Client Components under app/[orgSlug]/** can parse the same raw shapes without
 * violating the lib/data/* import ban (eslint.config.mjs — Stage 12 layer separation).
 * Same class of file as lib/configurator-gating.ts: dependency-free, no prisma/next imports.
 *
 * lib/data/components.ts imports these for its own listComponentTypes/getComponentTypeById
 * (single source of truth, no duplicated parsing logic); the Configuration page
 * (app/[orgSlug]/projects/[projectId]/configuration/page.tsx) imports them directly to parse
 * Project.configSnapshot's raw fieldsSchema/fieldOptionsConfig (Stage 22 B4 stores them raw).
 */

/** Parse the stored JSONB to a typed FieldEntry array (defensive). */
export function parseFieldsSchema(raw: unknown): FieldEntry[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set(["field", "radio", "dropdown", "checkbox"]);
  return (raw as unknown[])
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as Record<string, unknown>;
      const type = (validTypes.has(obj.type as string) ? obj.type : "field") as FieldEntry["type"];
      const entry: FieldEntry = {
        key: String(obj.key ?? ""),
        label: String(obj.label ?? ""),
        type,
        required: Boolean(obj.required),
        // `basic` defaults to true when absent (backwards-compat with old rows)
        basic: obj.basic !== undefined ? Boolean(obj.basic) : true,
      };
      // options: conditionally included for radio/dropdown.
      // Reads are intentionally lenient here (empty options → options: []) because
      // the write-path in actions.ts throws if options are missing, so well-formed data
      // never reaches the DB. Area 3 renderers should guard defensively on options.length
      // rather than trusting type alone.
      if (type === "radio" || type === "dropdown") {
        entry.options = Array.isArray(obj.options)
          ? (obj.options as unknown[]).map(String).filter(Boolean)
          : [];
      }
      if (obj.hint) {
        entry.hint = String(obj.hint);
      }
      // Stage 20: pass through dependsOn if present (SuperAdmin-authored wiring).
      if (obj.dependsOn && typeof obj.dependsOn === "string") {
        entry.dependsOn = obj.dependsOn;
      }
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);
}

/**
 * Parse the stored JSONB fieldOptionsConfig into a typed FieldOptionsConfig map.
 * Defensive: unknown shapes are dropped; only entries with an `options` array or
 * a `valueMap` object are preserved.
 * Stage 20 Batch 1.
 */
export function parseFieldOptionsConfig(raw: unknown): FieldOptionsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const result: FieldOptionsConfig = {};
  for (const [key, entry] of Object.entries(obj)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (Array.isArray(e.options)) {
      result[key] = { options: (e.options as unknown[]).map(String).filter(Boolean) };
    } else if (e.valueMap && typeof e.valueMap === "object" && !Array.isArray(e.valueMap)) {
      const valueMap: Record<string, string[]> = {};
      for (const [parentVal, vals] of Object.entries(e.valueMap as Record<string, unknown>)) {
        if (Array.isArray(vals)) {
          valueMap[parentVal] = (vals as unknown[]).map(String).filter(Boolean);
        }
      }
      result[key] = { valueMap };
    }
  }
  return result;
}
