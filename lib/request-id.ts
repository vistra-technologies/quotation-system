export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * requestId = the segment after the last `::` of x-vercel-id (equals Vercel's runtime-log id);
 * randomUUID() when the header is missing, empty, or the segment fails REQUEST_ID_RE (Stage 30 S2 ruling).
 * Shared by withRoute, withAction and instrumentation.ts.
 */
export function requestIdFrom(vercelId: string | null | undefined): string {
  const seg = (vercelId ?? "").split("::").pop() ?? "";
  return REQUEST_ID_RE.test(seg) ? seg : globalThis.crypto.randomUUID(); // Web Crypto: also valid in the Edge instrumentation bundle
}

/**
 * S32-5: the parent id for internalFetch. The ALS context id wins; otherwise the segment after the last `::`
 * of the inbound x-vercel-id if it passes REQUEST_ID_RE; otherwise undefined. Never fabricates an id
 * (a parent that matches no log line is worse than none).
 */
export function parentRequestIdFor(
  ctxRequestId: string | null | undefined,
  vercelId: string | null | undefined,
): string | undefined {
  if (ctxRequestId) return ctxRequestId;
  const seg = (vercelId ?? "").split("::").pop() ?? "";
  return REQUEST_ID_RE.test(seg) ? seg : undefined;
}
