import { NextResponse } from "next/server";
import {
  requireSuperAdminFromRequest,
  SuperAdminUnauthorizedError,
} from "@/lib/superadmin-guard";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/ping ────────────────────────────────────────────
//
// SuperAdmin health-check endpoint — Batch A behavioral test target.
// Returns 200 to a valid SuperAdmin session, 401 to anything else.
// This route is intentionally minimal; it exists to let Batch A tests verify
// that requireSuperAdmin() correctly rejects org User sessions without needing
// the full login UI (which ships in Batch B).

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const sa = await requireSuperAdminFromRequest(request);
    return NextResponse.json({ ok: true, username: sa.username });
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/v1/superadmin/ping]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
