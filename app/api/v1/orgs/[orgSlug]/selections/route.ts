import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError } from "@/lib/api-auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiBadRequest,
  apiServerError,
} from "@/lib/api-error";
import { listSelections, createSelection } from "@/lib/data/selections";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/selections?projectId= ────────────────────────

/**
 * List all Selections for a project, ordered by orderIndex.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listSelections()
 *          which verifies the project belongs to the session's org before
 *          returning any rows (returns [] rather than leaking cross-org existence).
 *
 * Query params:
 *   projectId (required) — ID of the project to list selections for.
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
    console.error("[GET /api/v1/orgs/[orgSlug]/selections]", err);
    return apiServerError();
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return apiBadRequest("projectId query parameter is required");
  }

  try {
    const selections = await listSelections(session, projectId);
    return NextResponse.json({ selections });
  } catch (err) {
    console.error("[GET /api/v1/orgs/[orgSlug]/selections] listSelections", err);
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/selections ──────────────────────────────────

/**
 * Create a new Selection on a project.
 *
 * Auth: any authenticated org member (no specific RBAC permission required).
 * Body: { projectId, componentTypeId, label, config, orderIndex }
 *
 * Returns 201 with the created selection on success.
 * Returns 400 on missing required fields or tenancy violations (project/type not in org).
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
    console.error("[POST /api/v1/orgs/[orgSlug]/selections]", err);
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : null;
  const componentTypeId =
    typeof body.componentTypeId === "string"
      ? body.componentTypeId.trim()
      : null;
  const label =
    typeof body.label === "string" ? body.label.trim() : null;
  const orderIndex =
    typeof body.orderIndex === "number"
      ? body.orderIndex
      : typeof body.orderIndex === "string"
        ? parseInt(body.orderIndex, 10)
        : 0;

  // config: JSONB object — keys are FieldEntry.key, values are primitives.
  const config =
    typeof body.config === "object" &&
    body.config !== null &&
    !Array.isArray(body.config)
      ? (body.config as Record<string, string | boolean | number | null>)
      : {};

  if (!projectId || !componentTypeId || !label) {
    return apiBadRequest("projectId, componentTypeId, and label are required");
  }

  try {
    const selection = await createSelection(session, {
      projectId,
      componentTypeId,
      label,
      config,
      orderIndex: isNaN(orderIndex) ? 0 : orderIndex,
    });
    return NextResponse.json({ selection }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      // DAL throws descriptive messages for tenancy violations.
      if (
        err.message.includes("not found") ||
        err.message.includes("access denied")
      ) {
        return apiBadRequest(err.message);
      }
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/selections] createSelection",
      err,
    );
    return apiServerError();
  }
}
