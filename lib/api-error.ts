import { NextResponse } from "next/server";

/**
 * Canonical error-response factories for API route handlers.
 *
 * Every route handler uses these instead of ad hoc NextResponse.json() calls
 * so the error shape is consistent across the entire /api/v1 surface.
 *
 * Shape: { error: string } — plus an optional machine-readable `code` (Stage 29: "ORG_SUSPENDED")
 * on the factories that accept one. Without a code the body is unchanged.
 */

/** Adds `code` to the body only when given, so existing callers' bodies stay byte-identical. */
function body(message: string, code?: string): { error: string; code?: string } {
  return code ? { error: message, code } : { error: message };
}

/** 400 Bad Request — invalid input or missing required field. */
export function apiBadRequest(message: string, code?: string): NextResponse {
  return NextResponse.json(body(message, code), { status: 400 });
}

/** 401 Unauthorized — no session, inactive account, or (placeholder) invalid Bearer token. */
export function apiUnauthorized(message = "Unauthorized", code?: string): NextResponse {
  return NextResponse.json(body(message, code), { status: 401 });
}

/** 403 Forbidden — authenticated but wrong org (cross-tenant guard), insufficient permission,
 * or a suspended org (`code: "ORG_SUSPENDED"`). */
export function apiForbidden(message = "Forbidden", code?: string): NextResponse {
  return NextResponse.json(body(message, code), { status: 403 });
}

/** 404 Not Found — org slug not found or resource not found. */
export function apiNotFound(message = "Not found", code?: string): NextResponse {
  return NextResponse.json(body(message, code), { status: 404 });
}

/** 409 Conflict — e.g. project number race collision. `extra` adds machine-readable fields
 * (Stage 29: `{ code: "USER_LIMIT_REACHED", limit, current }`) after `error`. */
export function apiConflict(message: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status: 409 });
}

/** 422 Unprocessable Entity — well-formed request, but the data it targets fails a business-rule check
 * (e.g. Stage 23's submit-design 13b data check, or a summary build that resolved but failed). */
export function apiUnprocessable(message: string, code?: string): NextResponse {
  return NextResponse.json(body(message, code), { status: 422 });
}

/** 500 Internal Server Error — unhandled exception in a route handler. */
export function apiServerError(message = "Internal server error", code?: string): NextResponse {
  return NextResponse.json(body(message, code), { status: 500 });
}
