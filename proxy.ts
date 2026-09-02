import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Tenant-resolution proxy — runs in Node.js runtime (Next.js 16 default).
// Do NOT set `export const runtime` here; it is not allowed in proxy files.
//
// Slug extraction strategy (Stage 10 subdomain routing):
//
//   Test / staging environment (*.test.easeetool.com):
//     test.easeetool.com                → apex passthrough (org selector on the test env).
//                                         Non-root paths (anything other than "/") are
//                                         rejected with 404 immediately — no DB lookup, no
//                                         path-segment extraction, no path-based org routing
//                                         on apex hosts. (Bug fix: BUG-3, bugs-2.md, 2026-07-23.)
//     {orgSlug}.test.easeetool.com      → extract leftmost label as orgSlug;
//                                         rewrite URL so app/[orgSlug]/... receives it.
//     These two branches MUST come before the bare *.easeetool.com branches below, because
//     both test.easeetool.com and {orgSlug}.test.easeetool.com also match
//     hostname.endsWith(".easeetool.com") — without the prior check, "test" would be
//     extracted as an org slug (no such org → 404). (Bug fix: bugs-1.md, 2026-07-23.)
//
//   Production (*.easeetool.com):
//     easeetool.com / www.easeetool.com → apex passthrough (org selector).
//                                         Same non-root-path 404 guard as test.easeetool.com
//                                         above — no path-based org routing on apex hosts.
//     {orgSlug}.easeetool.com           → extract subdomain as orgSlug;
//                                         rewrite URL so app/[orgSlug]/... receives it.
//                                         Guard: skip rewrite if path already starts with
//                                         /{orgSlug}/ to prevent double-prepend on a
//                                         re-entrant request.
//
//   Local dev / CI / Playwright (any non-easeetool.com host, e.g. localhost):
//     Falls back to path-segment extraction: pathname.split("/")[1].
//     No *.localhost DNS config needed — local/CI runs work exactly as before Stage 10.
//     The non-root-path 404 guard DOES NOT apply here — path-based org routing on
//     localhost is the intended behavior for all local and CI runs.
//
// After slug extraction (both modes):
//   org found in DB  → inject x-org-id / x-org-slug headers so Server Components can
//                       read them; rewrite URL if in subdomain mode
//   org NOT found    → 404 JSON
//   empty slug       → apex passthrough (strip org headers to prevent spoofing)
//
// Performance note (out of scope Stage 2): the DB lookup on every request is fine for dev
// load.  A future optimization is a short-lived in-process Map cache keyed on slug,
// invalidated on Organization updates.
//
// Stage 12 — org-slug TTL cache (in-process, 60 s).
// Wraps the per-request findUnique below.  TTL chosen as short enough that a slug rename
// propagates within a minute, long enough to absorb the burst on heavily-visited pages.
// Only the slug → { id, slug } lookup is cached; nothing about the user session is stored here.

interface OrgCacheEntry {
  id: string;
  slug: string;
  // Stage 16 Batch E: isSuspended is cached alongside id/slug so the suspension
  // check does not add a second DB round-trip per request. The 60 s TTL means a
  // newly suspended org may continue to serve requests for up to 60 s before the
  // flag propagates from the cache — acceptable per spec ("blocked at next request").
  isSuspended: boolean;
  expiresAt: number;
}
const _orgCache = new Map<string, OrgCacheEntry>();

function _getCachedOrg(
  slug: string,
): { id: string; slug: string; isSuspended: boolean } | null {
  const entry = _orgCache.get(slug);
  if (entry && Date.now() < entry.expiresAt) {
    return { id: entry.id, slug: entry.slug, isSuspended: entry.isSuspended };
  }
  _orgCache.delete(slug);
  return null;
}

function _setCachedOrg(org: {
  id: string;
  slug: string;
  isSuspended: boolean;
}): void {
  _orgCache.set(org.slug, {
    id: org.id,
    slug: org.slug,
    isSuspended: org.isSuspended,
    expiresAt: Date.now() + 60_000,
  });
}

/**
 * Invalidate the in-process org cache for a given slug.
 *
 * Call this whenever an Organization's slug is changed so that the next request
 * picks up the updated slug from the DB rather than serving a stale cached entry.
 * (No org-update routes exist yet; exported now so future callers don't have to
 * reach into the module internals.)
 */
export function invalidateOrgCache(slug: string): void {
  _orgCache.delete(slug);
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  // Strip port so "localhost:3000" → "localhost" and
  // "acme-glass.easeetool.com:443" → "acme-glass.easeetool.com".
  const hostname = host.split(":")[0];

  const { pathname, search } = request.nextUrl;

  // ---------------------------------------------------------------------------
  // Slug extraction
  // ---------------------------------------------------------------------------
  let orgSlug: string;
  let fromSubdomain = false;

  if (hostname === "test.easeetool.com") {
    // Test-env apex (test.easeetool.com itself) → passthrough (org selector).
    // Must precede the bare .easeetool.com endsWith check below — "test" would
    // otherwise be extracted as an org slug and produce a 404.
    // /controls/** is carved out before the BUG-3 guard — it is served on the apex host.
    if (pathname.startsWith("/controls")) {
      // Stage 16: SuperAdmin console lives at /controls on the apex host.
      // Strip org headers — /controls has no org context.
      const stripped = new Headers(request.headers);
      stripped.delete("x-org-id");
      stripped.delete("x-org-slug");
      return NextResponse.next({ request: { headers: stripped } });
    }
    // BUG-3 guard: reject all other non-root paths on the apex host immediately —
    // no DB lookup, no path-based org routing on apex hosts.
    if (pathname !== "/") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    orgSlug = "";
  } else if (hostname.endsWith(".test.easeetool.com")) {
    // Test-env org subdomain: vistra.test.easeetool.com → orgSlug = "vistra".
    // Also must precede .easeetool.com check for the same reason.
    orgSlug = hostname.slice(0, -".test.easeetool.com".length);
    fromSubdomain = true;
  } else if (hostname === "easeetool.com" || hostname === "www.easeetool.com") {
    // Production apex domain → passthrough (org selector).
    // /controls/** is carved out before the BUG-3 guard — it is served on the apex host.
    if (pathname.startsWith("/controls")) {
      // Stage 16: SuperAdmin console lives at /controls on the apex host.
      // Strip org headers — /controls has no org context.
      const stripped = new Headers(request.headers);
      stripped.delete("x-org-id");
      stripped.delete("x-org-slug");
      return NextResponse.next({ request: { headers: stripped } });
    }
    // BUG-3 guard: reject all other non-root paths on the apex host immediately —
    // no DB lookup, no path-based org routing on apex hosts.
    if (pathname !== "/") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    orgSlug = "";
  } else if (hostname.endsWith(".easeetool.com")) {
    // Production subdomain routing: acme-glass.easeetool.com → orgSlug = "acme-glass"
    orgSlug = hostname.slice(0, hostname.length - ".easeetool.com".length);
    fromSubdomain = true;
  } else {
    // /controls/** is carved out here too — without this, every per-branch Vercel
    // preview (and local/CI) treats "controls" as an org slug and 404s, which made
    // /controls/** impossible to verify against a branch's own preview (documented
    // as MINOR-1 in review-1.md; closed 2026-09-02 after it blocked verifying a
    // /controls bug fix pre-merge).
    if (pathname.startsWith("/controls")) {
      const stripped = new Headers(request.headers);
      stripped.delete("x-org-id");
      stripped.delete("x-org-slug");
      return NextResponse.next({ request: { headers: stripped } });
    }
    // Local dev / CI / Playwright fallback — path-segment extraction (unchanged
    // from pre-Stage 10 behavior).  e.g. pathname "/vistra/dashboard" → "vistra".
    orgSlug = pathname.split("/")[1] ?? "";
  }

  // ---------------------------------------------------------------------------
  // Apex passthrough
  // ---------------------------------------------------------------------------
  if (orgSlug === "") {
    // Apex passthrough. Strip any client-supplied org headers so an authenticated
    // user cannot spoof x-org-id / x-org-slug on the apex page to reach org-scoped
    // pages.
    const stripped = new Headers(request.headers);
    stripped.delete("x-org-id");
    stripped.delete("x-org-slug");
    return NextResponse.next({ request: { headers: stripped } });
  }

  // ---------------------------------------------------------------------------
  // DB lookup (with in-process TTL cache)
  // ---------------------------------------------------------------------------
  let org = _getCachedOrg(orgSlug);
  if (!org) {
    const dbOrg = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      // Stage 16 Batch E: select isSuspended so the suspension check below does
      // not require a separate DB query. Cached for up to 60 s (see OrgCacheEntry).
      select: { id: true, slug: true, isSuspended: true },
    });
    if (!dbOrg) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }
    _setCachedOrg(dbOrg);
    org = dbOrg;
  }

  // Stage 16 Batch E — suspended org check.
  // If the org is suspended, block incoming page route requests with a clear 403.
  // Active sessions are NOT forcibly invalidated on suspension (deferred per spec) —
  // users are blocked here on their next request, which is sufficient.
  //
  // NOTE: this check only covers page routes matched by the proxy config below.
  // /api/** routes are excluded from the matcher entirely (see config.matcher comment)
  // so a suspended org's API routes (including /api/health) are NOT blocked by this
  // proxy. In practice, all org-scoped /api/v1/** handlers require the x-org-id header
  // injected by this proxy, so they effectively fail without it — but informational-only
  // routes like /api/health will still return 200 on a suspended org's subdomain.
  // Broadening the matcher to cover /api/** is a larger change deferred to a future stage.
  if (org.isSuspended) {
    return NextResponse.json(
      {
        error:
          "This organization has been suspended. Please contact your platform administrator.",
      },
      { status: 403 },
    );
  }

  // Attach org headers so Server Components downstream can read them.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-org-id", org.id);
  requestHeaders.set("x-org-slug", org.slug);

  // ---------------------------------------------------------------------------
  // URL rewrite (subdomain mode only)
  // ---------------------------------------------------------------------------
  if (fromSubdomain) {
    // Guard against double-prepend on a re-entrant request: if the path already
    // starts with /{orgSlug}/ (or IS /{orgSlug}), the rewrite already happened —
    // fall through to NextResponse.next() below.
    const alreadyPrefixed =
      pathname === `/${orgSlug}` || pathname.startsWith(`/${orgSlug}/`);

    if (!alreadyPrefixed) {
      // acme-glass.easeetool.com/projects → internal /acme-glass/projects
      // NextResponse.rewrite accepts { request: { headers } } (same MiddlewareResponseInit
      // as NextResponse.next) to forward modified request headers to the rewrite destination.
      return NextResponse.rewrite(
        new URL(`/${orgSlug}${pathname}${search}`, request.url),
        { request: { headers: requestHeaders } },
      );
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    // Run on all paths except static assets, all /api/* routes, and the /organizations dev
    // listing.  Excluding all of /api prevents "api" from being read as an org slug and
    // avoids needless DB lookups on health checks, auth callbacks, etc.  The /organizations
    // dev page is similarly excluded so "organizations" is never treated as a slug.
    //
    // CONSEQUENCE: the suspension check above does NOT run for /api/** paths.
    // A suspended org's /api/health (and any other API route that doesn't strictly
    // require x-org-id) will still return a normal response.  See the suspension
    // check comment above for details.  Broadening this matcher is deferred.
    "/((?!_next/static|_next/image|favicon\\.ico|api|organizations).*)",
  ],
};
