import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Typed shape returned by getSession().  The authoritative organizationId comes
 * from the better-auth session record — NOT from the proxy's x-org-id header.
 */
export type SessionData = {
  userId: string;
  organizationId: string;
  roleId: string;
  externalCompanyId: string | null;
  username: string;
  name: string;
};

/**
 * Server-Component-safe session accessor.
 *
 * Reads the better-auth session cookie via the auth API.  Returns null when:
 * - No session cookie is present (not logged in), or
 * - The user's `active` flag is false (instant deactivation — no session purge needed), or
 * - The proxy's x-org-id header is absent or does not match the session's organizationId
 *   (cross-tenant session replay guard — fail-closed).
 */
export async function getSession(): Promise<SessionData | null> {
  // Capture once so we can both pass to auth and inspect for the org-id check below.
  const requestHeaders = await headers();

  const sessionData = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!sessionData) {
    return null;
  }

  const { user } = sessionData;

  // Instant deactivation: treat inactive users as unauthenticated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(user as any).active) {
    return null;
  }

  // Cast through any because TypeScript may not resolve the additionalFields
  // generic fully here; the shape is guaranteed by the betterAuth config in
  // lib/auth.ts (organizationId, username, roleId, externalCompanyId, active).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;

  // Cross-tenant session replay guard.
  //
  // proxy.ts sets x-org-id from the first URL path segment on every org-scoped
  // request (e.g. /acme-glass/dashboard → x-org-id: <acme-glass uuid>).
  // Apex requests (e.g. /, /login) have no org path segment and arrive without the header.
  //
  // Fail-closed on both cases:
  //   - Header absent  → no org context; reject (apex routes don't need auth).
  //   - Header present but mismatches session's organizationId → cross-org replay; reject.
  //
  // This closes the gap where a session cookie (shared across all orgs on the one host)
  // could be replayed against a different org's path and receive a 200 with the wrong data.
  const proxyOrgId = requestHeaders.get("x-org-id");
  if (!proxyOrgId || proxyOrgId !== (u.organizationId as string)) {
    return null;
  }

  return {
    userId: u.id as string,
    organizationId: u.organizationId as string,
    roleId: u.roleId as string,
    externalCompanyId: (u.externalCompanyId as string | null | undefined) ?? null,
    username: u.username as string,
    name: u.name as string,
  };
}
