import { NextResponse } from "next/server";
import { getApiSession, ApiAuthError, apiAuthErrorResponse } from "@/lib/api-auth";
import {
  apiNotFound,
  apiConflict,
  apiServerError,
} from "@/lib/api-error";
import { applyConfigUpdate, getConfigUpdatePreview } from "@/lib/data/config-update";
import { isFormulaPinError } from "@/lib/data/formula-pin";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ orgSlug: string; projectId: string }> };

async function authed(request: Request, orgSlug: string) {
  try {
    return { session: await getApiSession(request, orgSlug) };
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return { res: apiAuthErrorResponse(err) };
    }
    log.error("[config-update] auth", { err });
    return { res: apiServerError() };
  }
}

/** GET — preview what changed and what needs fixing (Hotfix 2026-10-01, H-6). Any org member; DRAFT only. */
export const GET = withRoute(
  "GET /api/v1/orgs/[orgSlug]/projects/[projectId]/config-update",
  async (request: Request, { params }: Ctx) => {
  const { orgSlug, projectId } = await params;
  const a = await authed(request, orgSlug);
  if (a.res) return a.res;
  try {
    const result = await getConfigUpdatePreview(a.session!, projectId);
    if (result === null) return apiNotFound("Project not found");
    if ("notDraft" in result) return apiConflict("Configuration can only be updated while the project is DRAFT");
    return NextResponse.json(result);
  } catch (err) {
    log.error("[GET config-update]", { err });
    return apiServerError();
  }
});

/** POST { fixes } — apply in one transaction. 409 not DRAFT / formula-set problem; 422 selections still invalid. */
export const POST = withRoute(
  "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/config-update",
  async (request: Request, { params }: Ctx) => {
  const { orgSlug, projectId } = await params;
  const a = await authed(request, orgSlug);
  if (a.res) return a.res;

  let fixes: Record<string, Record<string, string | boolean>> = {};
  try {
    const body = (await request.json()) as { fixes?: unknown };
    if (body.fixes && typeof body.fixes === "object" && !Array.isArray(body.fixes)) {
      fixes = body.fixes as typeof fixes;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await applyConfigUpdate(a.session!, projectId, fixes);
    if (result === null) return apiNotFound("Project not found");
    if ("notDraft" in result) return apiConflict("Configuration can only be updated while the project is DRAFT");
    if ("invalid" in result) {
      return NextResponse.json({ error: "Some selections still need fixing", invalid: result.invalid }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (isFormulaPinError(err)) return apiConflict(err.message);
    log.error("[POST config-update]", { err });
    return apiServerError();
  }
});
