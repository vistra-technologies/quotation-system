import { NextResponse } from "next/server";
import { pingHealthCheck } from "@/lib/data/admin";
import { log } from "@/lib/logger";

// Never cached — this route exists to prove live DB connectivity on each hit.
export const dynamic = "force-dynamic";

// Stage 1 health check: queries the database via Prisma and reports the result.
// A 200 with database: "connected" proves the full app -> Prisma -> Postgres chain works.
export async function GET() {
  try {
    const healthCheckRows = await pingHealthCheck();

    return NextResponse.json({
      status: "ok",
      database: "connected",
      healthCheckRows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Fixed public body (no driver/connection detail leaks); the cause goes to the log only.
    log.error("health.db_unreachable", { err: error });
    return NextResponse.json(
      {
        status: "error",
        database: "unreachable",
        message: "Database unreachable",
      },
      { status: 503 },
    );
  }
}
