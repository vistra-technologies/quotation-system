import { NextResponse } from "next/server";
import { apiServerError } from "@/lib/api-error";
import { listOrganizationsForSelector } from "@/lib/data/admin";

// Never cached — org list should always be live.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs ────────────────────────────────────────────────────────

/**
 * List all organizations as minimal selector items.
 *
 * Auth: NONE — this endpoint is intentionally public so the apex org-selector
 * page (app/page.tsx) and the login page can fetch the list without a session.
 *
 * Returns: { orgs: Array<{ id, slug, name }> } ordered A→Z by name.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const orgs = await listOrganizationsForSelector();
    return NextResponse.json({ orgs });
  } catch (err) {
    console.error("[GET /api/v1/orgs]", err);
    return apiServerError();
  }
}
