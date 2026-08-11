import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { listInquiriesPaginated, createInquiry } from "@/lib/data/inquiries";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a named date-range preset to { gte, lte } Date bounds.
 * All computation is server-side (UTC) — no timezone ambiguity from the client.
 */
function resolveDateRange(
  dateRange: string,
): { gte?: Date; lte?: Date } | null {
  const now = new Date();
  switch (dateRange) {
    case "today": {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setUTCHours(23, 59, 59, 999);
      return { gte: start, lte: end };
    }
    case "week": {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 7);
      return { gte: start };
    }
    case "month": {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      return { gte: start };
    }
    case "last30": {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 30);
      return { gte: start };
    }
    default:
      return null;
  }
}

// ─── GET /api/v1/orgs/[orgSlug]/inquiries ────────────────────────────────────

/**
 * List inquiries for the org with filtering, search, and pagination.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org).
 *
 * Query params:
 *   scope      "mine"|"all"  (default: "all")
 *   search     string        searches name + externalCompany.name (case-insensitive)
 *   dateRange  ""| "today"|"week"|"month"|"last30"  (default: "")
 *   page       number        1-based (default: 1)
 *   pageSize   number        1–100 (default: 20)
 *
 * Visibility rules (enforced in DAL from session — not URL params):
 *   scope=mine  → createdByUserId = session.userId (all user types)
 *   scope=all   → external user: externalCompanyId = session.externalCompanyId
 *               → internal user: full org scope
 *
 * Returns: { inquiries, total, page, pageSize }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/inquiries]", err);
    return apiServerError();
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";
  const search = url.searchParams.get("search") ?? "";
  const dateRangeKey = url.searchParams.get("dateRange") ?? "";
  const rawPage = parseInt(url.searchParams.get("page") ?? "1", 10);
  const rawPageSize = parseInt(url.searchParams.get("pageSize") ?? "20", 10);
  // externalCompanyId filter — only applied for internal users in the DAL.
  const externalCompanyId = url.searchParams.get("externalCompanyId") ?? "";

  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const pageSize =
    isNaN(rawPageSize) || rawPageSize < 1
      ? 20
      : rawPageSize > 100
        ? 100
        : rawPageSize;

  const dateRange = resolveDateRange(dateRangeKey);

  try {
    const { inquiries, total } = await listInquiriesPaginated(session, {
      scope,
      search: search.trim() || undefined,
      dateFrom: dateRange?.gte,
      dateTo: dateRange?.lte,
      page,
      pageSize,
      externalCompanyId: externalCompanyId || undefined,
    });
    return NextResponse.json({ inquiries, total, page, pageSize });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/inquiries] listInquiriesPaginated",
      err,
    );
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/inquiries ───────────────────────────────────

/**
 * Create a new inquiry in the org.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { name, destinationCountry, currency, externalCompanyId? }
 *
 * Returns 201 with the created inquiry on success.
 * Returns 400 on missing required fields or invalid external company.
 * Returns 409 on concurrent inquiryNumber collision.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/inquiries]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const name = typeof body.name === "string" ? body.name.trim() : null;
  const destinationCountry =
    typeof body.destinationCountry === "string"
      ? body.destinationCountry.trim()
      : null;
  const currency =
    typeof body.currency === "string"
      ? body.currency.trim().toUpperCase()
      : null;
  const projectLocation =
    typeof body.projectLocation === "string" && body.projectLocation.trim()
      ? body.projectLocation.trim()
      : null;
  const externalCompanyId =
    typeof body.externalCompanyId === "string" && body.externalCompanyId
      ? body.externalCompanyId
      : null;

  if (!name || !destinationCountry || !currency) {
    return apiBadRequest("name, destinationCountry, and currency are required");
  }

  try {
    const inquiry = await createInquiry(session, {
      name,
      destinationCountry,
      currency,
      projectLocation,
      externalCompanyId,
    });
    return NextResponse.json({ inquiry }, { status: 201 });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "SEQUENCE_CONFLICT"
    ) {
      return apiConflict(
        "An inquiry number conflict occurred — please try again.",
      );
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "INVALID_EXTERNAL_COMPANY"
    ) {
      return apiBadRequest("Selected company is invalid.");
    }
    console.error("[POST /api/v1/orgs/[orgSlug]/inquiries] createInquiry", err);
    return apiServerError();
  }
}
