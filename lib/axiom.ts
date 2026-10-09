import { log } from "@/lib/logger";

/**
 * Axiom transport (Stage 30, S30-8). Plain fetch to the ingest API (the spec's own fallback to
 * @axiomhq/js: the SDK retries 5xx internally and defaults to a 20 s timeout, which contradicts
 * "one HTTP call, 2 s timeout, no retry"; see spike-results.md S4).
 *
 *  - A silent no-op unless BOTH AXIOM_TOKEN and AXIOM_DATASET are set (read at call time).
 *  - `timestamp-field=ts`: Axiom's _time is the logger's own ISO `ts` (when the line was written), not flush time.
 *  - One HTTP call per flush, 2 s timeout, no retry.
 *  - Never throws, never touches a response. On failure writes ONE stdout `axiom.flush_failed { status }`
 *    line (status 0 = network error or timeout). The token is never in any log line or error.
 *  - Server-only env vars. There is deliberately no NEXT_PUBLIC_AXIOM_*.
 */

export const AXIOM_TIMEOUT_MS = 2000;
const AXIOM_ENDPOINT = "https://api.axiom.co";

export function axiomEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AXIOM_TOKEN && env.AXIOM_DATASET);
}

export type FlushOptions = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

/** Sends the buffered JSON lines (strings the logger already redacted) in one request. */
export async function flushToAxiom(buffer: readonly unknown[], opts: FlushOptions = {}): Promise<void> {
  try {
    const env = opts.env ?? process.env;
    if (!axiomEnabled(env)) return;
    const lines = buffer.filter((l): l is string => typeof l === "string" && l.length > 0);
    if (lines.length === 0) return;

    const doFetch = opts.fetchImpl ?? fetch;
    let status = 0;
    try {
      const res = await doFetch(
        `${AXIOM_ENDPOINT}/v1/datasets/${encodeURIComponent(env.AXIOM_DATASET as string)}/ingest?timestamp-field=ts`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.AXIOM_TOKEN}`,
            "content-type": "application/json",
          },
          // Each line is already a complete JSON object.
          body: `[${lines.join(",")}]`,
          signal: AbortSignal.timeout(opts.timeoutMs ?? AXIOM_TIMEOUT_MS),
          cache: "no-store",
        },
      );
      status = res.ok ? 200 : res.status;
      // Drain the body so the connection is released; ignore its content.
      await res.body?.cancel().catch(() => {});
    } catch {
      status = 0; // network error or timeout; the error text is deliberately not logged
    }
    if (status !== 200) log.warn("axiom.flush_failed", { status });
  } catch {
    // a transport must never throw
  }
}
