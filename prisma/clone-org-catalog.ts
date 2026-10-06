/**
 * Clone one org's catalog into another — built 2026-10-06 to stand up the `vistra` demo org as an
 * exact replica of live `cloisons` (ComponentTypes, option values, inventory, prices).
 *
 * What it does, in ONE transaction, scoped to --from (read-only) and --to (written):
 *   1. Read --from's ComponentCategory / ComponentType / ComponentTypeOrgConfig / InventoryItem /
 *      ItemPrice rows. --from is never written.
 *   2. Wipe --to's tenant data in the FK-safe order used by the org hard-delete
 *      (lib/data/superadmin/orgs.ts): selections, partitions, rooms, floors, project calculations,
 *      projects, inquiries, item prices, inventory, org configs, component types, categories.
 *      KEPT: Organization row, User/Session/Account, Role/RolePermission, ExternalCompany.
 *   3. Insert copies with fresh ids, FKs remapped (categoryId, componentTypeId, inventoryItemId).
 *   4. Point --to's activeFormulaSetId at --from's (FormulaSets are platform-level + immutable, so
 *      shared, not copied).
 *   5. Verify: re-read both orgs and diff the catalog field-by-field by natural key; a mismatch
 *      throws, which rolls the whole transaction back.
 *
 * Safety:
 *   - DRY RUN IS THE DEFAULT — the transaction is always rolled back unless `--write` is passed.
 *   - --to must be exactly "vistra" (hard-coded allow-list); --from must differ and both must exist.
 *   - EXPECT_ENDPOINT guard (prisma/db-target-guard.ts): prod needs EXPECT_ENDPOINT=ep-little-paper-aipm0o0i.
 *   - Touches no other org and no global data (FormulaSet rows are only referenced, never changed).
 *
 * Usage (from quotation-system/):
 *   npx tsx prisma/clone-org-catalog.ts                 # dry run (cloisons -> vistra)
 *   npx tsx prisma/clone-org-catalog.ts --write         # real run
 *   npx tsx prisma/clone-org-catalog.ts --from=cloisons --to=vistra
 * Runbook: quotation-system-docs/development-cycles/clone-cloisons-to-vistra-runbook.md
 */
import dotenv from "dotenv";
import crypto from "node:crypto";
import { describeTarget, enforceDbTarget } from "./db-target-guard";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

/** The only org this script may write to. */
export const ALLOWED_TARGET_SLUG = "vistra";

export interface SourceCategory { id: string; name: string }
export interface SourceComponentType {
  id: string; code: string; name: string; categoryId: string;
  fieldsSchema: unknown; active: boolean; sortOrder: number;
}
export interface SourceOrgConfig { componentTypeId: string; fieldOptionsConfig: unknown }
export interface SourceItem {
  id: string; code: string; name: string; category: string; measurementUnit: string;
  perUnitQuantity: unknown; attributes: unknown; active: boolean; componentTypeId: string | null;
}
export interface SourcePrice { inventoryItemId: string; currency: string; price: unknown }

export interface CatalogSource {
  categories: SourceCategory[];
  componentTypes: SourceComponentType[];
  orgConfigs: SourceOrgConfig[];
  items: SourceItem[];
  prices: SourcePrice[];
}

export interface CopyPlan {
  categories: { id: string; organizationId: string; name: string }[];
  componentTypes: {
    id: string; organizationId: string; code: string; name: string; categoryId: string;
    fieldsSchema: unknown; active: boolean; sortOrder: number;
  }[];
  orgConfigs: { id: string; organizationId: string; componentTypeId: string; fieldOptionsConfig: unknown }[];
  items: {
    id: string; organizationId: string; code: string; name: string; category: string;
    measurementUnit: string; perUnitQuantity: unknown; attributes: unknown; active: boolean;
    componentTypeId: string | null;
  }[];
  prices: { id: string; organizationId: string; inventoryItemId: string; currency: string; price: unknown }[];
}

/** Pure: turn a read of the source org into insert rows for the target org, with fresh ids + remapped FKs. */
export function buildCopyPlan(
  src: CatalogSource,
  targetOrgId: string,
  newId: () => string = () => crypto.randomUUID(),
): CopyPlan {
  const catId = new Map<string, string>();
  const ctId = new Map<string, string>();
  const itemId = new Map<string, string>();
  const need = (m: Map<string, string>, k: string, what: string): string => {
    const v = m.get(k);
    if (!v) throw new Error(`Dangling ${what} reference: ${k}`);
    return v;
  };

  const categories = src.categories.map((c) => {
    const id = newId();
    catId.set(c.id, id);
    return { id, organizationId: targetOrgId, name: c.name };
  });
  const componentTypes = src.componentTypes.map((t) => {
    const id = newId();
    ctId.set(t.id, id);
    return {
      id, organizationId: targetOrgId, code: t.code, name: t.name,
      categoryId: need(catId, t.categoryId, "category"),
      fieldsSchema: t.fieldsSchema, active: t.active, sortOrder: t.sortOrder,
    };
  });
  const orgConfigs = src.orgConfigs.map((c) => ({
    id: newId(), organizationId: targetOrgId,
    componentTypeId: need(ctId, c.componentTypeId, "componentType"),
    fieldOptionsConfig: c.fieldOptionsConfig,
  }));
  const items = src.items.map((i) => {
    const id = newId();
    itemId.set(i.id, id);
    return {
      id, organizationId: targetOrgId, code: i.code, name: i.name, category: i.category,
      measurementUnit: i.measurementUnit, perUnitQuantity: i.perUnitQuantity,
      attributes: i.attributes, active: i.active,
      componentTypeId: i.componentTypeId === null ? null : need(ctId, i.componentTypeId, "componentType"),
    };
  });
  const prices = src.prices.map((p) => ({
    id: newId(), organizationId: targetOrgId,
    inventoryItemId: need(itemId, p.inventoryItemId, "inventoryItem"),
    currency: p.currency, price: p.price,
  }));
  return { categories, componentTypes, orgConfigs, items, prices };
}

/** Deterministic, key-order-independent serialisation (JSONB comes back in arbitrary key order). */
export function canon(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    // Prisma Decimal (and anything else with a stable string form) compares by its string value.
    return v !== null && typeof v === "object" ? String(v) : v;
  };
  return JSON.stringify(norm(value));
}

/**
 * Pure: field-by-field diff of two catalogs by natural key (names/codes, never ids).
 * Returns human-readable mismatches; empty array means identical.
 */
export function diffCatalogs(a: CatalogSource, b: CatalogSource): string[] {
  const out: string[] = [];
  const catName = (s: CatalogSource, id: string | null) =>
    id === null ? null : s.categories.find((c) => c.id === id)?.name ?? `?${id}`;
  const typeCode = (s: CatalogSource, id: string | null) =>
    id === null ? null : s.componentTypes.find((t) => t.id === id)?.code ?? `?${id}`;
  const itemCode = (s: CatalogSource, id: string) => s.items.find((i) => i.id === id)?.code ?? `?${id}`;

  const project = (s: CatalogSource) => ({
    categories: s.categories.map((c) => c.name).sort(),
    types: Object.fromEntries(s.componentTypes.map((t) => [t.code, {
      name: t.name, category: catName(s, t.categoryId), fieldsSchema: t.fieldsSchema,
      active: t.active, sortOrder: t.sortOrder,
    }])),
    configs: Object.fromEntries(s.orgConfigs.map((c) => [typeCode(s, c.componentTypeId), c.fieldOptionsConfig])),
    items: Object.fromEntries(s.items.map((i) => [i.code, {
      name: i.name, category: i.category, measurementUnit: i.measurementUnit,
      perUnitQuantity: i.perUnitQuantity, attributes: i.attributes, active: i.active,
      componentType: typeCode(s, i.componentTypeId),
    }])),
    prices: Object.fromEntries(s.prices.map((p) => [`${itemCode(s, p.inventoryItemId)}|${p.currency}`, p.price])),
  });
  const pa = project(a);
  const pb = project(b);

  if (canon(pa.categories) !== canon(pb.categories)) out.push("categories differ");
  for (const section of ["types", "configs", "items", "prices"] as const) {
    const ra = pa[section] as Record<string, unknown>;
    const rb = pb[section] as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      if (!(k in ra)) out.push(`${section} "${k}": only in target`);
      else if (!(k in rb)) out.push(`${section} "${k}": missing in target`);
      else if (canon(ra[k]) !== canon(rb[k])) out.push(`${section} "${k}": values differ`);
    }
  }
  return out;
}

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((x) => x.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

class DryRunRollback extends Error {}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun = !process.argv.includes("--write");
  const fromSlug = argValue("from") ?? "cloisons";
  const toSlug = argValue("to") ?? ALLOWED_TARGET_SLUG;

  console.log(describeTarget(target));
  console.log(dryRun ? "DRY RUN — nothing will be written. (Pass `--write` to write.)" : "REAL RUN (--write).");
  console.log(`Clone catalog: ${fromSlug} -> ${toSlug}`);

  if (toSlug !== ALLOWED_TARGET_SLUG) {
    console.error(`ABORT: --to must be "${ALLOWED_TARGET_SLUG}" (got "${toSlug}").`);
    process.exitCode = 1;
    return;
  }
  if (fromSlug === toSlug) {
    console.error("ABORT: --from and --to must differ.");
    process.exitCode = 1;
    return;
  }

  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  type Db = Pick<InstanceType<typeof PrismaClient>, "componentCategory" | "componentType" | "componentTypeOrgConfig" | "inventoryItem" | "itemPrice">;
  const readCatalog = async (db: Db, orgId: string): Promise<CatalogSource> => ({
    categories: await db.componentCategory.findMany({ where: { organizationId: orgId } }),
    componentTypes: await db.componentType.findMany({ where: { organizationId: orgId } }),
    orgConfigs: await db.componentTypeOrgConfig.findMany({ where: { organizationId: orgId } }),
    items: await db.inventoryItem.findMany({ where: { organizationId: orgId } }),
    prices: await db.itemPrice.findMany({ where: { organizationId: orgId } }),
  });
  const counts = (c: CatalogSource) =>
    `categories=${c.categories.length} componentTypes=${c.componentTypes.length} ` +
    `orgConfigs=${c.orgConfigs.length} items=${c.items.length} prices=${c.prices.length}`;

  try {
    const from = await prisma.organization.findFirst({ where: { slug: fromSlug } });
    const to = await prisma.organization.findFirst({ where: { slug: toSlug } });
    if (!from || !to) {
      console.error(`ABORT: org not found (from=${from ? "ok" : "MISSING"}, to=${to ? "ok" : "MISSING"}).`);
      process.exitCode = 1;
      return;
    }
    console.log(`from ${fromSlug}: ${from.id}\nto   ${toSlug}: ${to.id}`);

    try {
      await prisma.$transaction(async (tx) => {
        const src = await readCatalog(tx, from.id);
        console.log(`Source  (${fromSlug}): ${counts(src)}`);
        console.log(`Target before (${toSlug}): ${counts(await readCatalog(tx, to.id))}`);
        const wipe = {
          selection: await tx.selection.count({ where: { organizationId: to.id } }),
          partition: await tx.partition.count({ where: { organizationId: to.id } }),
          room: await tx.room.count({ where: { organizationId: to.id } }),
          floor: await tx.floor.count({ where: { organizationId: to.id } }),
          project: await tx.project.count({ where: { organizationId: to.id } }),
          inquiry: await tx.inquiry.count({ where: { organizationId: to.id } }),
        };
        console.log(`Target tenant data to delete: ${JSON.stringify(wipe)}`);

        const plan = buildCopyPlan(src, to.id);

        // Wipe — children before parents (mirrors lib/data/superadmin/orgs.ts).
        const w = { organizationId: to.id };
        await tx.selection.deleteMany({ where: w });
        await tx.partition.deleteMany({ where: w });
        await tx.room.deleteMany({ where: w });
        await tx.floor.deleteMany({ where: w });
        await tx.projectCalculation.deleteMany({ where: w });
        await tx.project.deleteMany({ where: w });
        await tx.inquiry.deleteMany({ where: w });
        await tx.itemPrice.deleteMany({ where: w });
        await tx.inventoryItem.deleteMany({ where: w });
        await tx.componentTypeOrgConfig.deleteMany({
          where: { OR: [w, { componentType: { organizationId: to.id } }] },
        });
        await tx.componentType.deleteMany({ where: w });
        await tx.componentCategory.deleteMany({ where: w });

        // Insert — parents before children.
        await tx.componentCategory.createMany({ data: plan.categories });
        await tx.componentType.createMany({
          data: plan.componentTypes.map((t) => ({ ...t, fieldsSchema: t.fieldsSchema as object })),
        });
        await tx.componentTypeOrgConfig.createMany({
          data: plan.orgConfigs.map((c) => ({ ...c, fieldOptionsConfig: c.fieldOptionsConfig as object })),
        });
        await tx.inventoryItem.createMany({
          data: plan.items.map((i) => ({
            ...i, attributes: i.attributes as object, perUnitQuantity: i.perUnitQuantity as string,
          })),
        });
        await tx.itemPrice.createMany({
          data: plan.prices.map((p) => ({ ...p, price: p.price as string })),
        });
        await tx.organization.update({
          where: { id: to.id },
          data: { activeFormulaSetId: from.activeFormulaSetId },
        });

        // Verify — any mismatch throws and rolls everything back.
        const after = await readCatalog(tx, to.id);
        console.log(`Target after  (${toSlug}): ${counts(after)}`);
        const diffs = diffCatalogs(await readCatalog(tx, from.id), after);
        if (diffs.length) throw new Error(`Verification failed:\n  ${diffs.join("\n  ")}`);
        console.log("Verification: catalogs identical (field-by-field, by natural key).");
        console.log(`activeFormulaSetId: ${from.activeFormulaSetId ?? "null"} (same as ${fromSlug})`);

        if (dryRun) throw new DryRunRollback();
      }, { timeout: 120_000, maxWait: 20_000 });
      console.log("COMMITTED.");
    } catch (e) {
      if (e instanceof DryRunRollback) console.log("DRY RUN complete — transaction rolled back, nothing written.");
      else throw e;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /clone-org-catalog\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
