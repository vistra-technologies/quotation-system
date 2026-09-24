/**
 * CLI backend for `tests/e2e/db-helpers.ts` — the direct-DB escape hatch Stage 22's E2E suite
 * (stage22-data-model.spec.ts) uses for the handful of states no API route can produce (see that
 * file's header). Runs under `tsx` as its own child process, invoked from the Playwright test.
 *
 * Why a child process at all, rather than a plain `await import(...)` inside the spec/helper:
 * Playwright's own TS loader transpiles specs (and everything they statically or dynamically
 * import) to CJS, which turns a dynamic `import("@/app/generated/prisma/client")` into a
 * `require()` of that (ESM-only, `prisma-client` generator) module and throws "Cannot use import
 * statement outside a module" the moment it actually runs — not caught by `--list`, which never
 * executes it. `prisma/migrate-design-v1-to-v2.ts` and `prisma/backfill-config-snapshots.ts` don't
 * hit this because they run under `tsx` directly (real ESM), never through Playwright's transform.
 * Shelling out to `tsx` here (same pattern devops used for the B4 DB-level check, see
 * `.engineering/stage-22/verify-b4.md` T6) puts this script under the exact same ESM-native runtime
 * those two already rely on, so the identical `await import(...)` line works unmodified.
 *
 * Protocol: `node <tsx-cli> e2e-db-helper-cli.ts <operation>`, JSON args on stdin, JSON result
 * (`{ ok: true, data }` or `{ ok: false, error }`) as the ONLY line printed to stdout. Exit code 0
 * on success, 1 on any failure (including the safety-guard refusal) — the caller distinguishes a
 * real DB/connection error from the guard's own refusal by matching on `error`, not the exit code.
 *
 * Safety: identical fail-closed destination allowlist to migrate-design-v1-to-v2.ts /
 * backfill-config-snapshots.ts — this suite only ever runs against the shared dev Neon branch.
 */
import dotenv from "dotenv";
import type { Prisma } from "../app/generated/prisma/client";

// Same precedence as Next: real env > .env.local > .env (dotenv never overrides an already-set var).
dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const ALLOWED_ENDPOINT = "ep-dark-term-ai0ufj4k";

function endpointOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host) return null;
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const op = process.argv[2];
  const url = process.env.DATABASE_URL ?? "";
  const endpoint = url ? endpointOf(url) : null;
  if (endpoint !== ALLOWED_ENDPOINT) {
    throw new Error(
      `stage22 DB test helper refuses to run: DATABASE_URL targets "${endpoint ?? "(unset/unparseable)"}", ` +
        `not the dev branch (${ALLOWED_ENDPOINT}). This suite must never touch any other database.`,
    );
  }

  const rawInput = await readStdin();
  const input = rawInput.trim() ? (JSON.parse(rawInput) as Record<string, unknown>) : {};

  // Loaded only after the guard — see file header.
  const { PrismaClient, Prisma } = await import("../app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    switch (op) {
      case "seedV1Design": {
        const { partitionId, design } = input as { partitionId: string; design: Record<string, unknown> };
        await db.partition.update({
          where: { id: partitionId },
          data: { design: design as unknown as Prisma.InputJsonValue },
        });
        return null;
      }
      case "readPartitionRow": {
        const { partitionId } = input as { partitionId: string };
        return db.partition.findUniqueOrThrow({
          where: { id: partitionId },
          select: { design: true, widthMm: true, heightMm: true },
        });
      }
      case "nullOutConfigSnapshot": {
        const { projectId } = input as { projectId: string };
        await db.project.update({
          where: { id: projectId },
          data: { configSnapshot: Prisma.DbNull },
        });
        return null;
      }
      case "readConfigSnapshot": {
        const { projectId } = input as { projectId: string };
        const row = await db.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { configSnapshot: true },
        });
        return row.configSnapshot;
      }
      case "deleteComponentType": {
        // Test-only teardown (Stage 22 B7 E6 cleanup), not app logic — there is no DELETE route
        // for ComponentType. Safe here because the only rows this helper ever creates are the
        // suite's own `E2E_<timestamp>`-coded freeze-test type, which the suite never selects
        // against (E6 only reads component-types lists / snapshots, never creates a Selection
        // referencing it) — a direct delete cannot leave a dangling FK.
        const { componentTypeId } = input as { componentTypeId: string };
        // Guard: only ever delete test-coded types; also remove the 1:1 ComponentTypeOrgConfig row
        // (created by any field-values PUT) first, otherwise the FK blocks the delete.
        const ct = await db.componentType.findUnique({ where: { id: componentTypeId }, select: { code: true } });
        if (!ct) return null;
        if (!ct.code.startsWith("E2E_")) {
          throw new Error(`deleteComponentType refused: ${ct.code} is not an E2E_-coded type`);
        }
        await db.componentTypeOrgConfig.deleteMany({ where: { componentTypeId } });
        await db.componentType.delete({ where: { id: componentTypeId } });
        return null;
      }
      // ── Stage 23 Batch 3 ops (tests/e2e/stage23-wiring.spec.ts) ─────────────────────────────────
      case "insertCalculation": {
        // A ProjectCalculation for the project, pinned to the project's own formulaSetId. Test-only:
        // Batch 5's submit/recompute is what writes these in the app.
        const { projectId } = input as { projectId: string };
        const proj = await db.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { organizationId: true, formulaSetId: true },
        });
        if (!proj.formulaSetId) throw new Error("insertCalculation: project has no formulaSetId");
        await db.projectCalculation.create({
          data: {
            organizationId: proj.organizationId,
            projectId,
            formulaSetId: proj.formulaSetId,
            computedAt: new Date(),
            status: "OK",
            summary: { floors: [], kpis: { totalPartitionSqm: 0, sqmByGlassType: [], doorsByType: [] } },
          },
        });
        return null;
      }
      case "setDesignSubmittedAt": {
        const { projectId } = input as { projectId: string };
        await db.project.update({ where: { id: projectId }, data: { designSubmittedAt: new Date() } });
        return null;
      }
      case "readProjectState": {
        const { projectId } = input as { projectId: string };
        const p = await db.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { formulaSetId: true, designSubmittedAt: true },
        });
        const calcCount = await db.projectCalculation.count({ where: { projectId } });
        return { formulaSetId: p.formulaSetId, designSubmittedAt: p.designSubmittedAt, calcCount };
      }
      case "readOrgActiveFormulaSet": {
        const { orgSlug } = input as { orgSlug: string };
        const org = await db.organization.findUniqueOrThrow({
          where: { slug: orgSlug },
          select: { activeFormulaSetId: true },
        });
        return org.activeFormulaSetId;
      }
      case "setOrgActiveFormulaSet": {
        const { orgSlug, formulaSetId } = input as { orgSlug: string; formulaSetId: string | null };
        await db.organization.update({ where: { slug: orgSlug }, data: { activeFormulaSetId: formulaSetId } });
        return null;
      }
      case "createTempFormulaSet": {
        // Throwaway "e2e-"-named set (never a real one) for the incompatible-config 409 check.
        const { name, body } = input as { name: string; body: Record<string, unknown> };
        if (!name.startsWith("e2e-")) throw new Error("createTempFormulaSet refused: name must start with e2e-");
        const row = await db.formulaSet.create({
          data: { name, version: 1, body: body as unknown as Prisma.InputJsonValue },
          select: { id: true },
        });
        return row.id;
      }
      case "deleteTempFormulaSet": {
        const { formulaSetId } = input as { formulaSetId: string };
        const fs = await db.formulaSet.findUnique({ where: { id: formulaSetId }, select: { name: true } });
        if (!fs) return null;
        if (!fs.name.startsWith("e2e-")) throw new Error(`deleteTempFormulaSet refused: ${fs.name}`);
        await db.formulaSet.delete({ where: { id: formulaSetId } });
        return null;
      }
      // ── Stage 23 Batch 7 (tests/e2e/stage23-summary.spec.ts) ────────────────────────────────────
      case "countProjectCalculations": {
        // Before/after proof that a SuperAdmin org hard-delete cascades ProjectCalculation rows
        // (D-20) — a successful delete already implies this (the FK would otherwise abort the
        // transaction), but this makes the cascade an explicit, independently-observed assertion.
        const { organizationId } = input as { organizationId: string };
        return db.projectCalculation.count({ where: { organizationId } });
      }
      case "markCalculationFailed": {
        // Stage 26 tester: flip a stored ProjectCalculation to FAILED (no route writes FAILED rows any more).
        const { projectId, errorDetail } = input as { projectId: string; errorDetail: string };
        await db.projectCalculation.update({ where: { projectId }, data: { status: "FAILED", errorDetail } });
        return null;
      }
      case "setProjectStatus": {
        // No API route can change Project.status this stage (Batch 5's own worklog note) — needed
        // only to exercise recompute's "non-DRAFT -> 409" gate (D-23). Test-only; callers must
        // revert to "DRAFT" afterward.
        const { projectId, status } = input as { projectId: string; status: string };
        await db.project.update({ where: { id: projectId }, data: { status } });
        return null;
      }
      // ── Stage 24 Batch 6 (tests/e2e/stage24-materials.spec.ts) ──────────────────────────────────
      case "setInventoryItemActive": {
        // Temporarily deactivate (or reactivate) an InventoryItem by code + org slug, for C2/I1
        // INACTIVE_ITEM tests. No API route exists for this — the /catalog routes do not expose
        // activate/deactivate. Callers MUST revert (active: true) in a finally block.
        const { code, orgSlug, active } = input as { code: string; orgSlug: string; active: boolean };
        const org = await db.organization.findUniqueOrThrow({ where: { slug: orgSlug }, select: { id: true } });
        await db.inventoryItem.updateMany({
          where: { organizationId: org.id, code },
          data: { active },
        });
        return null;
      }
      case "readCalculation": {
        // Read the full ProjectCalculation row for a project — used to verify what Submit Design
        // and Recompute actually wrote (including materialByRoom, which is omitted from all API
        // responses by lib/prisma.ts omit defaults). Returns null if no row exists.
        const { projectId } = input as { projectId: string };
        const row = await db.projectCalculation.findUnique({
          where: { projectId },
          select: { status: true, computedAt: true, materialList: true, materialByRoom: true },
        });
        return row;
      }
      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main()
  .then((data) => {
    process.stdout.write(JSON.stringify({ ok: true, data }));
    process.exit(0);
  })
  .catch((err: unknown) => {
    process.stdout.write(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
