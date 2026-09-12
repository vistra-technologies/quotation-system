/**
 * Shared FieldOptionsConfig type — describes the shape of a ComponentTypeOrgConfig row's
 * `fieldOptionsConfig` JSONB column (org-level dropdown/radio value lists).
 *
 * Extracted to lib/types/ (mirroring lib/types/field-entry.ts) so that org-scoped Server/Client
 * Components under app/[orgSlug]/** can import the type without violating the lib/data/* import
 * ban (eslint.config.mjs — org-scoped pages/actions must use internalFetch, not lib/data/*
 * directly). lib/data/components.ts re-exports these types for backward compatibility with the
 * API route handlers under app/api/**.
 *
 * A flat field (no `dependsOn` on its fieldsSchema entry) → { options: string[] }
 * A dependent field (has `dependsOn`) → { valueMap: Record<parentValue, string[]> }
 */
export type FieldOptionsEntry =
  | { options: string[] }
  | { valueMap: Record<string, string[]> };

/** Parsed fieldOptionsConfig map — keyed by fieldKey. */
export type FieldOptionsConfig = Record<string, FieldOptionsEntry>;
