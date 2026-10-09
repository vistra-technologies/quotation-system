/**
 * Pure helpers for POST /api/v1/client-errors (Stage 30, S30-10): the body schema and the
 * best-effort per-instance rate cap. Kept apart from the route so they are unit-testable
 * (the clock is injected).
 */

export const MAX_BODY_BYTES = 2048;
export const MAX_REPORTS_PER_MINUTE = 60;

export type ClientErrorReport = {
  boundary: "global" | "admin";
  message: string;
  digest?: string;
  path?: string;
};

const ALLOWED_KEYS = new Set(["boundary", "message", "digest", "path"]);

/** `boundary` and `message` are required; `digest` and `path` optional. Any other key, type or range is invalid. */
export function parseClientErrorReport(raw: unknown): ClientErrorReport | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k)) return null;
  if (o.boundary !== "global" && o.boundary !== "admin") return null;
  if (typeof o.message !== "string" || o.message.length > 300) return null;
  const out: ClientErrorReport = { boundary: o.boundary, message: o.message };
  if (o.digest !== undefined) {
    if (typeof o.digest !== "string" || o.digest.length > 64) return null;
    out.digest = o.digest;
  }
  if (o.path !== undefined) {
    // location.pathname only: no query, no hash.
    if (typeof o.path !== "string" || o.path.length > 200 || !o.path.startsWith("/") || /[?#]/.test(o.path)) {
      return null;
    }
    out.path = o.path;
  }
  return out;
}

/** Sliding-window cap: at most `max` accepted reports per `windowMs`. Per instance, best effort. */
export function createRateCap(max = MAX_REPORTS_PER_MINUTE, windowMs = 60_000, now: () => number = Date.now) {
  let stamps: number[] = [];
  return {
    /** true = accepted (and counted); false = over the cap. */
    tryAccept(): boolean {
      const t = now();
      stamps = stamps.filter((s) => t - s < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(t);
      return true;
    },
  };
}
