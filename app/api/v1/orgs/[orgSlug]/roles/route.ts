import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { requirePermission, PERMISSIONS, ForbiddenError } from "@/lib/rbac";
import { listRoles, createRole } from "@/lib/data/admin";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/roles ────────────────────────────────────────

/**
 * List all roles for the session org, A→Z, with full data (id, name, description).
 *
 * Auth: authenticated org member with MANAGE_USERS or MANAGE_FEATURES permission.
 *
 * Permission note:
 *   - MANAGE_USERS: needed by the user-admin form's role dropdown (any user manager
 *     must be able to assign roles when creating or editing users).
 *   - MANAGE_FEATURES: needed by the admin/roles/* pages for role administration.
 *   Either permission is sufficient — the caller context determines which applies.
 *
 * Updated in Batch 6 (from Batch 5's MANAGE_USERS-only / compact-list variant):
 *   - Response now includes `description` (was id+name-only in Batch 5) so the
 *     admin roles list page can display descriptions without an extra per-role fetch.
 *   - Gate extended to MANAGE_USERS OR MANAGE_FEATURES to serve both callers.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listRoles()
 *          filtering on session.organizationId.
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
    console.error("[GET /api/v1/orgs/[orgSlug]/roles]", err);
    return apiServerError();
  }

  // Check MANAGE_USERS first; fall through to MANAGE_FEATURES if not held.
  let hasPermission = false;
  try {
    await requirePermission(session, PERMISSIONS.MANAGE_USERS);
    hasPermission = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) {
      console.error("[GET /api/v1/orgs/[orgSlug]/roles] requirePermission(MANAGE_USERS)", err);
      return apiServerError();
    }
  }
  if (!hasPermission) {
    try {
      await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
      hasPermission = true;
    } catch (err) {
      if (err instanceof ForbiddenError) return apiForbidden(err.message);
      console.error("[GET /api/v1/orgs/[orgSlug]/roles] requirePermission(MANAGE_FEATURES)", err);
      return apiServerError();
    }
  }

  try {
    const roles = await listRoles(session);
    return NextResponse.json({ roles });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/roles] listRoles", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/roles ───────────────────────────────────────

/**
 * Create a new role scoped to the session org.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Body: { name: string, description?: string | null }
 *
 * Returns 201 with { role } on success (full role row including id).
 * Returns 400 if name is missing.
 * Returns 403 if MANAGE_FEATURES is not held.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org); createRole() scopes
 *          the new role to session.organizationId.
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
    console.error("[POST /api/v1/orgs/[orgSlug]/roles]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error("[POST /api/v1/orgs/[orgSlug]/roles] requirePermission", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const name =
    typeof body.name === "string" ? body.name.trim() : null;
  if (!name) return apiBadRequest("name is required");

  const description =
    typeof body.description === "string"
      ? body.description.trim() || null
      : null;

  try {
    const role = await createRole(session, { name, description });
    return NextResponse.json({ role }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/v1/orgs/[orgSlug]/roles] createRole", err);
    return apiServerError();
  }
}
