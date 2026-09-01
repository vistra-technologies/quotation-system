import { NextResponse } from "next/server";
import { SA_SESSION_COOKIE } from "@/lib/superadmin-guard";
import { deleteSuperAdminSession } from "@/lib/data/superadmin/sessions";

// Never cached.
export const dynamic = "force-dynamic";

// ─── POST /api/v1/superadmin/logout ─────────────────────────────────────────
//
// Terminates the SuperAdmin session identified by the qs-sa-token cookie.
// Idempotent: if no valid session cookie is present, still returns { ok: true }
// and clears the cookie (noop for a browser that already has no cookie).
//
// Deliberately does NOT call requireSuperAdminFromRequest() — an unauthenticated
// logout is safe and should succeed silently (the cookie is already gone or
// was never set; the session row, if any, is deleted anyway).

export async function POST(request: Request): Promise<NextResponse> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = _extractCookieValue(cookieHeader, SA_SESSION_COOKIE);

  if (token) {
    // Best-effort delete — ignore errors (e.g., token already expired and GC'd).
    try {
      await deleteSuperAdminSession(token);
    } catch (err) {
      console.error("[POST /api/v1/superadmin/logout] session delete error", err);
    }
  }

  // Clear the cookie regardless of whether a session row existed.
  // Max-Age=0 instructs the browser to delete the cookie immediately.
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SA_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

/**
 * Extract a named cookie value from a raw Cookie header string.
 * Mirrors the private helper in lib/superadmin-guard.ts.
 * Duplicated here to avoid importing the guard (which exports the public API
 * for Server Components, not route handlers that skip auth on logout).
 */
function _extractCookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key?.trim() === name) {
      return rest.join("=").trim() || undefined;
    }
  }
  return undefined;
}
