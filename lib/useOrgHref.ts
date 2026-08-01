"use client";

/**
 * Client-side org-href resolver hook.
 *
 * Returns a stable `(subpath: string) => string` function that produces the
 * correct href for an org-scoped subpath depending on whether the browser is
 * running in subdomain mode (`{orgSlug}.easeetool.com` /
 * `{orgSlug}.test.easeetool.com`) or in the localhost/CI/apex-preview
 * path-based fallback.
 *
 * Subdomain mode  → returned function returns `subpath` as-is (e.g. "/dashboard").
 * Path-based mode → returned function returns `/${orgSlug}${subpath}`.
 *
 * Detection mirrors `proxy.ts`'s `fromSubdomain` logic via `window.location.hostname`.
 * SSR-safe: guards `typeof window !== "undefined"` (client components render on the
 * server during Next.js SSR; hostname defaults to "" which produces path-based output,
 * the correct server-side fallback).
 *
 * Ported from Stage 11 — Stage 11 merged to staging but not yet to master when
 * Stage 12 branched from master.
 *
 * Usage ("use client" components):
 *   const href = useOrgHref(orgSlug);
 *   router.push(href("/dashboard"));
 *   <Link href={href("/projects")} />
 */
export function useOrgHref(orgSlug: string): (subpath: string) => string {
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : "";

  const isSubdomainHost =
    hostname === `${orgSlug}.easeetool.com` ||
    hostname === `${orgSlug}.test.easeetool.com`;

  return (subpath: string) =>
    isSubdomainHost ? subpath : `/${orgSlug}${subpath}`;
}
