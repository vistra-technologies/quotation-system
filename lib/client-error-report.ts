/**
 * Client crash reporter (Stage 30, S30-10). Called once per mount by the two error boundaries.
 * Fire-and-forget and fully guarded: it must never throw or delay a boundary, so global-error
 * still renders with no network. Sends `location.pathname` only (no query, no hash).
 * Deduplicated per browser session by digest (else message) in sessionStorage.
 */
export type ClientErrorBoundary = "global" | "admin";

const ENDPOINT = "/api/v1/client-errors";

export function reportClientError(error: { message?: string; digest?: string }, boundary: ClientErrorBoundary): void {
  try {
    if (typeof window === "undefined") return;
    const message = String(error?.message ?? "").slice(0, 300);
    const digest = typeof error?.digest === "string" ? error.digest.slice(0, 64) : undefined;

    const key = `client-error:${boundary}:${digest || message}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // storage blocked: report anyway
    }

    const payload: Record<string, string> = { boundary, message, path: window.location.pathname.slice(0, 200) };
    if (digest) payload.digest = digest;
    const body = JSON.stringify(payload);

    if (typeof navigator.sendBeacon === "function") {
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // reporting must never break the error boundary
  }
}
