// Pure (no Playwright / Prisma imports) — unit-tested in tests/unit/regression-target-identity.test.ts.
import { TEST_ORG } from "../env";

/**
 * Final review C1: prove the API target and the DB the suite reads/writes directly are the SAME database before
 * anything is mutated. The DB side is pinned to the dev Neon endpoint (prisma/e2e-db-helper-cli.ts refuses any
 * other), so equal {slug → id} maps prove the API target runs on the dev DB too — a production deployment (its own
 * Neon branch, different ids even for an org with the same slug) is refused before recovery or setup touch it.
 *
 * Checked: the Test Org and every rgr- org on EITHER side must exist on both sides with the same id, and at least
 * one org must be present on both sides (otherwise nothing was proven). Any slug present on both sides must also
 * carry the same id.
 */
export function assertSameTarget(apiOrgs: Array<{ id: string; slug: string }>, dbOrgs: Record<string, { id?: string }>): void {
  const api = new Map(apiOrgs.map((o) => [o.slug, o.id]));
  const db = new Map(Object.entries(dbOrgs).map(([slug, o]) => [slug, o.id]));
  const problems: string[] = [];
  const watched = new Set([TEST_ORG, ...[...api.keys(), ...db.keys()].filter((s) => s.startsWith("rgr-"))]);
  for (const slug of watched) {
    const a = api.get(slug);
    const d = db.get(slug);
    if (a === undefined && d === undefined) continue;
    if (a === undefined) problems.push(`org "${slug}" is in the dev DB (id ${d}) but the API target does not list it`);
    else if (d === undefined) problems.push(`org "${slug}" is listed by the API target (id ${a}) but is not in the dev DB`);
    else if (a !== d) problems.push(`org "${slug}": API target id ${a} ≠ dev DB id ${d}`);
  }
  let common = 0;
  for (const [slug, a] of api) {
    const d = db.get(slug);
    if (d === undefined) continue;
    common++;
    if (a !== d && !watched.has(slug)) problems.push(`org "${slug}": API target id ${a} ≠ dev DB id ${d}`);
  }
  if (!common) problems.push("no organization is present on both the API target and the dev DB");
  if (problems.length) {
    throw new Error(
      `regression suite: the API target is NOT running on the dev DB the suite checks (PLAYWRIGHT_BASE_URL vs DATABASE_URL) — refusing to start before touching anything:\n  ${problems.join("\n  ")}`,
    );
  }
}
