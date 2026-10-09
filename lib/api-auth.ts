import type { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/api-error";
import { ORG_SUSPENDED_CODE, ORG_SUSPENDED_MESSAGE } from "@/lib/org-suspended";
import type { SessionData } from "@/lib/session";

/**
 * Thrown by getApiSession() on authentication or authorization failure.
 *
 * status 401 — no session, inactive account, or unsupported Bearer token
 * status 403 — session exists but the user belongs to a different org (cross-tenant guard),
 *              or the org is suspended (code "ORG_SUSPENDED", Stage 29 S29-9)
 * status 404 — the orgSlug in the URL does not resolve to any organization
 *
 * `code` is an optional machine-readable discriminator that apiAuthErrorResponse() puts in the body.
 */
export class ApiAuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/**
 * Maps an ApiAuthError to its JSON response (401/403/404, plus `code` when set).
 * Shared by every org route handler's catch block (Stage 29 replaced the copy-pasted mapping).
 */
export function apiAuthErrorResponse(err: ApiAuthError): NextResponse {
  if (err.status === 401) return apiUnauthorized(err.message, err.code);
  if (err.status === 403) return apiForbidden(err.message, err.code);
  return apiNotFound(err.message, err.code);
}

/**
 * Suspension guard for the few routes that authenticate WITHOUT an orgSlug (the global
 * /api/v1/permissions catalog), where getApiSession()'s step 4 cannot run. Same rule, same body:
 * an uncached read of the session's own org, so a suspended org's existing session is refused on
 * its very next request.
 *
 * @throws ApiAuthError(401) — the session's org no longer exists
 * @throws ApiAuthError(403) — the org is suspended (code "ORG_SUSPENDED")
 */
export async function assertSessionOrgNotSuspended(organizationId: string): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { isSuspended: true },
  });
  if (!org) throw new ApiAuthError(401, "Not authenticated");
  if (org.isSuspended) throw new ApiAuthError(403, ORG_SUSPENDED_MESSAGE, ORG_SUSPENDED_CODE);
}

/**
 * Route-handler-safe session resolver — the API-layer replacement for lib/session.ts's getSession().
 *
 * Cannot use getSession() here because proxy.ts's matcher EXCLUDES all /api/* paths, so API route
 * handlers never receive the x-org-id/x-org-slug headers that getSession() depends on.  Instead
 * this function resolves tenancy directly from the URL's orgSlug parameter.
 *
 * Steps:
 * 1. Reject Bearer token (placeholder seam for future external-consumer auth — not implemented yet).
 * 2. Read the better-auth session from the forwarded cookie.
 * 3. Reject inactive accounts (instant deactivation, same rule as getSession()).
 * 4. Resolve the org by orgSlug from the DB (its own uncached read) and refuse a suspended org with
 *    403 ORG_SUSPENDED.  Immediate: an existing session is refused on its very next request.
 * 5. Cross-tenant guard: user.organizationId must match org.id.  This is the same invariant that
 *    proxy.ts + getSession() enforce for UI routes — the single highest-risk check in this file.
 * 6. Return SessionData (same shape as lib/session.ts).
 *
 * @throws ApiAuthError(401) — no session, inactive user, or unsupported Bearer token
 * @throws ApiAuthError(403) — session belongs to a different org (cross-tenant replay attempt),
 *                             or the org is suspended (code "ORG_SUSPENDED")
 * @throws ApiAuthError(404) — orgSlug not found in the database
 */
export async function getApiSession(
  request: Request,
  orgSlug: string,
): Promise<SessionData> {
  // ── Step 1: Bearer token seam (not yet supported) ──────────────────────────
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    throw new ApiAuthError(401, "Bearer token authentication not yet supported");
  }

  // ── Step 2: Session from cookie ─────────────────────────────────────────────
  const sessionData = await auth.api.getSession({ headers: request.headers });

  if (!sessionData) {
    throw new ApiAuthError(401, "Not authenticated");
  }

  const { user } = sessionData;
  // Cast through any: better-auth's TypeScript generics may not fully resolve
  // additionalFields here; the shape is guaranteed by lib/auth.ts's config.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = user as any;

  // ── Step 3: Deactivation guard ──────────────────────────────────────────────
  if (!u.active) {
    throw new ApiAuthError(401, "Account is deactivated");
  }

  // ── Step 4: Resolve org from slug (+ suspension check) ──────────────────────
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, isSuspended: true },
  });

  if (!org) {
    throw new ApiAuthError(404, "Organization not found");
  }

  // Suspended means no org-user access at all (S29-9). Uncached on purpose so it bites immediately.
  if (org.isSuspended) {
    throw new ApiAuthError(403, ORG_SUSPENDED_MESSAGE, ORG_SUSPENDED_CODE);
  }

  // ── Step 5: Cross-tenant guard (highest-risk line) ──────────────────────────
  // The session's organizationId must match the org resolved from the URL slug.
  // Without this check, a cookie issued for org A could be replayed against org B's
  // API routes and receive that org's data.
  if ((u.organizationId as string) !== org.id) {
    throw new ApiAuthError(403, "Access denied");
  }

  // ── Step 6: Return typed SessionData ────────────────────────────────────────
  // External is decided from the role, never from the company id. Missing role or a role
  // from another org => external (fail closed).
  const role = await prisma.role.findFirst({
    where: { id: u.roleId as string, organizationId: org.id },
    select: { isInternalRole: true },
  });

  return {
    userId: u.id as string,
    organizationId: u.organizationId as string,
    roleId: u.roleId as string,
    externalCompanyId: (u.externalCompanyId as string | null | undefined) ?? null,
    isExternal: role ? !role.isInternalRole : true,
    username: u.username as string,
    name: u.name as string,
  };
}
