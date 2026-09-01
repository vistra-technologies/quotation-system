/**
 * SuperAdmin session guard — analogous to requirePermission() in lib/rbac.ts.
 *
 * SuperAdmin sessions are stored in the SuperAdminSession table and carried in
 * a distinct apex-only cookie (qs-sa-token, no Domain attribute) so they never
 * bleed into org subdomains. This is the primary enforcement point for the
 * /controls/** route subtree.
 *
 * See the architectural decision note in stage-16.md Migration 1 for why
 * SuperAdmin sessions do NOT go through better-auth's Session table.
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

/** Name of the apex-only SuperAdmin session cookie. */
export const SA_SESSION_COOKIE = "qs-sa-token";

/**
 * Shape returned by requireSuperAdmin() on success.
 * Callers get the superAdminId and username for logging / audit trail writes.
 */
export type SuperAdminSessionData = {
  superAdminId: string;
  username: string;
  sessionId: string;
};

/**
 * Thrown when no valid SuperAdmin session is present (not authenticated as SuperAdmin).
 * Callers should redirect to /controls/login.
 */
export class SuperAdminUnauthorizedError extends Error {
  constructor(message = "SuperAdmin authentication required") {
    super(message);
    this.name = "SuperAdminUnauthorizedError";
  }
}

/**
 * Assert that the current request carries a valid, unexpired SuperAdmin session.
 *
 * Reads the qs-sa-token cookie, looks up the SuperAdminSession row, and checks
 * expiry. Throws SuperAdminUnauthorizedError on any failure (absent, expired,
 * or not found) — so callers cannot distinguish between "no cookie" and "invalid
 * token" (prevents enumeration).
 *
 * Use this in Server Components (reads Next.js cookies()) or API route handlers
 * (use requireSuperAdminFromRequest() instead).
 *
 * @throws SuperAdminUnauthorizedError — if no valid SuperAdmin session exists.
 */
export async function requireSuperAdmin(): Promise<SuperAdminSessionData> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SA_SESSION_COOKIE)?.value;

  if (!token) {
    throw new SuperAdminUnauthorizedError();
  }

  return _resolveSession(token);
}

/**
 * Route-handler variant of requireSuperAdmin().
 *
 * Reads the qs-sa-token cookie from the incoming Request's Cookie header
 * rather than calling Next.js cookies() (which is only available in Server
 * Components and Server Actions, not in Route Handlers).
 *
 * @throws SuperAdminUnauthorizedError — if no valid SuperAdmin session exists.
 */
export async function requireSuperAdminFromRequest(
  request: Request,
): Promise<SuperAdminSessionData> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = _extractCookieValue(cookieHeader, SA_SESSION_COOKIE);

  if (!token) {
    throw new SuperAdminUnauthorizedError();
  }

  return _resolveSession(token);
}

/**
 * Look up a SuperAdminSession by token, verify expiry, and return the session data.
 * Shared by both requireSuperAdmin() and requireSuperAdminFromRequest().
 */
async function _resolveSession(token: string): Promise<SuperAdminSessionData> {
  const session = await prisma.superAdminSession.findUnique({
    where: { token },
    include: { superAdmin: { select: { id: true, username: true } } },
  });

  if (!session) {
    throw new SuperAdminUnauthorizedError();
  }

  if (session.expiresAt < new Date()) {
    throw new SuperAdminUnauthorizedError("SuperAdmin session has expired");
  }

  return {
    superAdminId: session.superAdmin.id,
    username: session.superAdmin.username,
    sessionId: session.id,
  };
}

/**
 * Extract a named cookie value from a raw Cookie header string.
 * e.g. "foo=bar; qs-sa-token=abc123" → "abc123" for name "qs-sa-token".
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
