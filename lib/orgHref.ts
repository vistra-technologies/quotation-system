import { headers } from "next/headers";

/**
 * Server-side org-href resolver.
 *
 * Returns the correct href for an org-scoped subpath depending on whether the
 * current request is running in subdomain mode (`{orgSlug}.easeetool.com` /
 * `{orgSlug}.test.easeetool.com`) or in the localhost/CI/apex-preview
 * path-based fallback.
 *
 * Subdomain mode  → returns `subpath` as-is (e.g. "/dashboard").
 * Path-based mode → returns `/${orgSlug}${subpath}` (e.g. "/vistra/dashboard").
 *
 * Detection mirrors `proxy.ts`'s `fromSubdomain` logic: the hostname exactly
 * matches `{orgSlug}.easeetool.com` or `{orgSlug}.test.easeetool.com`.
 *
 * Usage (Server Actions, RSC pages, layouts):
 *   redirect(await orgHref(orgSlug, "/dashboard"));
 *   <Link href={await orgHref(orgSlug, "/projects")} />
 */
export async function orgHref(orgSlug: string, subpath: string): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  // Strip port — "localhost:3000" → "localhost", "vistra.easeetool.com:443" → "vistra.easeetool.com"
  const hostname = host.split(":")[0];

  const isSubdomainHost =
    hostname === `${orgSlug}.easeetool.com` ||
    hostname === `${orgSlug}.test.easeetool.com`;

  return isSubdomainHost ? subpath : `/${orgSlug}${subpath}`;
}
