import { headers } from "next/headers";

// ---------------------------------------------------------------------------
// Private helpers — not exported; only orgHref() and detectIsSubdomain() are.
// ---------------------------------------------------------------------------

/**
 * Reads the Host header from the incoming request and strips the port, leaving
 * just the bare hostname (e.g. "vistra.test.easeetool.com").
 * Factored out so both public functions share a single call site to maintain.
 */
async function resolveHostname(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  return host.split(":")[0];
}

/**
 * Returns true when `hostname` matches an org-scoped EaseeTool subdomain
 * (production or staging preview).  Mirrors proxy.ts's `fromSubdomain` check
 * exactly — if a new subdomain pattern is ever added, update here only.
 */
function isSubdomainHost(hostname: string, orgSlug: string): boolean {
  return (
    hostname === `${orgSlug}.easeetool.com` ||
    hostname === `${orgSlug}.test.easeetool.com`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Server-side helper that constructs an org-scoped href.
 *
 * In subdomain mode (e.g. acme-glass.easeetool.com, acme-glass.test.easeetool.com),
 * returns `subpath` bare — the orgSlug is already encoded in the host and does NOT
 * belong in the path.  Adding it would produce a double-prefix (/{orgSlug}/{orgSlug}/...)
 * after the proxy rewrites the request.
 *
 * When `subpath` is "" (the empty string) in subdomain mode, this function returns ""
 * (not "/").  Callers that compute a base prefix via `orgHref(orgSlug, "")` and then
 * build links as `\`${base}/inquiries\`` get "/inquiries" — correct.  Returning "/"
 * would cause `\`${base}/inquiries\`` = "//inquiries", a protocol-relative URL that
 * browsers treat as an external host reference, breaking navigation (bugs-2.md Bug 1).
 *
 * In path mode (localhost, Vercel hash preview URLs, any non-easeetool.com host),
 * returns `/${orgSlug}${subpath}`.
 *
 * Detection logic mirrors `proxy.ts`'s `fromSubdomain` branches exactly so that
 * links and redirects stay consistent with how the proxy routes requests.
 *
 * Ported from Stage 11 — Stage 11 merged to staging but not yet to master when
 * Stage 12 branched from master.
 *
 * @param orgSlug  The org's URL slug (e.g. "acme-glass").
 * @param subpath  The path within the org (must start with "/" or be "").
 * @returns        The href to use in a redirect() or Link href attribute.
 */
export async function orgHref(orgSlug: string, subpath: string): Promise<string> {
  const hostname = await resolveHostname();
  return isSubdomainHost(hostname, orgSlug) ? subpath : `/${orgSlug}${subpath}`;
}

/**
 * Returns true when the request is arriving via a subdomain host
 * (`{orgSlug}.easeetool.com` or `{orgSlug}.test.easeetool.com`).
 *
 * Intended for Server Components that need to forward subdomain-mode
 * awareness to child Client Components as a plain boolean prop, eliminating
 * the `useOrgHref` client-side `window.location.hostname` read and the
 * resulting SSR/hydration mismatch.  Used in:
 *   - app/[orgSlug]/layout.tsx → <Sidebar> + <TopBarActions>
 *   - app/[orgSlug]/projects/[projectId]/layout.tsx → <ProjectWizardBreadcrumb>
 */
export async function detectIsSubdomain(orgSlug: string): Promise<boolean> {
  const hostname = await resolveHostname();
  return isSubdomainHost(hostname, orgSlug);
}
