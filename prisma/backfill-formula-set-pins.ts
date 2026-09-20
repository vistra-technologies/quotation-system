/**
 * One-time backfill of `Organization.activeFormulaSetId` and `Project.formulaSetId`
 * (Stage 23 Batch 2).
 *
 * New orgs get `activeFormulaSetId` set at creation time (lib/data/superadmin/orgs.ts) and new
 * projects get `formulaSetId` pinned at creation time (lib/data/projects.ts, lib/data/inquiries.ts).
 * This script fills older rows that predate Stage 23: orgs seeded before the formula-set engine
 * shipped, and projects created under one of those orgs before the pin existed.
 *
 * Two passes, in order:
 *   (a) Organizations with activeFormulaSetId IS NULL -> the seeded set (ACTIVE_FORMULA_SET_NAME,
 *       looked up by (name) at its highest version — same set prisma/seed.ts activates).
 *   (b) Projects with formulaSetId IS NULL -> their own org's (now-set) activeFormulaSetId.
 *
 * Run (a) before (b) in the same invocation so a project whose org was just backfilled in this
 * same run still gets picked up in pass (b).
 *
 * Safety (mirrors prisma/backfill-config-snapshots.ts exactly):
 *   - DRY RUN IS THE DEFAULT. Rows are written only when `--write` is passed; `--dry-run` and npm's
 *     own `--dry-run` config (npm swallows it without forwarding) always win. npm swallows unknown
 *     flags placed before `--`, so `--write` must come after it.
 *   - Fail-closed destination guard (prisma/db-target-guard.ts): DATABASE_URL must resolve to the
 *     dev Neon endpoint (ep-dark-term-ai0ufj4k) by default. Production only with the explicit
 *     opt-in EXPECT_ENDPOINT=ep-little-paper-aipm0o0i set in the operator's own shell AND equal to
 *     the URL's endpoint; anything else aborts. Production runs print "*** PRODUCTION ***". Only
 *     with human go-ahead — see development-cycles/stage-23-prod-runbook.md.
 *   - Env precedence matches Next: process env > .env.local > .env. The target endpoint is printed
 *     first.
 *   - Only rows with the relevant FK IS NULL are read AND the write is conditional on it still
 *     being NULL (updateMany), so a row that gained a pin mid-run is reported as skipped, never
 *     overwritten.
 *   - One row failing does not stop the run; failures are listed and the exit code is non-zero.
 *   - Idempotent: a second run finds no NULL rows and writes nothing.
 *
 * Single-project filter (`--project=<projectId>`):
 *   - Restricts pass (b) to that one project id. Pass (a) (org backfill) always runs org-wide
 *     regardless of this flag, since a single project's own org may still need its pin set first —
 *     org backfill is cheap, idempotent and NULL-conditional so this is always safe.
 *   - Still gated by `formulaSetId IS NULL`: if the given project already has a pin, it is reported
 *     as already-set and left untouched (never overwritten).
 *   - The id is validated as a non-empty string; an empty `--project=` aborts before touching the DB.
 *     If the id doesn't match any project at all, the report says so clearly rather than silently
 *     backfilling nothing.
 *   - `--project=<id>` MUST come after `--` (same as `--write`) — npm otherwise swallows it into
 *     `npm_config_project`, and this is detected and aborted rather than silently widening to an
 *     org-wide run (same guard as backfill-config-snapshots.ts).
 *
 * Usage (from quotation-system/):
 *   npm run backfill:formula-pins                                    # dry run, all orgs + projects (default)
 *   npm run backfill:formula-pins -- --write                         # real run (dev DB only, with human go-ahead)
 *   npm run backfill:formula-pins -- --project=<projectId>            # dry run, one project's own pin only
 *   npm run backfill:formula-pins -- --project=<projectId> --write   # real run, one project's own pin only
 */
import dotenv from "dotenv";
import { describeTarget, endpointOf, enforceDbTarget } from "./db-target-guard";
import { ACTIVE_FORMULA_SET_NAME } from "./seed-formula-sets";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

// Destination guard: dev endpoint by default; production only via explicit EXPECT_ENDPOINT opt-in.
export { endpointOf };

/**
 * Parses `--project=<projectId>` from argv — identical convention to backfill-config-snapshots.ts's
 * parseProjectFlag (must come after `--` when invoked via `npm run`).
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
  const dryRun =
    !process.argv.includes("--write") ||
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true";

  const projectFlag = parseProjectFlag(process.argv);
  if (process.env.npm_config_project && process.env.npm_config_project !== projectFlag.id) {
    console.error(
      `ABORT: npm swallowed --project=${process.env.npm_config_project} (it must come after \`--\`). ` +
        "Use: npm run backfill:formula-pins -- --project=<id> [--write]",
    );
    process.exit(1);
  }
  if (projectFlag.present && !projectFlag.id) {
    console.error('ABORT: --project=<projectId> requires a non-empty id (got an empty value).');
    process.exit(1);
  }
  const targetProjectId = projectFlag.id;

  // Loaded only after the guards, so a refused run never constructs a client.
  const { PrismaClient } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  console.log(describeTarget(target));
  console.log(
    dryRun
      ? "DRY RUN — nothing will be written. (Pass `-- --write` to write.)"
      : "REAL RUN (--write) — pins will be written.",
  );
  if (targetProjectId) console.log(`Project pass restricted to single project: ${targetProjectId}`);

  // Pass (a) counters
  let orgCandidates = 0;
  let orgsFilled = 0;
  let orgsAlreadyHad = 0;
  let totalOrgs = 0;
  const orgFailures: string[] = [];

  // Pass (b) counters
  let projectCandidates = 0;
  let projectsFilled = 0;
  let projectsAlreadyHad = 0;
  let totalProjects = 0;
  let targetNotFound = false;
  let targetAlreadyPinned = false;
  const projectFailures: string[] = [];
  const skippedConcurrent: string[] = [];

  let aborted = false;

  try {
    const activeSet = await prisma.formulaSet.findFirst({
      where: { name: ACTIVE_FORMULA_SET_NAME },
      orderBy: { version: "desc" },
      select: { id: true, name: true, version: true },
    });
    if (!activeSet) {
      throw new Error(
        `No FormulaSet found for name "${ACTIVE_FORMULA_SET_NAME}" — run \`npx prisma db seed\` first ` +
          "so the set exists before backfilling pins.",
      );
    }
    console.log(`Active set: ${activeSet.name}@${activeSet.version} (${activeSet.id})`);

    // ── Pass (a): orgs ──────────────────────────────────────────────────────
    totalOrgs = await prisma.organization.count();
    const orgRows = await prisma.organization.findMany({
      where: { activeFormulaSetId: null },
      select: { id: true, slug: true },
      orderBy: { slug: "asc" },
    });
    orgCandidates = orgRows.length;

    for (const org of orgRows) {
      try {
        if (dryRun) {
          orgsFilled++; // report what WOULD happen; no write performed
          continue;
        }
        const res = await prisma.organization.updateMany({
          where: { id: org.id, activeFormulaSetId: null },
          data: { activeFormulaSetId: activeSet.id },
        });
        if (res.count > 0) orgsFilled++;
        else orgsAlreadyHad++;
      } catch (err) {
        orgFailures.push(`${org.slug} (${org.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ── Pass (b): projects ──────────────────────────────────────────────────
    let projectRows: { id: string; organizationId: string }[];
    if (targetProjectId) {
      const row = await prisma.project.findUnique({
        where: { id: targetProjectId },
        select: { id: true, organizationId: true, formulaSetId: true },
      });
      if (!row) {
        targetNotFound = true;
        projectRows = [];
      } else if (row.formulaSetId !== null) {
        targetAlreadyPinned = true;
        projectRows = [];
      } else {
        projectRows = [{ id: row.id, organizationId: row.organizationId }];
      }
    } else {
      totalProjects = await prisma.project.count();
      projectRows = await prisma.project.findMany({
        where: { formulaSetId: null },
        select: { id: true, organizationId: true },
        orderBy: { projectNumber: "asc" },
      });
    }
    projectCandidates = projectRows.length;

    for (const row of projectRows) {
      try {
        const org = await prisma.organization.findUnique({
          where: { id: row.organizationId },
          select: { activeFormulaSetId: true },
        });
        const pinId = org?.activeFormulaSetId ?? activeSet.id;
        if (dryRun) {
          projectsFilled++;
          continue;
        }
        const res = await prisma.project.updateMany({
          where: { id: row.id, formulaSetId: null },
          data: { formulaSetId: pinId },
        });
        if (res.count > 0) projectsFilled++;
        else {
          projectsAlreadyHad++;
          skippedConcurrent.push(row.id);
        }
      } catch (err) {
        projectFailures.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    const list = (items: string[]) => (items.length ? "\n  " + items.join("\n  ") : "");
    console.log("\n──── Formula-set pin backfill report ────");
    console.log(`${describeTarget(target)}${dryRun ? " (dry run)" : ""}`);
    if (aborted) {
      console.log("!! RUN ABORTED by an unexpected error — counts below are PARTIAL. Re-run is safe (idempotent).");
    }

    console.log("\n-- Organizations --");
    console.log(`Organizations total:                 ${totalOrgs}`);
    console.log(`With NULL activeFormulaSetId:         ${orgCandidates}`);
    console.log(`${dryRun ? "Would set" : "Set"}: ${orgsFilled}`);
    console.log(`Already had a pin, appeared mid-run: ${orgsAlreadyHad}`);
    console.log(`Org failures (not written): ${orgFailures.length}${list(orgFailures)}`);

    console.log("\n-- Projects --");
    if (targetProjectId) {
      console.log(`Scope: single project ${targetProjectId}`);
      if (targetNotFound) {
        console.log(`Project ${targetProjectId}: NOT FOUND — no such project exists. Nothing read or written.`);
        console.log(`${dryRun ? "Would backfill" : "Backfilled"}: 0`);
      } else if (targetAlreadyPinned) {
        console.log(`Project ${targetProjectId}: already has formulaSetId — left untouched, nothing written.`);
        console.log(`${dryRun ? "Would backfill" : "Backfilled"}: 0`);
      } else {
        console.log(`Project ${targetProjectId}: eligible (formulaSetId was NULL).`);
        console.log(`${dryRun ? "Would backfill" : "Backfilled"}: ${projectsFilled}`);
      }
    } else {
      console.log(`Projects total:                     ${totalProjects}`);
      console.log(`With NULL formulaSetId:              ${projectCandidates}`);
      console.log(`${dryRun ? "Would backfill" : "Backfilled"}: ${projectsFilled}`);
      console.log(`Already had a pin mid-run (${projectsAlreadyHad}):${list(skippedConcurrent)}`);
    }
    console.log(`Project failures (not written): ${projectFailures.length}${list(projectFailures)}`);

    const totalFailures = orgFailures.length + projectFailures.length;
    console.log(`\nFailures: ${totalFailures}`);
    if (totalFailures || aborted || targetNotFound) process.exitCode = 1;
    await prisma.$disconnect();
  }
}

// Run only when executed directly (not when imported for pure-function checks).
if (process.argv[1] && /backfill-formula-set-pins\.[cm]?[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
