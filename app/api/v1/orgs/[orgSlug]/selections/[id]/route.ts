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
import { updateSelection, deleteSelection } from "@/lib/data/selections";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── PATCH /api/v1/orgs/[orgSlug]/selections/[id] ────────────────────────────

/**
 * Update a Selection's label and/or config. componentTypeId is not patchable.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { label?, config? } — at least one field required.
 * Tenancy: enforced by getApiSession() (403 on cross-org) and updateSelection()
 *          which verifies the selection belongs to the session's org.
 *
 * Returns 200 with the updated selection on success.
 * Returns 404 when the selection is not found in the session's org.
 * Returns 400 on invalid body (no patchable fields provided).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; id: string }> },
) {
  const { orgSlug, id } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[PATCH /api/v1/orgs/[orgSlug]/selections/[id]]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const label =
    typeof body.label === "string" ? body.label.trim() : undefined;

  // config: JSONB object — keys are FieldEntry.key, values are primitives.
  const config =
    typeof body.config === "object" &&
    body.config !== null &&
    !Array.isArray(body.config)
      ? (body.config as Record<string, string | boolean | number | null>)
      : undefined;

  // At least one patchable field must be present.
  if (label === undefined && config === undefined) {
    return apiBadRequest("At least one of label or config must be provided");
  }

  try {
    const selection = await updateSelection(session, id, { label, config });
    if (!selection) {
      return apiNotFound("Selection not found or access denied");
    }
    return NextResponse.json({ selection });
  } catch (err) {
    console.error(
      "[PATCH /api/v1/orgs/[orgSlug]/selections/[id]] updateSelection",
      err,
    );
    return apiServerError();
  }
}

// ─── DELETE /api/v1/orgs/[orgSlug]/selections/[id] ───────────────────────────

/**
 * Delete a saved component (Selection) from the Configuration page.
 *
 * Auth: any authenticated org member (matches the PATCH gate on this route).
 * Tenancy: enforced by getApiSession() and deleteSelection() (org-scoped lookup).
 *
 * Returns 409 if the component is still assigned to a panel/edge in any
 * Partition's design elsewhere in the project — refuses rather than silently
 * orphaning the reference.
 * Returns 404 if the selection does not exist or belongs to a different org.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; id: string }> },
) {
  const { orgSlug, id } = await params;

  let session;
  try {
    session = await getApiSession(request, orgSlug);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      if (err.status === 401) return apiUnauthorized(err.message);
      if (err.status === 403) return apiForbidden(err.message);
      if (err.status === 404) return apiNotFound(err.message);
    }
    console.error("[DELETE /api/v1/orgs/[orgSlug]/selections/[id]]", err);
    return apiServerError();
  }

  try {
    const result = await deleteSelection(session, id);
    if (result === null) {
      return apiNotFound("Selection not found or access denied");
    }
    if ("inUseCount" in result) {
      return apiConflict(
        `This component is used on ${result.inUseCount} wall/panel(s) in Design — remove those assignments first.`,
      );
    }
    return NextResponse.json({ id });
  } catch (err) {
    console.error(
      "[DELETE /api/v1/orgs/[orgSlug]/selections/[id]] deleteSelection",
      err,
    );
    return apiServerError();
  }
}
