// Pure scope guards for the regression DB ops (no prisma/playwright imports; also used by the tsx CLI).
export const TEST_ORG_SLUG = "e2e-testorg";

/** Throws unless `slug` is the Test Org or a suite-created `rgr-` org. */
export function assertOrgInScope(slug: string): void {
  if (typeof slug !== "string" || !(slug === TEST_ORG_SLUG || (slug.startsWith("rgr-") && slug.length > 4))) {
    throw new Error(`regression DB op refused: org "${slug}" is not the Test Org or an rgr- org`);
  }
}

/** Throws unless `prefix` starts with `rgr-` or `e2e-` (so an empty/short prefix can't match every row). */
export function assertSweepPrefix(prefix: string): void {
  if (typeof prefix !== "string" || !(prefix.startsWith("rgr-") || prefix.startsWith("e2e-"))) {
    throw new Error(`regression sweep refused: prefix "${prefix}" must start with rgr- or e2e-`);
  }
}

/** true = row exists and is an `rgr-` inquiry (safe to delete); false = row not found; throws for a non-rgr- name. */
export function assertDeletableInquiry(row: { name: string } | null): boolean {
  if (!row) return false;
  if (!row.name.startsWith("rgr-")) throw new Error(`regressionDelete refused: "${row.name}" is not an rgr- row`);
  return true;
}

/**
 * Regression-suite variants of the legacy id-addressed write ops (the legacy ops stay unscoped for the
 * older acme-glass e2e specs). `rgr:<op>` resolves the row named by `idKey` to its org and runs
 * assertOrgInScope on that org's slug BEFORE the base op writes anything.
 */
export const SCOPED_OPS: Record<string, { base: string; model: "project" | "partition" | "selection"; idKey: "projectId" | "partitionId" | "selectionId" }> = {
  "rgr:setProjectStatus": { base: "setProjectStatus", model: "project", idKey: "projectId" },
  "rgr:setDesignSubmittedAt": { base: "setDesignSubmittedAt", model: "project", idKey: "projectId" },
  "rgr:insertCalculation": { base: "insertCalculation", model: "project", idKey: "projectId" },
  "rgr:seedV1Design": { base: "seedV1Design", model: "partition", idKey: "partitionId" },
  "rgr:setSelectionConfig": { base: "setSelectionConfig", model: "selection", idKey: "selectionId" },
};

/** The scoped-op descriptor for `op`, or null for an unscoped op. Throws on an unknown `rgr:` op. */
export function scopedOp(op: string): (typeof SCOPED_OPS)[string] | null {
  if (!op.startsWith("rgr:")) return null;
  const s = SCOPED_OPS[op];
  if (!s) throw new Error(`regression DB op refused: unknown scoped op "${op}"`);
  return s;
}

/** Scope check for a scoped op: the row must exist and belong to the Test Org or an rgr- org. */
export function assertRowInScope(op: string, id: unknown, orgSlug: string | null | undefined): void {
  if (typeof id !== "string" || !id) throw new Error(`regression DB op refused: ${op} needs a row id`);
  if (orgSlug == null) throw new Error(`regression DB op refused: ${op} row ${id} not found`);
  assertOrgInScope(orgSlug);
}

/**
 * Inventory-item codes are stored case- and padding-preserving (only `trim` on create), so a test that
 * varies case could create `RGR-<run>-…` or ` rgr-<run>-…` rows that a case-sensitive `startsWith` sweep
 * misses. The sweep fetches `contains prefix (insensitive)` candidates and keeps those whose trimmed,
 * lower-cased code starts with the (lower-cased) prefix — still anchored at the start, so another run's
 * prefix can never match. The label is normalised the same way so the age gate (rgr-<runId>-) can parse it.
 */
export function normalizeSweepCode(code: string): string {
  return code.trim().toLowerCase();
}
export function matchesSweepPrefix(code: string, prefix: string): boolean {
  return normalizeSweepCode(code).startsWith(prefix.toLowerCase());
}

// ── Test-Org option lists for the run's own inventory codes (Stage 31 S31-7) ─────────────────────────────
// Selection configs are validated against the project's frozen snapshot, so the suite's run-prefixed
// inventory codes must be real dropdown choices BEFORE a project is created. The suite adds them to the
// Test Org's GLASS/DOOR `fieldOptionsConfig` (under the Test-Org config lock) and removes every value with
// its run prefix again in global teardown (and any `rgr-` residue of a crashed run in global setup).

export type OrgFieldConfig = Record<string, { options?: string[]; valueMap?: Record<string, string[]> }>;

/** Adds each `codes[field]` to `cfg[field].valueMap[parent]`. The field must already be a dependent field of the type. */
export function addAllowedCodes(cfg: OrgFieldConfig, parent: string, codes: Record<string, string>): OrgFieldConfig {
  const next = structuredClone(cfg);
  for (const [field, code] of Object.entries(codes)) {
    if (!matchesSweepPrefix(code, "rgr-")) throw new Error(`regression DB op refused: code "${code}" is not an rgr- code`);
    const vm = next[field]?.valueMap;
    if (!vm) throw new Error(`regression DB op: field "${field}" has no valueMap in the Test Org config (is it a dependent dropdown?)`);
    vm[parent] = [...new Set([...(vm[parent] ?? []), code])];
  }
  return next;
}

/** Removes every value (options list or valueMap branch) that starts with `prefix`; returns the new config and the count removed. */
export function stripPrefixedCodes(cfg: OrgFieldConfig, prefix: string): { cfg: OrgFieldConfig; removed: number } {
  let removed = 0;
  const keep = (list: string[]) =>
    list.filter((v) => {
      const drop = typeof v === "string" && matchesSweepPrefix(v, prefix);
      if (drop) removed++;
      return !drop;
    });
  const next = structuredClone(cfg);
  for (const entry of Object.values(next)) {
    if (entry.options) entry.options = keep(entry.options);
    if (entry.valueMap) for (const k of Object.keys(entry.valueMap)) entry.valueMap[k] = keep(entry.valueMap[k]);
  }
  return { cfg: next, removed };
}
