import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Tenant-resolution proxy — runs in Node.js runtime (Next.js 16 default).
// Do NOT set `export const runtime` here; it is not allowed in proxy files.
//
// On every non-static request:
//   apex (pathname === "/")           → pass through; the apex page shows the org selector.
//   /{orgSlug}/...  (org found in DB) → inject x-org-id and x-org-slug headers so Server
//                                       Components can read them.
//   /{orgSlug}/...  (org NOT found)   → 404 JSON.
//
// Performance note (out of scope Stage 2): the DB lookup on every request is fine for dev
// load.  A future optimization is a short-lived in-process Map cache keyed on slug,
// invalidated on Organization updates.

export async function proxy(request: NextRequest) {
  const orgSlug = request.nextUrl.pathname.split("/")[1] ?? "";

  if (orgSlug === "") {
    // Apex passthrough. Strip any client-supplied org headers so an authenticated user
    // cannot spoof x-org-id / x-org-slug on the apex page to reach org-scoped pages.
    const stripped = new Headers(request.headers);
    stripped.delete("x-org-id");
    stripped.delete("x-org-slug");
    return NextResponse.next({ request: { headers: stripped } });
  }

  // Look up the organization by slug.
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
