import { NextResponse } from "next/server";

/**
 * Canonical error-response factories for API route handlers.
 *
 * Every route handler uses these instead of ad hoc NextResponse.json() calls
 * so the error shape is consistent across the entire /api/v1 surface.
 *
 * Shape: { error: string }
 */

/** 400 Bad Request — invalid input or missing required field. */
export function apiBadRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** 401 Unauthorized — no session, inactive account, or (placeholder) invalid Bearer token. */
export function apiUnauthorized(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/** 403 Forbidden — authenticated but wrong org (cross-tenant guard) or insufficient permission. */
export function apiForbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/** 404 Not Found — org slug not found or resource not found. */
export function apiNotFound(message = "Not found"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** 409 Conflict — e.g. project number race collision. */
export function apiConflict(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 409 });
}

/** 422 Unprocessable Entity — well-formed request, but the data it targets fails a business-rule check
 * (e.g. Stage 23's submit-design 13b data check, or a summary build that resolved but failed). */
export function apiUnprocessable(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 422 });
}

/** 500 Internal Server Error — unhandled exception in a route handler. */
export function apiServerError(message = "Internal server error"): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 });
}
