/**
 * One-time correction of `cloisons`'s GLASS and DOOR ComponentType `fieldsSchema`/
 * `fieldOptionsConfig` — Stage 27 production runbook.
 *
 * Background: 7 GLASS fields (acousticGasketCode, whiteSealCode, woodWedgeCode,
 * lConnectorCode, degreeConnectorCode, doorConnectorCode, straightConnectorCode) and 14
 * DOOR fields (everything except category/doorType) shipped as independent (no `dependsOn`)
 * when they should depend on glassType/doorType respectively — confirmed by direct human
 * review of the live SuperAdmin editor against the real cloisons catalog. This was corrected
 * on the dev DB by hand (`lib/component-catalog-seed.ts`'s `COMPONENT_TYPE_DEFS`/
 * `COMPONENT_TYPE_ORG_CONFIG_DEFS` now ship the fix for future orgs and reseeds), but
 * production's already-stored `cloisons` row was never touched — agents cannot run prod
 * scripts, and the seed script upsert wouldn't reach it without a human running it.
 *
 * What it does, per ComponentType (GLASS then DOOR):
 *   1. Read the current `fieldsSchema` + `ComponentTypeOrgConfig.fieldOptionsConfig`.
 *   2. For each target field still independent (no `dependsOn`): set `dependsOn` to the
 *      parent key, and reshape its `fieldOptionsConfig` entry from `{ options: [...] }` to
 *      `{ valueMap: { <each current parent value>: [...same values...] } }` — every existing
 *      value is carried into every parent key, nothing is dropped. A field already wired
 *      (e.g. from a prior partial fix) is left untouched — idempotent.
 *   3. Write both `ComponentType.fieldsSchema` and `ComponentTypeOrgConfig.fieldOptionsConfig`
 *      in one transaction per type.
 *
 * Does NOT touch: any other ComponentType/org, InventoryItem, or anything outside the
 * cloisons GLASS/DOOR rows named above.
 *
 * Safety (mirrors prisma/seed-inventory-cloisons.ts exactly):
 *   - DRY RUN IS THE DEFAULT — rows are written only when `--write` is passed.
 *   - EXPECT_ENDPOINT guard (`prisma/db-target-guard.ts`): defaults to dev endpoint;
 *     production requires `EXPECT_ENDPOINT=ep-little-paper-aipm0o0i` in the operator's shell.
 *   - Env precedence: real env > .env.local > .env (dotenv never overrides an already-set var).
 *
 * Usage (from quotation-system/, a checkout of `master` at or after the Stage 27 merge):
 *   npx tsx prisma/fix-cloisons-catalog-dependson.ts            # dry run (default, safe)
 *   npx tsx prisma/fix-cloisons-catalog-dependson.ts --write    # real run (dev DB only without EXPECT_ENDPOINT)
 *
 * Production:
 *   $env:DATABASE_URL    = <prod connection string>
 *   $env:EXPECT_ENDPOINT = "ep-little-paper-aipm0o0i"
 *   npx tsx prisma/fix-cloisons-catalog-dependson.ts            # dry run on prod
 *   npx tsx prisma/fix-cloisons-catalog-dependson.ts --write    # real run on prod
 */
import dotenv from "dotenv";
import { describeTarget, enforceDbTarget } from "./db-target-guard";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

type FieldEntry = {
  key: string;
  label: string;
  type: string;
  dependsOn?: string;
  hint?: string;
  required: boolean;
  basic: boolean;
};

type FieldOptionsEntry = { options: string[] } | { valueMap: Record<string, string[]> };

const GLASS_PARENT_KEY = "glassType";
const GLASS_TARGET_FIELDS = [
  "acousticGasketCode",
  "whiteSealCode",
  "woodWedgeCode",
  "lConnectorCode",
  "degreeConnectorCode",
  "doorConnectorCode",
  "straightConnectorCode",
];

const DOOR_PARENT_KEY = "doorType";
const DOOR_TARGET_FIELDS = [
  "hasFrame",
  "hasLeaf",
  "frameCode",
  "leafCode",
  "cornerConnBigCode",
  "cornerConnSmallFrameCode",
  "cornerConnSmallLeafCode",
  "lAngleCode",
  "hingeCode",
  "rubber25mmCode",
  "frameBumperGasketCode",
  "frameBackGasketCode",
  "leafGlassGasket1Code",
  "leafGlassGasket2Code",
];

/** The parent field's own distinct values — union across its own valueMap's groups if
 *  dependent-on-something-else (glassType/doorType both depend on category), else its flat
 *  options list. */
function distinctParentValues(parentEntry: FieldOptionsEntry): string[] {
  if ("valueMap" in parentEntry) {
    return [...new Set(Object.values(parentEntry.valueMap).flat())];
  }
  return [...parentEntry.options];
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun = !process.argv.includes("--write");

  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(dryRun ? "DRY RUN — nothing will be written. (Pass `--write` to write.)" : "REAL RUN (--write).");

  let aborted = false;
  const report: string[] = [];

  try {
    const org = await prisma.organization.findFirst({ where: { slug: "cloisons" } });
    if (!org) {
      console.error("ABORT: no organization with slug 'cloisons' found on this DB target.");
      process.exitCode = 1;
      return;
    }
    console.log(`cloisons org id: ${org.id}`);

    for (const [code, parentKey, targetFields] of [
      ["GLASS", GLASS_PARENT_KEY, GLASS_TARGET_FIELDS] as const,
      ["DOOR", DOOR_PARENT_KEY, DOOR_TARGET_FIELDS] as const,
    ]) {
      const ct = await prisma.componentType.findFirst({ where: { organizationId: org.id, code } });
      if (!ct) {
        console.warn(`  ${code}: ComponentType not found — skipping.`);
        continue;
      }
      const cfg = await prisma.componentTypeOrgConfig.findUnique({ where: { componentTypeId: ct.id } });
      if (!cfg) {
        console.warn(`  ${code}: no ComponentTypeOrgConfig row — skipping.`);
        continue;
      }

      const schema = ct.fieldsSchema as unknown as FieldEntry[];
      const config = { ...(cfg.fieldOptionsConfig as unknown as Record<string, FieldOptionsEntry>) };

      const parentConfigEntry = config[parentKey];
      if (!parentConfigEntry) {
        console.warn(`  ${code}: parent field "${parentKey}" has no fieldOptionsConfig entry — skipping.`);
        continue;
      }
      const parentValues = distinctParentValues(parentConfigEntry);
      if (parentValues.length === 0) {
        console.warn(`  ${code}: parent field "${parentKey}" has no values yet — skipping.`);
        continue;
      }

      let changedCount = 0;
      const newSchema = schema.map((f) => {
        if (!targetFields.includes(f.key)) return f;
        if (f.dependsOn === parentKey) return f; // already correct — idempotent
        changedCount++;
        return { ...f, dependsOn: parentKey };
      });

      for (const key of targetFields) {
        const entry = config[key];
        if (!entry) {
          console.warn(`  ${code}.${key}: no fieldOptionsConfig entry — leaving fieldsSchema-only change in place.`);
          continue;
        }
        if ("valueMap" in entry) continue; // already reshaped — idempotent
        const flatValues = [...entry.options];
        const valueMap: Record<string, string[]> = {};
        for (const pv of parentValues) valueMap[pv] = [...flatValues];
        config[key] = { valueMap };
      }

      report.push(`${code}: ${changedCount} field(s) newly wired to "${parentKey}" (of ${targetFields.length} checked)`);
      for (const key of targetFields) {
        const before = (ct.fieldsSchema as unknown as FieldEntry[]).find((f) => f.key === key)?.dependsOn ?? "(none)";
        const after = newSchema.find((f) => f.key === key)?.dependsOn ?? "(none)";
        report.push(`    ${key.padEnd(28)} ${before} -> ${after}`);
      }

      if (!dryRun && changedCount > 0) {
        await prisma.$transaction([
          prisma.componentType.update({ where: { id: ct.id }, data: { fieldsSchema: newSchema } }),
          prisma.componentTypeOrgConfig.update({ where: { componentTypeId: ct.id }, data: { fieldOptionsConfig: config } }),
        ]);
        report.push(`    -> written.`);
      } else if (!dryRun) {
        report.push(`    -> already correct, nothing to write.`);
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    console.log("\n──── fix-cloisons-catalog-dependson report ────");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) {
      console.log("!! RUN ABORTED by an unexpected error — DB state may be partial. Check and re-run if needed.");
    }
    for (const line of report) console.log(line);
    if (dryRun) console.log("\n(Dry run complete — no rows written. Re-run with --write to apply.)");
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
