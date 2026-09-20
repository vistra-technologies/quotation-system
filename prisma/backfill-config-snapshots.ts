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
 *   - Fail-closed destination guard (prisma/db-target-guard.ts, D-19): DATABASE_URL must resolve to the dev
 *     Neon endpoint (ep-dark-term-ai0ufj4k) by default. Production only with the explicit opt-in
 *     EXPECT_ENDPOINT=ep-little-paper-aipm0o0i set in the operator's own shell AND equal to the URL's endpoint;
 *     anything else aborts. Production runs print "*** PRODUCTION ***". Only with human go-ahead.
 *   - Env precedence matches Next: process env > .env.local > .env. The target endpoint is printed first.
 *   - Only rows with configSnapshot IS NULL are read AND the write is conditional on it still being NULL
 *     (updateMany), so a row that got a snapshot mid-run is reported as skipped, never overwritten.
 *   - One row failing does not stop the run; failures are listed and the exit code is non-zero.
 *   - Idempotent: a second run finds no NULL rows and writes nothing.
 *
 * Single-project filter (`--project=<projectId>`):
 *   - Restricts BOTH the dry-run report and the real write to that one project id — every other guard
 *     above still applies unchanged (dry-run default, --write required, endpoint allowlist, conditional
 *     per-row write, finally-report).
 *   - Still gated by `configSnapshot IS NULL`: if the given project already has a snapshot, it is reported
 *     as already-set and left untouched (never overwritten).
 *   - The id is validated as a non-empty string; an empty `--project=` aborts before touching the DB. If
 *     the id doesn't match any project at all, the report says so clearly (`not found`) rather than
 *     silently backfilling nothing.
 *   - No flag = current behavior (all NULL-snapshot projects), unchanged.
 *   - `--project=<id>` MUST come after `--` (same as `--write`). If it's placed before `--`, npm swallows
 *     it into `npm_config_project` instead of forwarding it, and argv would otherwise look like "no
 *     filter" was given at all — this case is detected and aborts rather than silently falling through to
 *     an org-wide run. A misspelled flag name (e.g. `--projects=`) is NOT caught by this check — npm
 *     derives the env var from the flag as typed, so it lands in `npm_config_projects`, which this guard
 *     never looks at — and still silently widens to an org-wide run (bounded blast radius: dev-only,
 *     NULL-conditional, idempotent). See review-11.md MINOR 1/2.
 *
 * Usage (from quotation-system/):
 *   npm run backfill:config-snapshot                                    # dry run, all projects (default)
 *   npm run backfill:config-snapshot -- --write                         # real run, all projects (dev DB only, with human go-ahead)
 *   npm run backfill:config-snapshot -- --project=<projectId>            # dry run, one project only
 *   npm run backfill:config-snapshot -- --project=<projectId> --write   # real run, one project only (dev DB only, with human go-ahead)
 */
import dotenv from "dotenv";
import { describeTarget, endpointOf, enforceDbTarget } from "./db-target-guard";
import type { Prisma } from "../app/generated/prisma/client";
import { loadConfigSnapshot } from "../lib/config-snapshot";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

// Destination guard: dev endpoint by default; production only via explicit EXPECT_ENDPOINT opt-in (D-19).
export { endpointOf };

/**
 * Parses `--project=<projectId>` from argv, the same convention as `--write` (must come after `--` when
 * invoked via `npm run`, since npm swallows unknown flags placed before it).
 *   - No `--project=` present: `{ present: false, id: null }` — unchanged, all-projects behavior.
 *   - `--project=` with a non-empty value: `{ present: true, id: "<value>" }`.
 *   - `--project=` with an empty value (or bare `--project`): `{ present: true, id: null }` — invalid.
 */
export function parseProjectFlag(argv: string[]): { present: boolean; id: string | null } {
  const arg = argv.find((a) => a === "--project" || a.startsWith("--project="));
  if (!arg) return { present: false, id: null };
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1).trim() : "";
  return { present: true, id: value.length > 0 ? value : null };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const target = enforceDbTarget();
  // Dry run unless --write is given; --dry-run (or npm's swallowed --dry-run config) always wins.
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  // Optional single-project restriction; validated before the client is constructed so a bad flag never
  // touches the DB. Bare `--project` / `--project=` (empty value) is a usage error, not "all projects".
  const projectFlag = parseProjectFlag(process.argv);
  // npm swallows `--project=<id>` into its own `npm_config_project` env var when the flag is placed before
  // `--`, the same way it swallows `--dry-run`/`--write`. Unlike those, a swallowed `--project` has no way
  // to fail closed on its own: argv would just look like "no filter", and the run would silently widen
  // from one project to every project. So detect the mismatch explicitly and abort rather than fail open.
  // NOTE: a misspelled flag (`--projects=`) is NOT caught here — npm would swallow it into
  // `npm_config_projects`, a different env var this check never reads — see the header comment.
  if (process.env.npm_config_project && process.env.npm_config_project !== projectFlag.id) {
    console.error(
      `ABORT: npm swallowed --project=${process.env.npm_config_project} (it must come after \`--\`). ` +
        "Use: npm run backfill:config-snapshot -- --project=<id> [--write]",
    );
    process.exit(1);
  }
  if (projectFlag.present && !projectFlag.id) {
    console.error('ABORT: --project=<projectId> requires a non-empty id (got an empty value).');
    process.exit(1);
  }
  const targetProjectId = projectFlag.id;

  // Loaded only after the guards, so a refused run never constructs a client.
  const { PrismaClient, Prisma: PrismaRuntime } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) — snapshots will be written.",
  );
  if (targetProjectId) console.log(`Restricted to single project: ${targetProjectId}`);

  let candidates = 0;
  let filled = 0;
  let alreadyHad = 0; // gained a snapshot between read and write (conditional write matched 0 rows)
  let totalProjects = 0;
  let targetNotFound = false;
  let targetAlreadySnapshotted = false;
  const failures: string[] = [];
  const skippedConcurrent: string[] = [];
  let aborted = false;

  try {
    // Org-wide total is only meaningful (and only worth the query) in org-wide mode; single-project mode
    // reports on that one row instead.
    if (!targetProjectId) totalProjects = await prisma.project.count();

    let rows: { id: string; organizationId: string }[];
    if (targetProjectId) {
      // Single-project mode: look the row up directly rather than filtering findMany, so a project that
      // exists but already has a snapshot can be told apart from one that doesn't exist at all.
      const target = await prisma.project.findUnique({
        where: { id: targetProjectId },
        select: { id: true, organizationId: true, configSnapshot: true },
      });
      if (!target) {
        targetNotFound = true;
        rows = [];
      } else if (target.configSnapshot !== null) {
        targetAlreadySnapshotted = true;
        rows = [];
      } else {
        rows = [{ id: target.id, organizationId: target.organizationId }];
      }
    } else {
      rows = await prisma.project.findMany({
        where: { configSnapshot: { equals: PrismaRuntime.DbNull } },
        select: { id: true, organizationId: true },
        orderBy: { projectNumber: "asc" },
      });
    }
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
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (targetProjectId) console.log(`Scope: single project ${targetProjectId}`);
    if (aborted) console.log("!! RUN ABORTED by an unexpected error — counts below are PARTIAL. Re-run is safe (idempotent).");
    if (targetProjectId) {
      if (targetNotFound) {
        console.log(`Project ${targetProjectId}: NOT FOUND — no such project exists. Nothing read or written.`);
        console.log(`${dryRun ? "Would backfill" : "Backfilled"}: 0`);
      } else if (targetAlreadySnapshotted) {
        console.log(`Project ${targetProjectId}: already has a configSnapshot — left untouched, nothing written.`);
        console.log(`${dryRun ? "Would backfill" : "Backfilled"}: 0`);
      } else {
        console.log(`Project ${targetProjectId}: eligible (configSnapshot was NULL).`);
        console.log(`${dryRun ? "Would backfill" : "Backfilled"}: ${filled}`);
        console.log(`Skipped, snapshot appeared mid-run (${alreadyHad}):${list(skippedConcurrent)}`);
      }
    } else {
      console.log(`Projects total (org-wide):         ${totalProjects}`);
      console.log(`With NULL configSnapshot:          ${candidates}`);
      console.log(`${dryRun ? "Would backfill" : "Backfilled"}: ${filled}`);
      console.log(`Already had snapshot (skipped): ${totalProjects - candidates + alreadyHad}`);
      console.log(`Skipped, snapshot appeared mid-run (${alreadyHad}):${list(skippedConcurrent)}`);
    }
    console.log(`Failures (not written): ${failures.length}${list(failures)}`);
    if (failures.length || aborted || targetNotFound) process.exitCode = 1;
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
