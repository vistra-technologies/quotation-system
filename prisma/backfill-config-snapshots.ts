/**
 * One-time backfill of `Project.configSnapshot` (Stage 22 Batch 4).
 *
 * New projects get their snapshot at creation (lib/data/projects.ts, lib/data/inquiries.ts). This script fills
 * older rows where `configSnapshot IS NULL` with a snapshot of the project's org's CURRENT config — a best
 * approximation (`takenAt` records when the backfill ran, not when the project was created). The snapshot is
 * built by the same `loadConfigSnapshot` the app uses.
 *
 * Safety (mirrors prisma/migrate-design-v1-to-v2.ts):
 *   - DRY RUN IS THE DEFAULT. Rows are written only when `--write` is passed; `--dry-run` and npm's own
 *     `--dry-run` config (npm swallows it without forwarding) always win. npm swallows unknown flags placed
 *     before `--`, so `--write` must come after it.
 *   - Fail-closed destination allowlist: DATABASE_URL must resolve to the dev Neon endpoint
 *     (ep-dark-term-ai0ufj4k). Unset / unparseable / any other host aborts. NEVER run against production.
 *   - Env precedence matches Next: process env > .env.local > .env. The target endpoint is printed first.
 *   - Only rows with configSnapshot IS NULL are read AND the write is conditional on it still being NULL
 *     (updateMany), so a row that got a snapshot mid-run is reported as skipped, never overwritten.
 *   - One row failing does not stop the run; failures are listed and the exit code is non-zero.
 *   - Idempotent: a second run finds no NULL rows and writes nothing.
 *
 * Usage (from quotation-system/):
 *   npm run backfill:config-snapshot                 # dry run (default): report only
 *   npm run backfill:config-snapshot -- --write      # real run (dev DB only, with human go-ahead)
 */
import dotenv from "dotenv";
import type { Prisma } from "../app/generated/prisma/client";
import { loadConfigSnapshot } from "../lib/config-snapshot";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

/** The only endpoint this script may touch (the persistent dev Neon branch). */
const ALLOWED_ENDPOINT = "ep-dark-term-ai0ufj4k";

/** Neon endpoint id from a connection string (drops any `-pooler` suffix), or null if unparseable. */
export function endpointOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host) return null;
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const endpoint = url ? endpointOf(url) : null;
  if (!endpoint) {
    console.error("ABORT: DATABASE_URL is not set or its host cannot be parsed.");
    process.exit(1);
  }
  if (endpoint !== ALLOWED_ENDPOINT) {
    console.error(
      `ABORT: DATABASE_URL targets endpoint "${endpoint}", not the dev branch (${ALLOWED_ENDPOINT}) — refusing to run.`,
    );
    process.exit(1);
  }
  // Dry run unless --write is given; --dry-run (or npm's swallowed --dry-run config) always wins.
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  // Loaded only after the guard, so a refused run never constructs a client.
  const { PrismaClient, Prisma: PrismaRuntime } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(`Target DB endpoint: ${endpoint}`);
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) — snapshots will be written.",
  );

  let candidates = 0;
  let filled = 0;
  let alreadyHad = 0; // gained a snapshot between read and write (conditional write matched 0 rows)
  let totalProjects = 0;
  const failures: string[] = [];
  const skippedConcurrent: string[] = [];
  let aborted = false;

  try {
    totalProjects = await prisma.project.count();
    const rows = await prisma.project.findMany({
      where: { configSnapshot: { equals: PrismaRuntime.DbNull } },
      select: { id: true, organizationId: true },
      orderBy: { projectNumber: "asc" },
    });
    candidates = rows.length;

    for (const row of rows) {
      try {
        // Read + conditional write in one interactive tx so the snapshot matches the write moment.
        const wrote = await prisma.$transaction(async (tx) => {
          const snapshot = await loadConfigSnapshot(tx, row.organizationId);
          if (dryRun) return snapshot.componentTypes.length >= 0; // read-only: proves the load works
          const res = await tx.project.updateMany({
            where: { id: row.id, configSnapshot: { equals: PrismaRuntime.DbNull } },
            data: { configSnapshot: snapshot as unknown as Prisma.InputJsonValue },
          });
          return res.count > 0;
        });
        if (wrote) filled++;
        else {
          alreadyHad++;
          skippedConcurrent.push(row.id);
        }
      } catch (err) {
        // Per-row isolation: log and continue.
        failures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n──── Project.configSnapshot backfill report ────");
    console.log(`Target DB endpoint: ${endpoint}${dryRun ? " (dry run)" : ""}`);
    if (aborted) console.log("!! RUN ABORTED by an unexpected error — counts below are PARTIAL. Re-run is safe (idempotent).");
    console.log(`Projects total:                    ${totalProjects}`);
    console.log(`With NULL configSnapshot:          ${candidates}`);
    console.log(`${dryRun ? "Would backfill" : "Backfilled"}: ${filled}`);
    console.log(`Already had snapshot (skipped): ${totalProjects - candidates + alreadyHad}`);
    console.log(`Skipped, snapshot appeared mid-run (${alreadyHad}):${list(skippedConcurrent)}`);
    console.log(`Failures (not written): ${failures.length}${list(failures)}`);
    if (failures.length || aborted) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /backfill-config-snapshots\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
