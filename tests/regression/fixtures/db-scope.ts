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
export const SCOPED_OPS: Record<string, { base: string; model: "project" | "partition"; idKey: "projectId" | "partitionId" }> = {
  "rgr:setProjectStatus": { base: "setProjectStatus", model: "project", idKey: "projectId" },
  "rgr:setDesignSubmittedAt": { base: "setDesignSubmittedAt", model: "project", idKey: "projectId" },
  "rgr:insertCalculation": { base: "insertCalculation", model: "project", idKey: "projectId" },
  "rgr:seedV1Design": { base: "seedV1Design", model: "partition", idKey: "partitionId" },
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
