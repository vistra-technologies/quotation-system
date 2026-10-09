import { randomUUID } from "node:crypto";

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * requestId = the segment after the last `::` of x-vercel-id (equals Vercel's runtime-log id);
 * randomUUID() when the header is missing, empty, or the segment fails REQUEST_ID_RE (Stage 30 S2 ruling).
 * Shared by withRoute, withAction and instrumentation.ts.
 */
export function requestIdFrom(vercelId: string | null | undefined): string {
  const seg = (vercelId ?? "").split("::").pop() ?? "";
  return REQUEST_ID_RE.test(seg) ? seg : randomUUID();
}
