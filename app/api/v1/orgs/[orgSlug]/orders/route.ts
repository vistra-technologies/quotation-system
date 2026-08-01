import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";

// Never cached — reads session cookie.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/orders ───────────────────────────────────────

/**
 * Orders list stub — returns an empty list with zero total.
 *
 * No Order model exists yet; the BOQ/Quotation/Order pipeline is a future stage.
 * This route exists to give the Orders list page the same parallel-fetch shape as
 * Inquiries and Projects (parallel /me + /orders), without any fake seed data or
 * a real DB-backed model.
 *
 * When the Order model is built, this handler will be replaced with a real
 * listOrdersPaginated DAL call (same pattern as listInquiriesPaginated).
 *
 * Auth: any authenticated org member — no RBAC gate (same as projects/inquiries).
 * Tenancy: enforced by getApiSession() (403 on cross-org).
 *
 * Response shape:
 *   { orders: [], total: 0, page: number, pageSize: number }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;

  try {
    await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[GET /api/v1/orgs/[orgSlug]/orders]", err);
    return apiServerError();
  }

  // No Order model — always returns empty list.
  const page = Math.max(
    1,
    parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1,
  );
  const pageSize = 20;

  return NextResponse.json({ orders: [], total: 0, page, pageSize });
}
