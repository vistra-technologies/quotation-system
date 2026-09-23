/**
 * One-time reseed of `InventoryItem` (and cascaded `ItemPrice`) for the `cloisons` org only.
 * Stage 24 production runbook Step 4.
 *
 * What it does:
 *   1. Find the `cloisons` organization — ABORT if not found.
 *   2. Count and (in write mode) DELETE all existing `InventoryItem` rows for that org.
 *      `ItemPrice` rows cascade-delete automatically (FK `onDelete: Cascade` in schema).
 *   3. INSERT the 22 `CLOISONS_INVENTORY_DEFS` as fresh rows.
 *
 * After this step, cloisons has exactly 22 items.
 * After the subsequent `prisma db seed` (Step 5), cloisons will have 34 (22 + 12 standard).
 *
 * Safety (mirrors prisma/backfill-formula-set-pins.ts exactly):
 *   - DRY RUN IS THE DEFAULT — rows are written only when `--write` is passed.
 *   - EXPECT_ENDPOINT guard (`prisma/db-target-guard.ts`): defaults to dev endpoint;
 *     production requires `EXPECT_ENDPOINT=ep-little-paper-aipm0o0i` in the operator's shell.
 *   - Env precedence: real env > .env.local > .env (dotenv never overrides an already-set var).
 *   - `--write` MUST come after `--` when invoked via `npm run` (npm otherwise swallows it).
 *
 * Usage (from quotation-system/):
 *   npx tsx prisma/seed-inventory-cloisons.ts            # dry run (default, safe)
 *   npx tsx prisma/seed-inventory-cloisons.ts --write    # real run (dev DB only without EXPECT_ENDPOINT)
 *
 * Production:
 *   $env:DATABASE_URL    = <prod connection string>
 *   $env:EXPECT_ENDPOINT = "ep-little-paper-aipm0o0i"
 *   npx tsx prisma/seed-inventory-cloisons.ts            # dry run on prod
 *   npx tsx prisma/seed-inventory-cloisons.ts --write    # real run on prod
 */
import dotenv from "dotenv";
import { describeTarget, enforceDbTarget } from "./db-target-guard";
import { CLOISONS_INVENTORY_DEFS } from "./inventory/cloisons-inventory";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  // Loaded only after the guards, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `--write` to write.)"
      : "REAL RUN (--write) — cloisons InventoryItems will be truncated and reseeded.",
  );
  console.log(`Items to insert: ${CLOISONS_INVENTORY_DEFS.length}`);

  let existingCount = 0;
  let existingPriceCount = 0;
  let deleted = 0;
  let inserted = 0;
  let aborted = false;

  try {
    // ── Find cloisons org ───────────────────────────────────────────────────────
    const cloisonsOrg = await prisma.organization.findFirst({
      where: { slug: "cloisons" },
      select: { id: true, slug: true },
    });
    if (!cloisonsOrg) {
      console.error("ABORT: cloisons org not found in this database. Nothing written.");
      process.exitCode = 1;
      return;
    }
    console.log(`Cloisons org: ${cloisonsOrg.slug} (${cloisonsOrg.id})`);

    // ── Count existing rows ─────────────────────────────────────────────────────
    existingCount = await prisma.inventoryItem.count({
      where: { organizationId: cloisonsOrg.id },
    });
    // ItemPrice cascades from InventoryItem — count for reporting only.
    existingPriceCount = await prisma.itemPrice.count({
      where: { organizationId: cloisonsOrg.id },
    });
    console.log(
      `\nExisting rows for cloisons: ${existingCount} InventoryItem, ${existingPriceCount} ItemPrice (will cascade-delete)`,
    );

    if (!dryRun) {
      // ── Delete existing cloisons InventoryItem rows (ItemPrice cascades) ────────
      const deleteResult = await prisma.inventoryItem.deleteMany({
        where: { organizationId: cloisonsOrg.id },
      });
      deleted = deleteResult.count;
      console.log(`Deleted: ${deleted} InventoryItem rows (ItemPrice cascaded automatically)`);

      // ── Insert CLOISONS_INVENTORY_DEFS ─────────────────────────────────────────
      for (const def of CLOISONS_INVENTORY_DEFS) {
        await prisma.inventoryItem.create({
          data: {
            organizationId: cloisonsOrg.id,
            code: def.code,
            name: def.name,
            category: def.category,
            measurementUnit: def.measurementUnit,
            perUnitQuantity: def.perUnitQuantity,
            active: def.active,
            attributes: {},
          },
        });
        inserted++;
      }
    } else {
      // Dry run: report what would happen
      console.log(`Would delete: ${existingCount} InventoryItem rows (${existingPriceCount} ItemPrice cascaded)`);
      console.log(`Would insert: ${CLOISONS_INVENTORY_DEFS.length} InventoryItem rows`);
      for (const def of CLOISONS_INVENTORY_DEFS) {
        console.log(
          `  ${def.code.padEnd(20)} perUnitQuantity=${def.perUnitQuantity}  ${def.measurementUnit}`,
        );
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    console.log("\n──── seed-inventory-cloisons report ────");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) {
      console.log(
        "!! RUN ABORTED by an unexpected error — DB state may be partial. Check and re-run if needed.",
      );
    }
    if (!dryRun) {
      console.log(`InventoryItem rows deleted: ${deleted}`);
      console.log(`InventoryItem rows inserted: ${inserted}`);
      console.log(`Expected post-step count (cloisons): ${inserted} (run Step 5 'prisma db seed' to reach 34 total)`);
    } else {
      console.log("(Dry run complete — no rows written.)");
    }
    if (aborted || (!dryRun && inserted !== CLOISONS_INVENTORY_DEFS.length)) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
