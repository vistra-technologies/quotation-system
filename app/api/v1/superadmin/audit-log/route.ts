import { NextResponse } from "next/server";
import { requireSuperAdminFromRequest, SuperAdminUnauthorizedError } from "@/lib/superadmin-guard";
import { apiBadRequest, apiUnauthorized, apiServerError } from "@/lib/api-error";
import { parseAuditFilters } from "@/lib/superadmin-audit-view";
import { listAuditLog } from "@/lib/data/superadmin/audit-log";

// Never cached.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/superadmin/audit-log ────────────────────────────────────────
//
// Read-only list of SuperAdmin console actions, newest first (hotfix 2026-10-02). There are no write
// verbs on this route — the log is append-only and only written by the mutating routes themselves.
//
// Auth: valid SuperAdmin session (qs-sa-token cookie).
// Query (all optional):
//   scope    all (default) | platform (SuperAdmin console, no org) | org
//   orgId    with scope=org — only that org
//   by       actor username (matches deleted SuperAdmins via the stored snapshot)
//   verb     INSERT | UPDATE | DELETE
//   item     Organization | User | Role | Formula set | Component type | SuperAdmin
//   from/to  YYYY-MM-DD, inclusive (UTC)
//   hideTest 1 — exclude entries by the `testeraccount` SuperAdmin (total/paging follow the filtered set)
//   page     1-based; pageSize 1–100 (default 50)
// Returns 200 { entries, total, page, pageSize, facets: { orgs, admins, items } }; 400 bad filter; 401.

export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireSuperAdminFromRequest(request);
  } catch (err) {
    if (err instanceof SuperAdminUnauthorizedError) {
      return apiUnauthorized("SuperAdmin authentication required");
    }
    console.error("[GET /api/v1/superadmin/audit-log] auth error", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const parsed = parseAuditFilters((k) => searchParams.get(k));
  if (!parsed.ok) return apiBadRequest(parsed.error);

  try {
    return NextResponse.json(await listAuditLog(parsed.filters));
  } catch (err) {
    console.error("[GET /api/v1/superadmin/audit-log] listAuditLog", err);
    return apiServerError();
  }
}
