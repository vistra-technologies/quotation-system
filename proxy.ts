import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Tenant-resolution proxy — runs in Node.js runtime (Next.js 16 default).
// Do NOT set `export const runtime` here; it is not allowed in proxy files.
//
// Slug extraction strategy (Stage 10 subdomain routing):
//
//   Test / staging environment (*.test.easeetool.com):
//     test.easeetool.com                → apex passthrough (org selector on the test env)
//     {orgSlug}.test.easeetool.com      → extract leftmost label as orgSlug;
//                                         rewrite URL so app/[orgSlug]/... receives it.
//     These two branches MUST come before the bare *.easeetool.com branches below, because
//     both test.easeetool.com and {orgSlug}.test.easeetool.com also match
//     hostname.endsWith(".easeetool.com") — without the prior check, "test" would be
//     extracted as an org slug (no such org → 404). (Bug fix: bugs-1.md, 2026-07-23.)
//
//   Production (*.easeetool.com):
//     easeetool.com / www.easeetool.com → apex passthrough (org selector)
//     {orgSlug}.easeetool.com           → extract subdomain as orgSlug;
//                                         rewrite URL so app/[orgSlug]/... receives it.
//                                         Guard: skip rewrite if path already starts with
//                                         /{orgSlug}/ to prevent double-prepend on a
//                                         re-entrant request.
//
//   Local dev / CI / Playwright (any non-easeetool.com host, e.g. localhost):
//     Falls back to path-segment extraction: pathname.split("/")[1].
//     No *.localhost DNS config needed — local/CI runs work exactly as before Stage 10.
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
    orgSlug = "";
  } else if (hostname.endsWith(".test.easeetool.com")) {
    // Test-env org subdomain: vistra.test.easeetool.com → orgSlug = "vistra".
    // Also must precede .easeetool.com check for the same reason.
    orgSlug = hostname.slice(0, -".test.easeetool.com".length);
    fromSubdomain = true;
  } else if (hostname === "easeetool.com" || hostname === "www.easeetool.com") {
    // Production apex domain → always passthrough regardless of path (shows the org selector).
    orgSlug = "";
  } else if (hostname.endsWith(".easeetool.com")) {
    // Production subdomain routing: acme-glass.easeetool.com → orgSlug = "acme-glass"
    orgSlug = hostname.slice(0, hostname.length - ".easeetool.com".length);
    fromSubdomain = true;
  } else {
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
  // DB lookup
  // ---------------------------------------------------------------------------
  const org = await prisma.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, slug: true },
  });

  if (!org) {
    return NextResponse.json(
      { error: "Organization not found" },
      { status: 404 },
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
    "/((?!_next/static|_next/image|favicon\\.ico|api|organizations).*)",
  ],
};
