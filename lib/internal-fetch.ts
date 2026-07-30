import { headers } from "next/headers";

/**
 * Cookie-forwarding fetch helper for Server Components and Server Actions.
 *
 * Calls the app's own API routes from inside the server render, forwarding
 * the inbound request's session cookie so that getApiSession() inside the
 * route handler can read the session.
 *
 * URL construction:
 *   - Reads the inbound `host` header from next/headers to build the absolute URL.
 *   - Uses `http://` for localhost / 127.0.0.1 (local dev), `https://` otherwise.
 *   - Works on both subdomain hosts (orgSlug.easeetool.com) and Vercel preview hashes
 *     because it reuses whatever host the inbound request arrived on.
 *
 * Proxy note:
 *   proxy.ts's matcher EXCLUDES /api/*, so internalFetch calls land directly at the
 *   route handler — the proxy never processes them, and no x-org-id/x-org-slug header
 *   is injected.  getApiSession() resolves tenancy from the URL orgSlug instead.
 *
 * Deduplication:
 *   Next.js 15+ automatically deduplicates identical fetch() calls (same URL + headers)
 *   within one render pass.  For explicit deduplication across layout+page pairs, use
 *   React.cache() to wrap callers (see app/[orgSlug]/projects/[projectId]/_project-fetch.ts).
 *
 * @param path   Absolute path including leading "/" (e.g. "/api/v1/orgs/acme/projects").
 * @param init   Optional fetch init overrides (method, body, headers, etc.).
 * @returns      The raw Response — callers check res.ok and parse as needed.
 */
export async function internalFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const cookie = requestHeaders.get("cookie") ?? "";
  const hostname = host.split(":")[0];

  const scheme =
    hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";

  const url = `${scheme}://${host}${path}`;

  const mergedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  // Always override cookie with the inbound request's cookie so the route
  // handler's auth.api.getSession() sees the session.
  if (cookie) {
    mergedHeaders["cookie"] = cookie;
  }

  return fetch(url, {
    ...init,
    headers: mergedHeaders,
  });
}
