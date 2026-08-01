import { headers } from "next/headers";

/**
 * Server-side helper that constructs an org-scoped href.
 *
 * In subdomain mode (e.g. acme-glass.easeetool.com, acme-glass.test.easeetool.com),
 * returns `subpath` bare — the orgSlug is already encoded in the host and does NOT
 * belong in the path.  Adding it would produce a double-prefix (/{orgSlug}/{orgSlug}/...)
 * after the proxy rewrites the request.
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
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const hostname = host.split(":")[0];

  const isSubdomain =
    hostname === `${orgSlug}.easeetool.com` ||
    hostname === `${orgSlug}.test.easeetool.com`;

  return isSubdomain ? subpath || "/" : `/${orgSlug}${subpath}`;
}
