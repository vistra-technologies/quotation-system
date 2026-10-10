import { regressionAllowCodes } from "../../e2e/db-helpers";
import { withTestOrgConfigLock } from "./config-window";
import { readRunState } from "./run-state";

/**
 * Stage 31 S31-7: a selection's config is validated against the project's frozen configSnapshot, so the
 * suite's run-prefixed InventoryItem codes must be real choices of the Test Org's GLASS / DOOR dependent
 * dropdowns BEFORE any project that will use them is created (the snapshot is taken at project create).
 *
 * `allowTestOrgCodes` adds them to the Test Org's option lists (the code fields depend on glassType /
 * doorType, so they go under the "ID1" / "Simple Glass" branch every suite config uses). It runs under
 * TEST_ORG_CONFIG_LOCK, so it cannot interleave with a catalog window that records and reverts the config,
 * and it only ever ADDS rgr- values. Global teardown removes every value carrying the run prefix
 * (`regressionStripCodes`), and global setup removes residue of a crashed run, so the Test Org's shared
 * configuration is back to its baseline exactly (the teardown snapshot diff proves it).
 */
const PARENT = { GLASS: "ID1", DOOR: "Simple Glass" } as const;

export async function allowTestOrgCodes(kind: "GLASS" | "DOOR", codes: Record<string, string>): Promise<void> {
  const run = readRunState();
  await withTestOrgConfigLock(run, async () => {
    await regressionAllowCodes(run.testOrg.slug, kind, PARENT[kind], codes);
  });
}
