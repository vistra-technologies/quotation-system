/**
 * Direct-DB test helper for Stage 22 E2E coverage (stage22-*.spec.ts).
 *
 * Why this exists: two of Stage 22's behavioral invariants cannot be set up or observed through
 * any API route by design —
 *   - a v1 `Partition.design` row (E1/E2) — the PATCH route rejects `panels` bodies outright since
 *     Batch 1 (D-8); there is no way to WRITE a v1 doc except directly in Postgres.
 *   - a project with `configSnapshot IS NULL` (E7, the null-guard) — every project-create path
 *     (createProject, convertInquiryToProject) now writes a non-null snapshot in the same
 *     transaction (Batch 4); the only way to get a null one post-Batch-4 is a row created before
 *     the backfill ran, which the suite cannot rely on existing, or a direct DB write.
 * plus one test-only teardown (E6's leftover ComponentType — see `deleteComponentType`).
 *
 * This mirrors the B7 seeding decision recorded in the worklog (GATE A, 2026-09-19): "B7 seeding =
 * direct Prisma DB inserts in a test helper against the dev DB." Safety is deliberately the SAME
 * shape as prisma/migrate-design-v1-to-v2.ts / prisma/backfill-config-snapshots.ts's guards (this
 * suite only ever runs against the shared dev Neon branch — every preview and test.easeetool.com
 * share it — never against production, which no test target in this repo points at):
 *   - fail-closed destination allowlist (dev Neon endpoint only; unset/unparseable/other host
 *     throws before a client is ever constructed).
 *   - env precedence matches Next (.env.local > .env).
 *
 * How the DB is actually reached (revised after review-9 #1 — see that report for the failure this
 * replaces): the generated Prisma client (`app/generated/prisma/client`) is ESM-only; Playwright's
 * own TS loader transpiles specs and helpers to CJS, and even a *dynamic* `await import(...)` of
 * that module gets rewritten to a `require()` there, which throws "Cannot use import statement
 * outside a module" — measured, not theoretical (see review-9). `prisma/migrate-design-v1-to-v2.ts`
 * and `prisma/backfill-config-snapshots.ts` don't hit this because they run under `tsx` directly,
 * never through Playwright's transform. So this helper shells out to a tiny CLI
 * (`prisma/e2e-db-helper-cli.ts`) run via `tsx`'s own CLI entry point (invoked as
 * `node node_modules/tsx/dist/cli.mjs prisma/e2e-db-helper-cli.ts <op>`, never the `tsx`/`npx`
 * shell shims, so this works identically on Windows and POSIX CI runners with no shell/PATHEXT
 * resolution involved) — the same shape as devops's B4 DB-level check
 * (`.engineering/stage-22/verify-b4.md` T6, execSync to a tsx script). Each call is one child
 * process: JSON args on stdin, one JSON line (`{ok, data|error}`) on stdout.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const HELPER_SCRIPT = path.join(REPO_ROOT, "prisma", "e2e-db-helper-cli.ts");

/** Runs one guarded DB operation in a `tsx` child process and returns its result. */
function runDbOp<T>(op: string, args: Record<string, unknown> = {}): T {
  const result = spawnSync(process.execPath, [TSX_CLI, HELPER_SCRIPT, op], {
    input: JSON.stringify(args),
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  if (result.error) {
    throw new Error(`stage22 DB test helper (${op}): failed to spawn tsx child process: ${result.error.message}`);
  }
  const stdout = (result.stdout ?? "").trim();
  if (!stdout) {
    throw new Error(
      `stage22 DB test helper (${op}): child process produced no output (exit ${result.status}). ` +
        `stderr: ${(result.stderr ?? "").trim()}`,
    );
  }
  let parsed: { ok: boolean; data?: T; error?: string };
  try {
    parsed = JSON.parse(stdout) as { ok: boolean; data?: T; error?: string };
  } catch {
    throw new Error(`stage22 DB test helper (${op}): could not parse child output as JSON: ${stdout}`);
  }
  if (!parsed.ok) {
    throw new Error(`stage22 DB test helper (${op}): ${parsed.error}`);
  }
  return parsed.data as T;
}

/**
 * Overwrite a Partition's `design` with a raw v1 document, bypassing the (v2-only) PATCH API
 * entirely — the only way to produce a v1 row for E1/E2 since Batch 1.
 */
export async function seedV1Design(partitionId: string, design: Record<string, unknown>): Promise<void> {
  runDbOp("seedV1Design", { partitionId, design });
}

/** Read a Partition's raw stored `design`/`widthMm`/`heightMm`, unparsed. */
export async function readPartitionRow(
  partitionId: string,
): Promise<{ design: unknown; widthMm: number; heightMm: number }> {
  return runDbOp("readPartitionRow", { partitionId });
}

/**
 * Force a project's `configSnapshot` to NULL — simulates a pre-Batch-4 / pre-backfill row for the
 * E7 null-guard test. No API route can ever produce this state post-Batch-4 (every create writes
 * a snapshot); this is intentionally the one write this helper performs that a live app action
 * could never cause.
 */
export async function nullOutConfigSnapshot(projectId: string): Promise<void> {
  runDbOp("nullOutConfigSnapshot", { projectId });
}

/** Read a project's raw `configSnapshot` column (never exposed by the list API — Stage 22 D-10). */
export async function readConfigSnapshot(projectId: string) {
  return runDbOp<{
    takenAt: string;
    componentTypes: Array<{ id: string; code: string; name: string; active: boolean }>;
  } | null>("readConfigSnapshot", { projectId });
}

/**
 * Delete a ComponentType directly — test-only teardown (review-9 #2). There is no DELETE route for
 * ComponentType, so the E6 freeze test's `E2E_<timestamp>`-coded type has no other way to be
 * cleaned up. Safe: the suite never creates a Selection against a type it creates itself (E6 only
 * reads component-types lists / snapshots after creating it), so this can never violate an FK.
 */
export async function deleteComponentType(componentTypeId: string): Promise<void> {
  runDbOp("deleteComponentType", { componentTypeId });
}

/**
 * Kept as a no-op for API compatibility with callers' `afterAll` hooks — each `runDbOp` call now
 * owns a short-lived child process (and its own Prisma client) rather than a shared long-lived
 * connection, so there is nothing left open here to close.
 */
export async function closeTestDb(): Promise<void> {
  // no-op — see doc comment above.
}
