/**
 * One-time back-fill of default glass (Stage 34 S34-7, prod runbook R2).
 *
 * From Stage 34 on, a glass cell with no Selection is saved as the project's default glass (its first GLASS
 * Selection, lowest orderIndex then oldest) and the first glass Selection back-fills the null glass cells of
 * the partitions that already exist. Projects created before that still hold null glass cells. This script
 * fills them with the same rule (lib/partition-design.ts `fillDefaultGlass`; door cells are never touched).
 *
 * Which projects are touched:
 *   - eligible: status DRAFT, has a GLASS Selection, has v2 partitions with null glass cells -> filled.
 *   - listed but NOT touched: v1 designs (`panels`, no `sections`); non-DRAFT projects with null glass cells;
 *     projects with null glass cells but no GLASS Selection.
 *
 * Safety (mirrors prisma/backfill-config-snapshots.ts):
 *   - DRY RUN IS THE DEFAULT. Rows are written only with `--write`; `--dry-run` and npm's own `--dry-run`
 *     config always win. npm swallows unknown flags placed before `--`, so `--write` goes after it.
 *   - Fail-closed destination guard (prisma/db-target-guard.ts): dev Neon endpoint by default; production
 *     only with EXPECT_ENDPOINT=ep-little-paper-aipm0o0i in the operator's own shell AND equal to the URL's
 *     endpoint. The client is built only after the guard. DATABASE_URL is never printed.
 *   - One transaction per project; designs and the default glass are re-read INSIDE it, so a re-run or a
 *     concurrent edit is safe. Only null cells are written -> idempotent and resumable (a re-run skips
 *     done projects; the dry run after an apply reports 0 fillable). The calculation is invalidated only
 *     when something changed (the design changed under a submitted project).
 *   - One project failing does not stop the run; failures are listed and the exit code is non-zero.
 *
 * Usage (from quotation-system/):
 *   npm run backfill:default-glass                                  # dry run, all projects (default)
 *   npm run backfill:default-glass -- --write                       # apply (human go-ahead only)
 *   npm run backfill:default-glass -- --project=<projectId> [--write]
 */
import dotenv from "dotenv";
import { describeTarget, enforceDbTarget } from "./db-target-guard";
import { isGlassCell, type DesignSectionV2 } from "../lib/partition-design";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

export type FillClass = "ELIGIBLE" | "NOTHING" | "SKIP_V1" | "SKIP_NOT_DRAFT" | "SKIP_NO_GLASS";

export interface FillPlan {
  cls: FillClass;
  /** Null glass cells that would be filled (ELIGIBLE) or that exist but are left alone (SKIP_*). */
  nullGlassCells: number;
  v1Designs: number;
}

/** Null glass cells in a stored design: v2 `sections` only; anything else is v1/empty (counted separately). */
export function countNullGlassCells(design: unknown): { v2: boolean; v1: boolean; cells: number } {
  const d = design as { schemaVersion?: unknown; sections?: unknown; panels?: unknown } | null;
  if (d && d.schemaVersion === 2 && Array.isArray(d.sections)) {
    let cells = 0;
    for (const s of d.sections as DesignSectionV2[]) {
      if (!s || !Array.isArray(s.cells)) continue;
      s.cells.forEach((c, i) => {
        if (c && !c.selectionId && isGlassCell(s, i)) cells++;
      });
    }
    return { v2: true, v1: false, cells };
  }
  return { v2: false, v1: !!d && Array.isArray(d.panels), cells: 0 };
}

/** Pure classification of one project (no DB). */
export function planProjectFill(status: string, hasGlass: boolean, designs: unknown[]): FillPlan {
  let nullGlassCells = 0;
  let v1Designs = 0;
  for (const design of designs) {
    const r = countNullGlassCells(design);
    nullGlassCells += r.cells;
    if (r.v1) v1Designs++;
  }
  let cls: FillClass;
  if (nullGlassCells === 0) cls = v1Designs > 0 ? "SKIP_V1" : "NOTHING";
  else if (status !== "DRAFT") cls = "SKIP_NOT_DRAFT";
  else if (!hasGlass) cls = "SKIP_NO_GLASS";
  else cls = "ELIGIBLE";
  return { cls, nullGlassCells, v1Designs };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  const arg = process.argv.find((a) => a === "--project" || a.startsWith("--project="));
  const flagId = arg && arg.includes("=") ? arg.slice(arg.indexOf("=") + 1).trim() : "";
  if (process.env.npm_config_project && process.env.npm_config_project !== flagId) {
    console.error(
      `ABORT: npm swallowed --project=${process.env.npm_config_project} (it must come after \`--\`). ` +
        "Use: npm run backfill:default-glass -- --project=<id> [--write]",
    );
    process.exit(1);
  }
  if (arg && !flagId) {
    console.error("ABORT: --project=<projectId> requires a non-empty id (got an empty value).");
    process.exit(1);
  }

  // Loaded only after the guards, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { findDefaultGlassSelectionId, fillProjectNullGlass } = await import("../lib/data/default-glass");
  const { invalidateProjectCalculation } = await import("../lib/data/formula-pin");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN - nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) - default glass will be written.",
  );
  if (flagId) console.log(`Restricted to single project: ${flagId}`);

  const counts: Record<FillClass, number> = {
    ELIGIBLE: 0,
    NOTHING: 0,
    SKIP_V1: 0,
    SKIP_NOT_DRAFT: 0,
    SKIP_NO_GLASS: 0,
  };
  const listed: string[] = [];
  let projectsScanned = 0;
  let cellsFillable = 0;
  let cellsFilled = 0;
  let partitionsFilled = 0;
  let projectsFilled = 0;
  const failures: string[] = [];
  let aborted = false;

  try {
    const projects = await prisma.project.findMany({
      where: {
        ...(flagId ? { id: flagId } : {}),
        floors: { some: { rooms: { some: { partitions: { some: {} } } } } },
      },
      select: { id: true, organizationId: true, projectNumber: true, status: true },
      orderBy: { projectNumber: "asc" },
    });
    const total = projects.length;
    if (flagId && total === 0) console.log(`Project ${flagId}: not found, or it has no partitions.`);

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      projectsScanned++;
      const tag = `[${i + 1}/${total}] #${p.projectNumber} ${p.id}`;
      try {
        const parts = await prisma.partition.findMany({
          where: { organizationId: p.organizationId, room: { floor: { projectId: p.id } } },
          select: { design: true },
        });
        const glassId = await findDefaultGlassSelectionId(prisma, p.organizationId, p.id);
        const plan = planProjectFill(p.status, glassId !== null, parts.map((x) => x.design));
        counts[plan.cls]++;
        if (plan.cls === "NOTHING") continue;
        if (plan.cls !== "ELIGIBLE") {
          listed.push(
            `${tag} ${plan.cls} (null glass cells: ${plan.nullGlassCells}, v1 designs: ${plan.v1Designs}) - left untouched`,
          );
          continue;
        }
        cellsFillable += plan.nullGlassCells;
        if (dryRun) {
          console.log(`${tag} would fill ${plan.nullGlassCells} cell(s) with glass ${glassId}`);
          continue;
        }
        // Re-read + write in one tx so a concurrent edit cannot be overwritten.
        const done = await prisma.$transaction(async (tx) => {
          const g = await findDefaultGlassSelectionId(tx, p.organizationId, p.id);
          if (!g) return { partitions: 0, cells: 0 };
          const r = await fillProjectNullGlass(tx, p.organizationId, p.id, g);
          if (r.partitions > 0) await invalidateProjectCalculation(tx, p.id);
          return r;
        });
        cellsFilled += done.cells;
        partitionsFilled += done.partitions;
        if (done.partitions > 0) projectsFilled++;
        console.log(`${tag} filled ${done.cells} cell(s) in ${done.partitions} partition(s)`);
      } catch (err) {
        failures.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n---- Default-glass back-fill report ----");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) console.log("!! RUN ABORTED by an unexpected error - counts below are PARTIAL. Re-run is safe (idempotent).");
    console.log(`Projects with partitions scanned:  ${projectsScanned}`);
    console.log(`  nothing to fill:                 ${counts.NOTHING}`);
    console.log(`  eligible (DRAFT + glass):        ${counts.ELIGIBLE}`);
    console.log(`  listed, not touched - v1 design: ${counts.SKIP_V1}`);
    console.log(`  listed, not touched - not DRAFT: ${counts.SKIP_NOT_DRAFT}`);
    console.log(`  listed, not touched - no glass:  ${counts.SKIP_NO_GLASS}`);
    console.log(`Fillable null glass cells (eligible): ${cellsFillable}`);
    if (!dryRun) {
      console.log(`Filled: ${cellsFilled} cell(s) in ${partitionsFilled} partition(s) across ${projectsFilled} project(s)`);
    }
    console.log(`Not touched (${listed.length}):${list(listed)}`);
    console.log(`Failures (not written): ${failures.length}${list(failures)}`);
    if (failures.length || aborted) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /backfill-default-glass\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
