import { NextResponse } from "next/server";
import { apiBadRequest, apiNotFound, apiServerError } from "@/lib/api-error";
import { getPublicOrgById, getPublicOrgBySlug } from "@/lib/data/admin";
import { log } from "@/lib/logger";
import { withRoute } from "@/lib/with-route";

// Never cached — org lookups should always be live.
export const dynamic = "force-dynamic";

// ─── GET /api/v1/orgs ────────────────────────────────────────────────────────

/**
 * Look up ONE organization as a minimal selector item (Stage 31 S31-6).
 *
 * Auth: NONE — intentionally public so the org login page can resolve its own org (and a
 * cross-org session's org name) without a session. It never lists organizations.
 *
 * Query: exactly one of `?slug=<slug>` or `?id=<id>`.
 * Returns 200 { org: { id, slug, name } }; 404 { error: "Organization not found" } when unknown;
 * 400 when neither or both parameters are given.
 */
export const GET = withRoute(
  "GET /api/v1/orgs",
  async (request: Request): Promise<NextResponse> => {
  const params = new URL(request.url).searchParams;
  const slug = params.get("slug");
  const id = params.get("id");

  if ((!slug && !id) || (slug && id)) {
    return apiBadRequest("Provide exactly one of slug or id");
  }

  try {
    const org = slug ? await getPublicOrgBySlug(slug) : await getPublicOrgById(id as string);
    if (!org) return apiNotFound("Organization not found");
    return NextResponse.json({ org });
  } catch (err) {
    log.error("[GET /api/v1/orgs]", { err });
    return apiServerError();
  }
});
