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
