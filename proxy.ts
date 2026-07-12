import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Tenant-resolution proxy — runs in Node.js runtime (Next.js 16 default).
// Do NOT set `export const runtime` here; it is not allowed in proxy files.
//
// On every non-static request:
//   apex host (e.g. "localhost")    → pass through; the apex page shows the org selector.
//   subdomain (e.g. "acme-glass")  → look up Organization by slug, attach x-org-id and
//                                     x-org-slug headers so Server Components can read them.
//   unknown subdomain               → 404.
//
// Performance note (out of scope Stage 2): the DB lookup on every request is fine for dev
// load.  A future optimization is a short-lived in-process Map cache keyed on slug,
// invalidated on Organization updates.

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  // Strip port: "acme-glass.localhost:3000" → "acme-glass.localhost"
  const hostWithoutPort = host.split(":")[0];

  // Find the first dot to separate subdomain from the rest.
  const dotIndex = hostWithoutPort.indexOf(".");

  if (dotIndex <= 0) {
    // No subdomain (bare "localhost") — apex passthrough.
    // Strip any client-supplied org headers so an authenticated user cannot
    // spoof x-org-id / x-org-slug on the apex host to reach org-scoped pages.
    const stripped = new Headers(request.headers);
    stripped.delete("x-org-id");
    stripped.delete("x-org-slug");
    return NextResponse.next({ request: { headers: stripped } });
  }

  const subdomain = hostWithoutPort.substring(0, dotIndex);

  // Look up the organization by slug.
  const org = await prisma.organization.findUnique({
    where: { slug: subdomain },
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
    // Run on all paths except static assets and the auth API.
    // The auth API must work on subdomains without the org-check overhead because
    // the session cookie is already the per-org isolation boundary.
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth).*)",
  ],
};
