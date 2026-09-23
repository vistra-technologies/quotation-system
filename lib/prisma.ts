import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 uses driver adapters instead of a bundled query engine.
// The pg adapter opens the actual Postgres connection from DATABASE_URL.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Reuse a single PrismaClient across hot-reloads in dev to avoid exhausting
// database connections. In production a fresh instance per lambda is fine.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Global omit: materialByRoom is a large JSONB field produced by the formula
// evaluator (Batch 5). It is never needed by any read path today — always omit
// it from every query so callers can't accidentally surface it. Any code that
// genuinely needs it must opt back in with a raw query or a separate targeted
// read. See plan.md D-1 for the rationale for client-level vs. query-level omit.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    omit: { projectCalculation: { materialByRoom: true } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
