/**
 * One-time backfill of `InventoryItem.componentTypeId` (Hotfix 2026-09-27 H-17).
 *
 * Context:
 *   H-17 adds a real FK (InventoryItem.componentTypeId → ComponentType.id) to replace
 *   the free-text `category` field as the Component selector in the UI. This script
 *   sets componentTypeId on existing InventoryItem rows whose codes appear as option
 *   values in a ComponentType's `*Code` dropdown fields (sourced from
 *   ComponentTypeOrgConfig.fieldOptionsConfig).
 *
 *   Items whose codes do NOT appear in any *Code field option (legacy items predating
 *   the material-code system) are left with componentTypeId = NULL — correct and
 *   consistent with the nullable schema design.
 *
 * Mapping verified against dev DB (2026-09-27):
 *   The `cloisons` org has 2 ComponentTypes: GLASS (id: 8c502779-...) and DOOR (id: d4b3addf-...).
 *   22 out of 36 InventoryItem rows map to one of these two types via *Code field options.
 *   14 legacy items (GL-001, DT-001, FT-001, etc.) have no *Code match → stay NULL.
 *
 * Safety (matches backfill-formula-set-pins.ts pattern exactly):
 *   - DRY RUN IS THE DEFAULT. Pass `-- --write` to actually write rows.
 *   - Fail-closed destination guard (prisma/db-target-guard.ts): DATABASE_URL must resolve
 *     to the dev Neon endpoint by default; production only with explicit EXPECT_ENDPOINT opt-in.
 *   - Only rows with componentTypeId IS NULL are candidates; already-set rows are never overwritten.
 *   - Idempotent: a second run finds no NULL rows with mappable codes and writes nothing.
 *   - One row failing does not stop the run; failures are listed; exit code is non-zero on any failure.
 *
 * Usage (from quotation-system/ or quotation-system-hotfix-stage27/):
 *   npm run backfill:inventory-component-type                   # dry run (safe default)
 *   npm run backfill:inventory-component-type -- --write        # real run (dev DB only, with human go-ahead)
 *   EXPECT_ENDPOINT=ep-little-paper-aipm0o0i npm run backfill:inventory-component-type -- --write
 *       # production run — human only, see development-cycles/stage-27-hotfix-prod-runbook.md
 */
import dotenv from "dotenv";
import { describeTarget, enforceDbTarget } from "./db-target-guard";

// Same precedence as Next: real env > .env.local > .env
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) — componentTypeId will be written.",
  );

  let totalItems = 0;
  let candidates = 0;
  let filled = 0;
  let alreadyHad = 0;
  let noMapping = 0;
  const failures: string[] = [];
  let aborted = false;

  try {
    // Load all orgs
    const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } });
    console.log(`\nOrganizations: ${orgs.map((o) => o.slug).join(", ")}`);

    // Load all ComponentTypes with their OrgConfig (field option values)
    const allComponentTypes = await prisma.componentType.findMany({
      select: {
        id: true,
        organizationId: true,
        code: true,
        orgConfig: { select: { fieldOptionsConfig: true } },
      },
    });

    // Build a map: orgId → Map<itemCode, componentTypeId>
    // For each ComponentType per org, scan its fieldOptionsConfig for *Code fields
    // and collect all option values (these are item codes).
    const orgItemCodeToTypeId = new Map<string, Map<string, string>>();

    for (const ct of allComponentTypes) {
      if (!orgItemCodeToTypeId.has(ct.organizationId)) {
        orgItemCodeToTypeId.set(ct.organizationId, new Map());
      }
      const codeMap = orgItemCodeToTypeId.get(ct.organizationId)!;

      const fieldOptions = ct.orgConfig?.fieldOptionsConfig as Record<
        string,
        { options?: string[] } | { valueMap?: Record<string, string[]> }
      > | null;

      if (!fieldOptions) continue;

      for (const [fieldKey, fieldConfig] of Object.entries(fieldOptions)) {
        // Only process fields whose option values are inventory item codes.
        // These are:
        //   - *Code fields (frameCode, leafCode, acousticGasketCode, etc.)
        //   - *_profile fields (u_profile, i_profile, l_profile) — their options are product codes
        //     like "I LUF-01", "I10 PDL" which are real InventoryItem rows.
        // Non-code fields (category, glassType, doorType, thickness, hasFrame, etc.) hold
        // display values / classification strings, not inventory item codes.
        const isItemCodeField =
          fieldKey.endsWith("Code") ||
          fieldKey.endsWith("_profile");
        if (!isItemCodeField) continue;

        const fc = fieldConfig as { options?: string[]; valueMap?: Record<string, string[]> };

        if (fc.options) {
          for (const code of fc.options) {
            if (codeMap.has(code)) {
              const existingTypeId = codeMap.get(code)!;
              const existingCt = allComponentTypes.find((c) => c.id === existingTypeId);
              console.warn(
                `[WARN] Item code "${code}" appears in both ComponentType "${existingCt?.code ?? existingTypeId}" and "${ct.code}" — last-writer-wins (${ct.code} will win).`,
              );
            }
            codeMap.set(code, ct.id);
          }
        } else if (fc.valueMap) {
          for (const codes of Object.values(fc.valueMap)) {
            for (const code of codes) {
              if (codeMap.has(code)) {
                const existingTypeId = codeMap.get(code)!;
                const existingCt = allComponentTypes.find((c) => c.id === existingTypeId);
                console.warn(
                  `[WARN] Item code "${code}" appears in both ComponentType "${existingCt?.code ?? existingTypeId}" and "${ct.code}" — last-writer-wins (${ct.code} will win).`,
                );
              }
              codeMap.set(code, ct.id);
            }
          }
        }
      }
    }

    // Summarise the mapping
    for (const [orgId, codeMap] of orgItemCodeToTypeId.entries()) {
      const org = orgs.find((o) => o.id === orgId);
      console.log(`\n[${org?.slug ?? orgId}] ${codeMap.size} item codes mapped from *Code field options:`);
      for (const [code, typeId] of codeMap.entries()) {
        const ct = allComponentTypes.find((c) => c.id === typeId);
        console.log(`  ${code} → ${ct?.code ?? typeId}`);
      }
    }

    // Load all InventoryItems with NULL componentTypeId
    const allItems = await prisma.inventoryItem.findMany({
      select: { id: true, organizationId: true, code: true, componentTypeId: true },
      orderBy: [{ organizationId: "asc" }, { code: "asc" }],
    });
    totalItems = allItems.length;

    const nullItems = allItems.filter((i) => i.componentTypeId === null);
    candidates = nullItems.length;

    console.log(`\nInventoryItems total: ${totalItems}`);
    console.log(`With NULL componentTypeId (candidates): ${candidates}`);

    for (const item of nullItems) {
      const codeMap = orgItemCodeToTypeId.get(item.organizationId);
      const targetTypeId = codeMap?.get(item.code) ?? null;

      if (!targetTypeId) {
        noMapping++;
        // Not an error — these are legacy items with no *Code field match.
        continue;
      }

      try {
        if (dryRun) {
          const ct = allComponentTypes.find((c) => c.id === targetTypeId);
          console.log(`  [dry-run] would set ${item.code} → ${ct?.code ?? targetTypeId}`);
          filled++;
          continue;
        }
        // Write only if still NULL (guard against concurrent writes).
        const res = await prisma.inventoryItem.updateMany({
          where: { id: item.id, componentTypeId: null },
          data: { componentTypeId: targetTypeId },
        });
        if (res.count > 0) {
          filled++;
        } else {
          alreadyHad++;
        }
      } catch (err) {
        failures.push(
          `${item.code} (${item.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n──── InventoryItem componentTypeId backfill report ────");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) {
      console.log("!! RUN ABORTED — counts below are PARTIAL. Re-run is safe (idempotent).");
    }
    console.log(`\nInventoryItems total:                 ${totalItems}`);
    console.log(`Candidates (NULL componentTypeId):    ${candidates}`);
    console.log(`${dryRun ? "Would set" : "Set"}:                          ${filled}`);
    console.log(`Already had a value (skipped):        ${alreadyHad}`);
    console.log(`No *Code mapping (stay NULL, correct): ${noMapping}`);
    console.log(`Failures: ${failures.length}${list(failures)}`);

    if (failures.length || aborted) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /backfill-inventory-component-type\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
