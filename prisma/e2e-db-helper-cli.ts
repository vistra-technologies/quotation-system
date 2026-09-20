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
        await db.componentType.delete({ where: { id: componentTypeId } });
        return null;
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
