import { headers } from "next/headers";
import Link from "next/link";
import { internalFetch } from "@/lib/internal-fetch";

// Always render live — reads DB for org list and Host header.
export const dynamic = "force-dynamic";

/**
 * Apex — organization selector page (Server Component).
 *
 * Stage 11 (Batch 9): restyled to Sage Ease tokens. The local orgHref()
 * helper below is intentionally different from lib/orgHref.ts — it constructs
 * absolute subdomain URLs for the org selector (apex → org), while
 * lib/orgHref.ts is used inside org-scoped pages to emit subpath vs. subdomain
 * URLs relative to the current org. Do not replace this helper.
 */
export default async function Home() {
  // Apex — render the organization selector.
  // Stage 12 Batch 6: switched listOrganizationsForSelector DAL to internalFetch
  // against the public GET /api/v1/orgs endpoint (no auth required).
  const orgsRes = await internalFetch("/api/v1/orgs");
  const { orgs } = orgsRes.ok
    ? ((await orgsRes.json()) as { orgs: Array<{ id: string; slug: string; name: string }> })
    : { orgs: [] as Array<{ id: string; slug: string; name: string }> };

  // Read the incoming Host header to determine the correct link format for each
  // org entry.  On *.easeetool.com hosts the proxy treats the apex host as a
  // pure passthrough (orgSlug = "") for every path, so path-based org links
  // like /vistra/login would loop forever (proxy never injects x-org-id).
  // Instead we emit absolute subdomain URLs so the browser navigates to the org
  // subdomain where slug extraction is correct.
  //
  // On localhost, ad-hoc *.vercel.app previews, and CI the existing path-based
  // relative links are kept — this is what all Playwright specs rely on.
  const reqHeaders = await headers();
  const host = reqHeaders.get("host") ?? "";
  const hostname = host.split(":")[0]; // strip port e.g. "localhost:3000" → "localhost"

  function orgHref(slug: string): string {
    if (hostname === "test.easeetool.com") {
      // Test / staging domain: generate subdomain URL so the org subdomain
      // proxy branch injects the correct x-org-id header.
      return `https://${slug}.test.easeetool.com/login`;
    }
    if (hostname === "easeetool.com" || hostname === "www.easeetool.com") {
      // Production domain: same pattern, bare easeetool.com subdomain.
      return `https://${slug}.easeetool.com/login`;
    }
    // Localhost, ad-hoc *.vercel.app previews, CI — path-based (unchanged).
    return `/${slug}/login`;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-page px-6">
      <main className="w-full max-w-md">
        {/* Logo mark + wordmark */}
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-primary">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14 2.5H6.8a1.8 1.8 0 0 0-1.8 1.8v15.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.3z"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M14 2.5v5.8h5.2"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8.6 14.2l2 2 4-4.4"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-lg font-extrabold text-text-heading">
            EaseeTool
          </span>
        </div>

        <h1 className="text-2xl font-extrabold tracking-tight text-text-heading">
          Select your organization
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Sign in to the organization you belong to.
        </p>

        <nav className="mt-6 flex flex-col gap-3">
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={orgHref(org.slug)}
              className="flex items-center justify-between rounded-md border border-border bg-bg-card px-5 py-4 text-sm font-semibold text-text-heading shadow-card transition-colors hover:border-primary-soft hover:bg-primary-softer"
            >
              {org.name}
              <span className="font-mono text-xs text-text-muted">{org.slug}</span>
            </Link>
          ))}
        </nav>

        {/* Diagnostic links — Stage 1 artifacts kept for dev convenience */}
        <div className="mt-8 border-t border-border pt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
            Dev tools
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href="/organizations"
              className="text-xs text-text-muted hover:text-text-body"
            >
              /organizations
            </Link>
            <Link
              href="/api/health"
              className="text-xs text-text-muted hover:text-text-body"
            >
              /api/health
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
