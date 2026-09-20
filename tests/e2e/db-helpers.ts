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
 *
 * This mirrors the B7 seeding decision recorded in the worklog (GATE A, 2026-09-19): "B7 seeding =
 * direct Prisma DB inserts in a test helper against the dev DB." Safety is deliberately the SAME
 * shape as prisma/migrate-design-v1-to-v2.ts / prisma/backfill-config-snapshots.ts's guards (this
 * suite only ever runs against the shared dev Neon branch — every preview and test.easeetool.com
 * share it — never against production, which no test target in this repo points at):
 *   - fail-closed destination allowlist (dev Neon endpoint only; unset/unparseable/other host
 *     throws before a client is ever constructed).
 *   - env precedence matches Next (.env.local > .env), loaded here because the Playwright test
 *     process does not otherwise read them (playwright.config.ts only loads .env.playwright.local).
 *
 * The generated Prisma client (`app/generated/prisma/client`) is ESM; Playwright's own TS loader
 * transpiles spec/helper files to CJS, and a static top-level `import` of an ESM module from a
 * CJS-loaded file throws `ReferenceError: exports is not defined` under Node's require() ESM
 * interop. `prisma/migrate-design-v1-to-v2.ts` and `prisma/backfill-config-snapshots.ts` already
 * work around this the same way (see their `main()`): the Prisma client and adapter are loaded via
 * a runtime `await import(...)` inside `testDb()`, never as a static top-level import.
 */
import dotenv from "dotenv";
import type { PrismaClient as PrismaClientType, Prisma as PrismaNamespace } from "@/app/generated/prisma/client";

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

let client: PrismaClientType | null = null;
let prismaNs: typeof PrismaNamespace | null = null;

/** Lazily-constructed, guarded Prisma client — only ever touches the dev Neon branch. */
async function testDb(): Promise<PrismaClientType> {
  if (client) return client;
  const url = process.env.DATABASE_URL ?? "";
  const endpoint = url ? endpointOf(url) : null;
  if (endpoint !== ALLOWED_ENDPOINT) {
    throw new Error(
      `stage22 DB test helper refuses to run: DATABASE_URL targets "${endpoint ?? "(unset/unparseable)"}", ` +
        `not the dev branch (${ALLOWED_ENDPOINT}). This suite must never touch any other database.`,
    );
  }
  // Loaded only after the guard, and only via dynamic import — see file header.
  const { PrismaClient, Prisma } = await import("@/app/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  prismaNs = Prisma;
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return client;
}

/**
 * Overwrite a Partition's `design` with a raw v1 document, bypassing the (v2-only) PATCH API
 * entirely — the only way to produce a v1 row for E1/E2 since Batch 1.
 */
export async function seedV1Design(partitionId: string, design: Record<string, unknown>): Promise<void> {
  const db = await testDb();
  await db.partition.update({
    where: { id: partitionId },
    data: { design: design as unknown as PrismaNamespace.InputJsonValue },
  });
}

/** Read a Partition's raw stored `design`/`widthMm`/`heightMm`, unparsed. */
export async function readPartitionRow(partitionId: string) {
  const db = await testDb();
  return db.partition.findUniqueOrThrow({
    where: { id: partitionId },
    select: { design: true, widthMm: true, heightMm: true },
  });
}

/**
 * Force a project's `configSnapshot` to NULL — simulates a pre-Batch-4 / pre-backfill row for the
 * E7 null-guard test. No API route can ever produce this state post-Batch-4 (every create writes
 * a snapshot); this is intentionally the one write this helper performs that a live app action
 * could never cause.
 */
export async function nullOutConfigSnapshot(projectId: string): Promise<void> {
  const db = await testDb();
  if (!prismaNs) throw new Error("Prisma namespace not loaded — testDb() must run first");
  await db.project.update({
    where: { id: projectId },
    data: { configSnapshot: prismaNs.DbNull },
  });
}

/** Read a project's raw `configSnapshot` column (never exposed by the list API — Stage 22 D-10). */
export async function readConfigSnapshot(projectId: string) {
  const db = await testDb();
  const row = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { configSnapshot: true },
  });
  return row.configSnapshot as {
    takenAt: string;
    componentTypes: Array<{ id: string; code: string; name: string; active: boolean }>;
  } | null;
}

/** Close the pooled connection — call once in a suite's afterAll if this helper was used. */
export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
