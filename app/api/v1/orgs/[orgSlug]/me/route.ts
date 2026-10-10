import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiBadRequest,
  apiNotFound,
  apiServerError,
} from "@/lib/api-error";
import {
  getOrgById,
  getSessionRole,
  getSessionRolePermissions,
} from "@/lib/data/admin";
import { getExternalCompanyById } from "@/lib/data/external-companies";
import { getOwnProfile, updateOwnProfile } from "@/lib/data/users";
import { parseOwnProfileInput } from "@/lib/own-profile";
import { PERMISSIONS } from "@/lib/rbac";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/me ───────────────────────────────────────────

/**
 * Return the current session user's identity and permissions for this org.
 *
 * Auth: any authenticated org member — no RBAC gate beyond a valid session.
 * Returns 401 if there is no session; 403 if the session belongs to a different
 * org; 404 if the org slug is not found.
 *
 * Response shape:
 *   {
 *     userId, name, username,          // identity
 *     externalCompanyId,               // null for internal users
 *     externalCompanyName,             // null for internal users or unknown company
 *     orgName,                         // organization display name
 *     roleName,                        // user's role display name
 *     firstName, lastName, mobile, profileEmail,  // own editable profile (Hotfix 2026-10-10)
 *     permissionCodes: string[],       // ALL effective permission codes for this role
 *     adminPermissions: string[],      // subset: MANAGE_USERS / MANAGE_FEATURES / MANAGE_PRICING only
 *   }
 *
 * Consumers:
 *   - app/[orgSlug]/layout.tsx  — uses name, roleName, externalCompanyName, adminPermissions for shell chrome
 *   - app/[orgSlug]/admin/layout.tsx  — uses adminPermissions.length to gate the whole /admin/* sub-tree
 *   - app/[orgSlug]/dashboard/page.tsx  — uses orgName, roleName, permissionCodes
 *   - admin/catalog/*, admin/external-companies/*
 *     — use adminPermissions to gate MANAGE_FEATURES / MANAGE_USERS checks at page level
 *   - app/[orgSlug]/projects/new/page.tsx, inquiries/new/page.tsx
 *     — use externalCompanyId for locked-client UI branching
 *
 * Bugfix 2026-09-28: adminPermissions previously only ever included MANAGE_USERS /
 * MANAGE_FEATURES, so a MANAGE_PRICING-only role (e.g. Company Member) had an empty
 * adminPermissions array and was bounced by the admin/layout.tsx length===0 gate before
 * ever reaching /admin/inventory's own (correct) MANAGE_PRICING check — a regression from
 * Hotfix 2026-09-27 H-1 moving Inventory under /admin/*. Widened to include MANAGE_PRICING
 * so any of the three admin-adjacent permissions clears the layout gate; each page under
 * /admin/* still does its own specific permission check (verified: catalog + external-companies
 * check adminPermissions.includes(...) explicitly; users/* and inventory/* rely on their
 * backing API routes' own requirePermission() gate — see inventory-gate-fix.md).
 */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/me",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) => {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("me: session", { err });
    return apiServerError();
  }

  try {
    // Parallel: org name, role name, all permission codes, and (if applicable)
    // the linked external company name.
    const [org, role, permissionCodes, externalCompany, profile] = await Promise.all([
      getOrgById(session.organizationId),
      getSessionRole(session),
      getSessionRolePermissions(session),
      session.externalCompanyId
        ? getExternalCompanyById(session, session.externalCompanyId)
        : Promise.resolve(null),
      getOwnProfile(session),
    ]);

    const adminPermissions = permissionCodes.filter(
      (c) =>
        c === PERMISSIONS.MANAGE_USERS ||
        c === PERMISSIONS.MANAGE_FEATURES ||
        c === PERMISSIONS.MANAGE_PRICING,
    );

    return NextResponse.json({
      userId: session.userId,
      name: session.name,
      username: session.username,
      externalCompanyId: session.externalCompanyId,
      externalCompanyName: externalCompany?.name ?? null,
      orgName: org?.name ?? session.organizationId,
      roleName: role?.name ?? session.roleId,
      firstName: profile?.firstName ?? "",
      lastName: profile?.lastName ?? "",
      mobile: profile?.mobile ?? null,
      profileEmail: profile?.profileEmail ?? null,
      permissionCodes,
      adminPermissions,
    });
  } catch (err) {
    log.error("me: data fetch", { err });
    return apiServerError();
  }
});

// ─── PATCH /api/v1/orgs/[orgSlug]/me ─────────────────────────────────────────

/**
 * Update the session user's OWN profile (Hotfix 2026-10-10, My Account popup).
 *
 * Auth: any authenticated org member (getApiSession only; no RBAC permission). The target row is
 * always the session user: the id never comes from the body.
 * Body: { firstName?, lastName?, mobile?, profileEmail? } and nothing else. Any other key
 * (username, roleId, organizationId, externalCompanyId, active, email, ...) is rejected with 400.
 * `name` is recomputed from first + last name. `profileEmail` is User.profileEmail, never User.email.
 *
 * Returns 200 { ok, firstName, lastName, mobile, profileEmail, name }; 400 on validation;
 * 401/403 via getApiSession (no session, cross-org, suspended org); 404 if the row is gone.
 */
export const PATCH = withRoute(
  "PATCH /api/v1/orgs/[orgSlug]/me",
  async (
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) => {
  const { orgSlug } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return apiAuthErrorResponse(err);
    }
    log.error("me: patch session", { err });
    return apiServerError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const parsed = parseOwnProfileInput(body);
  if (!parsed.ok) return apiBadRequest(parsed.error);

  try {
    await updateOwnProfile(session, parsed.input);
    const profile = await getOwnProfile(session);
    if (!profile) return apiNotFound("User not found");
    return NextResponse.json({
      ok: true,
      firstName: profile.firstName,
      lastName: profile.lastName,
      mobile: profile.mobile,
      profileEmail: profile.profileEmail,
      name: profile.name,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found or access denied")) {
      return apiNotFound("User not found");
    }
    log.error("me: patch update", { err });
    return apiServerError();
  }
});
