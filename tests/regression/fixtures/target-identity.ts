// Pure (no Playwright / Prisma imports) — unit-tested in tests/unit/regression-target-identity.test.ts.
import { TEST_ORG } from "../env";

/**
 * Final review C1: prove the API target and the DB the suite reads/writes directly are the SAME database before
 * anything is mutated. The DB side is pinned to the dev Neon endpoint (prisma/e2e-db-helper-cli.ts refuses any
 * other), so the API target must show exactly the rows that DB holds.
 *
 * Orgs that existed before the dev branch was split off production (e.g. cloisons) very likely carry the SAME id on
 * both branches, so matching them proves nothing on its own. The proof is the Test Org (and any rgr- org): created on
 * the dev branch after the split, its id exists nowhere else. Hence (M-b) the Test Org MUST be in the dev DB and match,
 * unless `requireTestOrg: false` — only for an explicit create-the-Test-Org run (RGR_CREATE_TEST_ORG=1), after which
 * setup re-runs this check WITH the Test Org required before anything else is touched.
 *
 * Checked: the Test Org and every rgr- org on EITHER side exist on both sides with the same id; any slug present on
 * both sides carries the same id; at least one org is common.
 */
export function assertSameTarget(
  apiOrgs: Array<{ id: string; slug: string }>,
  dbOrgs: Record<string, { id?: string }>,
  opts: { requireTestOrg?: boolean } = {},
): void {
  const api = new Map(apiOrgs.map((o) => [o.slug, o.id]));
  const db = new Map(Object.entries(dbOrgs).map(([slug, o]) => [slug, o.id]));
  const problems: string[] = [];
  if ((opts.requireTestOrg ?? true) && !db.has(TEST_ORG) && !api.has(TEST_ORG)) {
    problems.push(
      `the Test Org "${TEST_ORG}" exists neither on the API target nor in the dev DB — without it the target cannot be proven to be dev ` +
        "(orgs older than the dev branch share their ids with production). Create it on the dev target, or run once with " +
        "RGR_CREATE_TEST_ORG=1 (+ TEST_ADMIN_PASSWORD) to let setup create it and re-check",
    );
  }
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
      `regression suite: the API target is NOT proven to run on the dev DB the suite checks (PLAYWRIGHT_BASE_URL vs DATABASE_URL) — refusing to continue:\n  ${problems.join("\n  ")}`,
    );
  }
}
