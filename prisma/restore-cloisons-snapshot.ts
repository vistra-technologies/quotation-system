/**
 * Restore cloisons's REAL catalog from a known-good snapshot — 2026-09-30.
 *
 * Background: `npx prisma db seed` seeds cloisons's ComponentTypes/options/inventory from
 * `lib/component-catalog-seed.ts` (COMPONENT_TYPE_DEFS/COMPONENT_TYPE_ORG_CONFIG_DEFS) and
 * `prisma/inventory/cloisons-inventory.ts` (CLOISONS_INVENTORY_DEFS) — both of which are
 * *generic placeholder* definitions (synthetic codes like "DOOR-FRAME-01", "GLASS-ACGSK-01")
 * meant as an org-creation starter catalog, NOT cloisons's real customer data. Running the
 * cloisons rebuild via plain `npx prisma db seed` therefore left cloisons with wrong
 * inventory codes and none of the real ABCD product codes.
 *
 * The real, human-verified catalog was exported 2026-09-28 into
 *   quotation-system-docs/design-docs/formulas/cloisons/snapshots/2026-09-28-sat/
 *     component-types.json   — GLASS + DOOR fieldsSchema + fieldOptionsConfig
 *     inventory.json         — all 22 real InventoryItems (real ABCD/product codes)
 *     formula-set.json       — cloisons_formula_set v1 body (confirmed byte-identical to the
 *                               checked-in prisma/formula-sets/cloisons-formula-set-v1.json as
 *                               of 2026-09-30 — this script only creates it if missing, never
 *                               overwrites an existing (name, version), per the FormulaSet
 *                               immutability rule in design-docs/04-data-model.md)
 * This script applies those three files directly to one org (cloisons by default), instead of
 * going through the generic seed path. It is scoped ONLY to the target org — unlike
 * `npx prisma db seed`, it never touches any other org's rows.
 *
 * What it writes, per ComponentType in component-types.json (GLASS, DOOR):
 *   1. ComponentCategory — upsert by (organizationId, name).
 *   2. ComponentType — upsert by (organizationId, code): name, categoryId, fieldsSchema,
 *      active, sortOrder.
 *   3. ComponentTypeOrgConfig — upsert by componentTypeId (1:1): fieldOptionsConfig.
 * Then, per item in inventory.json:
 *   4. InventoryItem — upsert by (organizationId, code): name, category, measurementUnit,
 *      perUnitQuantity, active, attributes, componentTypeId (resolved from the item's
 *      `componentType` field against the ComponentTypes just upserted in step 2).
 * Then:
 *   5. FormulaSet — create (name, version) from formula-set.json's body if missing; if it
 *      already exists, only verify the body matches (warn, never overwrite — immutable).
 *   6. Organization.activeFormulaSetId — set to that FormulaSet's id.
 * Finally:
 *   4b. Prune leftover InventoryItems whose code is NOT in the snapshot — the snapshot is the
 *       org's complete inventory, not an additive patch (this is what required a manual UI
 *       cleanup of leftover generic-seed items after the first 2026-09-30 run). Default:
 *       deactivate (active: false) rather than hard-delete, since InventoryItem has real FK
 *       children (ItemPrice, Restrict from ComponentType) and deactivating is reversible.
 *       Pass --delete-extras to hard-delete instead (per-row failure is reported, not fatal).
 *
 * Safety (mirrors prisma/fix-cloisons-catalog-dependson.ts exactly):
 *   - DRY RUN IS THE DEFAULT — rows are written only when `--write` is passed.
 *   - EXPECT_ENDPOINT guard (`prisma/db-target-guard.ts`): defaults to dev endpoint;
 *     production requires `EXPECT_ENDPOINT=ep-little-paper-aipm0o0i` in the operator's shell.
 *
 * Usage (from quotation-system/, a checkout with this file present):
 *   npx tsx prisma/restore-cloisons-snapshot.ts               # dry run (default, safe)
 *   npx tsx prisma/restore-cloisons-snapshot.ts --write        # real run (deactivates extras)
 *   npx tsx prisma/restore-cloisons-snapshot.ts --write --delete-extras   # real run, hard-delete extras
 *   npx tsx prisma/restore-cloisons-snapshot.ts --org=<slug> --snapshot-dir=<path>   # override target
 *
 * Production:
 *   $env:DATABASE_URL    = <prod connection string>
 *   $env:EXPECT_ENDPOINT = "ep-little-paper-aipm0o0i"
 *   npx tsx prisma/restore-cloisons-snapshot.ts              # dry run on prod
 *   npx tsx prisma/restore-cloisons-snapshot.ts --write      # real run on prod
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describeTarget, enforceDbTarget } from "./db-target-guard";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const DEFAULT_SNAPSHOT_DIR = path.resolve(
  __dirname,
  "../../quotation-system-docs/design-docs/formulas/cloisons/snapshots/2026-09-28-sat",
);

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

/** Deterministic, key-order-independent hash — for the create-only FormulaSet check. */
function stableHash(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, normalize((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

interface SnapshotComponentType {
  code: string;
  name: string;
  category: string;
  active: boolean;
  sortOrder: number;
  fieldsSchema: unknown;
  fieldOptionsConfig: unknown;
}
interface SnapshotInventoryItem {
  code: string;
  name: string;
  componentType: string;
  category: string;
  measurementUnit: string;
  perUnitQuantity: number;
  active: boolean;
  attributes: Record<string, unknown>;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun = !process.argv.includes("--write");
  const orgSlug = argValue("org") ?? "cloisons";
  const snapshotDir = argValue("snapshot-dir") ?? DEFAULT_SNAPSHOT_DIR;

  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(dryRun ? "DRY RUN — nothing will be written. (Pass `--write` to write.)" : "REAL RUN (--write).");
  console.log(`Target org slug: ${orgSlug}`);
  console.log(`Snapshot dir: ${snapshotDir}`);

  const report: string[] = [];
  let aborted = false;

  try {
    if (!fs.existsSync(snapshotDir)) {
      console.error(`ABORT: snapshot dir not found: ${snapshotDir}`);
      process.exitCode = 1;
      return;
    }
    const componentTypesDoc = JSON.parse(
      fs.readFileSync(path.join(snapshotDir, "component-types.json"), "utf8"),
    ) as { componentTypes: SnapshotComponentType[] };
    const inventoryDoc = JSON.parse(
      fs.readFileSync(path.join(snapshotDir, "inventory.json"), "utf8"),
    ) as { items: SnapshotInventoryItem[] };
    const formulaSetDoc = JSON.parse(
      fs.readFileSync(path.join(snapshotDir, "formula-set.json"), "utf8"),
    ) as { name: string; version: number; body: unknown };

    const org = await prisma.organization.findFirst({ where: { slug: orgSlug } });
    if (!org) {
      console.error(`ABORT: no organization with slug '${orgSlug}' found on this DB target.`);
      process.exitCode = 1;
      return;
    }
    console.log(`${orgSlug} org id: ${org.id}`);

    // ── 1-3. ComponentCategory + ComponentType + ComponentTypeOrgConfig ─────────
    const componentTypeIdByCode = new Map<string, string>();
    for (const ctDef of componentTypesDoc.componentTypes) {
      const existingCat = await prisma.componentCategory.findFirst({
        where: { organizationId: org.id, name: ctDef.category },
      });
      let categoryId = existingCat?.id;
      if (!categoryId) {
        report.push(`ComponentCategory "${ctDef.category}": (missing) -> create`);
        if (!dryRun) {
          const created = await prisma.componentCategory.create({
            data: { organizationId: org.id, name: ctDef.category },
          });
          categoryId = created.id;
        }
      } else {
        report.push(`ComponentCategory "${ctDef.category}": exists (${categoryId})`);
      }

      const existingCt = await prisma.componentType.findFirst({
        where: { organizationId: org.id, code: ctDef.code },
      });
      report.push(
        `ComponentType ${ctDef.code}: ${existingCt ? "exists -> will overwrite fieldsSchema/name/sortOrder/active" : "(missing) -> create"}`,
      );

      let ctId = existingCt?.id;
      if (!dryRun) {
        if (!categoryId) throw new Error(`categoryId unresolved for ${ctDef.category} in a --write run`);
        const upserted = await prisma.componentType.upsert({
          where: { organizationId_code: { organizationId: org.id, code: ctDef.code } },
          update: {
            name: ctDef.name,
            categoryId,
            fieldsSchema: ctDef.fieldsSchema as object,
            active: ctDef.active,
            sortOrder: ctDef.sortOrder,
          },
          create: {
            organizationId: org.id,
            code: ctDef.code,
            name: ctDef.name,
            categoryId,
            fieldsSchema: ctDef.fieldsSchema as object,
            active: ctDef.active,
            sortOrder: ctDef.sortOrder,
          },
        });
        ctId = upserted.id;

        await prisma.componentTypeOrgConfig.upsert({
          where: { componentTypeId: upserted.id },
          update: { fieldOptionsConfig: ctDef.fieldOptionsConfig as object },
          create: {
            organizationId: org.id,
            componentTypeId: upserted.id,
            fieldOptionsConfig: ctDef.fieldOptionsConfig as object,
          },
        });
        report.push(`  -> ComponentType + ComponentTypeOrgConfig written.`);
      }
      if (ctId) componentTypeIdByCode.set(ctDef.code, ctId);
    }

    // ── 4. InventoryItem ──────────────────────────────────────────────────────
    let invCreated = 0;
    let invUpdated = 0;
    for (const item of inventoryDoc.items) {
      const componentTypeId = dryRun
        ? undefined // not resolvable in dry run unless the ComponentType already existed pre-run
        : componentTypeIdByCode.get(item.componentType);
      if (!dryRun && !componentTypeId) {
        report.push(`InventoryItem ${item.code}: ABORT — no ComponentType id resolved for "${item.componentType}"`);
        continue;
      }

      const existing = await prisma.inventoryItem.findFirst({
        where: { organizationId: org.id, code: item.code },
      });
      report.push(
        `InventoryItem ${item.code} (${item.name}): ${existing ? "exists -> will overwrite" : "(missing) -> create"}`,
      );

      if (!dryRun) {
        await prisma.inventoryItem.upsert({
          where: { organizationId_code: { organizationId: org.id, code: item.code } },
          update: {
            name: item.name,
            category: item.category,
            measurementUnit: item.measurementUnit,
            perUnitQuantity: item.perUnitQuantity,
            active: item.active,
            attributes: item.attributes as object,
            componentTypeId: componentTypeId!,
          },
          create: {
            organizationId: org.id,
            code: item.code,
            name: item.name,
            category: item.category,
            measurementUnit: item.measurementUnit,
            perUnitQuantity: item.perUnitQuantity,
            active: item.active,
            attributes: item.attributes as object,
            componentTypeId: componentTypeId!,
          },
        });
        if (existing) invUpdated++;
        else invCreated++;
      }
    }
    if (!dryRun) report.push(`InventoryItems: ${invCreated} created, ${invUpdated} updated.`);

    // ── 4b. Prune leftover InventoryItems not in the snapshot ────────────────
    // The snapshot is meant to be the org's COMPLETE inventory, not an additive patch — extra
    // rows left over from an earlier generic seed (or any other prior state) are exactly what
    // caused the "extra inventory items" cleanup you had to do by hand in the UI on 2026-09-30.
    // Default behavior is to DEACTIVATE (active: false) rather than hard-delete: InventoryItem
    // has real FK children (ItemPrice, and a Restrict relation from ComponentType), and a
    // deactivated item simply stops being offerable in the Inventory UI / selectable by new
    // Selections, without risking an FK error or destroying price history. Pass
    // --delete-extras to hard-delete instead (only safe if you've confirmed nothing references
    // them — the DB's onDelete: Restrict will refuse and this script will report the failure
    // per-row rather than aborting the whole run).
    const snapshotCodes = new Set(inventoryDoc.items.map((i) => i.code));
    const allOrgItems = await prisma.inventoryItem.findMany({
      where: { organizationId: org.id },
      select: { id: true, code: true, name: true, active: true },
    });
    const extras = allOrgItems.filter((i) => !snapshotCodes.has(i.code));
    const hardDeleteExtras = process.argv.includes("--delete-extras");

    if (extras.length === 0) {
      report.push(`Leftover InventoryItems not in snapshot: none.`);
    } else {
      report.push(
        `Leftover InventoryItems not in snapshot: ${extras.length} (${hardDeleteExtras ? "will hard-delete (--delete-extras)" : "will deactivate — pass --delete-extras to hard-delete instead"})`,
      );
      for (const extra of extras) {
        report.push(`  ${extra.code} (${extra.name})${extra.active ? "" : " [already inactive]"}`);
        if (!dryRun) {
          if (hardDeleteExtras) {
            try {
              await prisma.inventoryItem.delete({ where: { id: extra.id } });
              report.push(`    -> deleted.`);
            } catch (err) {
              report.push(`    -> DELETE FAILED (likely referenced elsewhere — left as-is): ${(err as Error).message}`);
            }
          } else if (extra.active) {
            await prisma.inventoryItem.update({ where: { id: extra.id }, data: { active: false } });
            report.push(`    -> deactivated.`);
          }
        }
      }
    }

    // ── 5-6. FormulaSet + Organization.activeFormulaSetId ────────────────────
    const existingFs = await prisma.formulaSet.findUnique({
      where: { name_version: { name: formulaSetDoc.name, version: formulaSetDoc.version } },
    });
    let formulaSetId = existingFs?.id;
    if (!existingFs) {
      report.push(`FormulaSet ${formulaSetDoc.name} v${formulaSetDoc.version}: (missing) -> create`);
      if (!dryRun) {
        const created = await prisma.formulaSet.create({
          data: {
            name: formulaSetDoc.name,
            version: formulaSetDoc.version,
            body: formulaSetDoc.body as object,
            publishedAt: new Date(),
          },
        });
        formulaSetId = created.id;
      }
    } else {
      const same = stableHash(existingFs.body) === stableHash(formulaSetDoc.body);
      report.push(
        `FormulaSet ${formulaSetDoc.name} v${formulaSetDoc.version}: already exists, body ${same ? "matches snapshot (no write needed)" : "DIFFERS FROM SNAPSHOT — not overwritten (immutable); a new version is needed if the snapshot's body should win"}`,
      );
    }
    if (formulaSetId) {
      report.push(`Organization.activeFormulaSetId -> ${formulaSetDoc.name} v${formulaSetDoc.version} (${formulaSetId})`);
      if (!dryRun) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { activeFormulaSetId: formulaSetId },
        });
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    console.log("\n──── restore-cloisons-snapshot report ────");
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
