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
import {
  listComponentTypes,
  createComponentType,
} from "@/lib/data/components";
import type { FieldEntry } from "@/lib/data/components";

// Never cached — reads session cookie and live DB data.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs/[orgSlug]/component-types ──────────────────────────────

/**
 * List all ComponentTypes for the org, A→Z by code.
 *
 * Auth: any authenticated org member — no RBAC permission required.
 *
 * This endpoint is intentionally ungated beyond authentication because it
 * serves as the component palette source for the project configuration page,
 * which any authenticated user may access. The admin CRUD screens (create,
 * edit) are gated via MANAGE_FEATURES on the write endpoints and at the page
 * level — not on this list read.
 *
 * Tenancy: enforced by getApiSession() (403 on cross-org) and listComponentTypes()
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
    console.error("[GET /api/v1/orgs/[orgSlug]/component-types]", err);
    return apiServerError();
  }

  try {
    const componentTypes = await listComponentTypes(session);
    return NextResponse.json({ componentTypes });
  } catch (err) {
    console.error(
      "[GET /api/v1/orgs/[orgSlug]/component-types] listComponentTypes",
      err,
    );
    return apiServerError();
  }
}

// ─── POST /api/v1/orgs/[orgSlug]/component-types ─────────────────────────────

/**
 * Create a new ComponentType in the org.
 *
 * Auth: authenticated org member with MANAGE_FEATURES permission.
 * Body: { code, name, categoryId, fieldsSchema, active? }
 *
 * Returns 201 with the created component type on success.
 * Returns 400 on missing or invalid fields, or if categoryId is not in the org.
 * Returns 403 if the session role lacks MANAGE_FEATURES.
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
    console.error("[POST /api/v1/orgs/[orgSlug]/component-types]", err);
    return apiServerError();
  }

  try {
    await requirePermission(session, PERMISSIONS.MANAGE_FEATURES);
  } catch (err) {
    if (err instanceof ForbiddenError) return apiForbidden(err.message);
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/component-types] requirePermission",
      err,
    );
    return apiServerError();
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return apiBadRequest("Request body must be valid JSON");
  }

  const code =
    typeof body.code === "string" ? body.code.trim().toUpperCase() : null;
  const name = typeof body.name === "string" ? body.name.trim() : null;
  const categoryId =
    typeof body.categoryId === "string" ? body.categoryId.trim() : null;
  const fieldsSchema = Array.isArray(body.fieldsSchema)
    ? (body.fieldsSchema as FieldEntry[])
    : [];
  const active =
    typeof body.active === "boolean" ? body.active : true;

  if (!code || !name || !categoryId) {
    return apiBadRequest("code, name, and categoryId are required");
  }

  try {
    const componentType = await createComponentType(session, {
      code,
      name,
      categoryId,
      fieldsSchema,
      active,
    });
    return NextResponse.json({ componentType }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes("not found") ||
        err.message.includes("access denied")
      ) {
        return apiBadRequest(err.message);
      }
    }
    console.error(
      "[POST /api/v1/orgs/[orgSlug]/component-types] createComponentType",
      err,
    );
    return apiServerError();
  }
}
