/**
 * Client crash reporter (Stage 30, S30-10). Called once per mount by the two error boundaries.
 * Fire-and-forget and fully guarded: it must never throw or delay a boundary, so global-error
 * still renders with no network. Sends `location.pathname` only (no query, no hash).
 * Deduplicated per browser session by digest (else message) in sessionStorage.
 *
 * Stage 32 (S32-7): returns the reference the boundary should show beside the digest line. With a
 * digest the digest is the reference and nothing is returned; without one a guarded
 * crypto.randomUUID() is generated, sent as `ref`, and stored in the dedupe entry so a deduped
 * repeat returns the ref that was actually logged.
 */
export type ClientErrorBoundary = "global" | "admin";

const ENDPOINT = "/api/v1/client-errors";

export function reportClientError(error: { message?: string; digest?: string }, boundary: ClientErrorBoundary,
): string | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const message = String(error?.message ?? "").slice(0, 300);
    const digest = typeof error?.digest === "string" ? error.digest.slice(0, 64) : undefined;

    let ref: string | undefined;
    if (!digest) {
      try {
        ref = crypto.randomUUID();
      } catch {
        // no crypto.randomUUID (e.g. insecure context): report without a ref
      }
    }

    const key = `client-error:${boundary}:${digest || message}`;
    try {
      const seen = window.sessionStorage.getItem(key);
      if (seen) return digest || seen === "1" ? undefined : seen;
      window.sessionStorage.setItem(key, digest ? "1" : (ref ?? "1"));
    } catch {
      // storage blocked: report anyway
    }

    const payload: Record<string, string> = { boundary, message, path: window.location.pathname.slice(0, 200) };
    if (digest) payload.digest = digest;
    else if (ref) payload.ref = ref;
    const body = JSON.stringify(payload);

    if (typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return ref;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
    return ref;
  } catch {
    // reporting must never break the error boundary
    return undefined;
  }
}
