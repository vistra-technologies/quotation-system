/**
 * Shared destination guard for the one-time data scripts (prisma/migrate-design-v1-to-v2.ts,
 * prisma/backfill-config-snapshots.ts). Stage 22 D-19.
 *
 * Default (EXPECT_ENDPOINT unset/empty): only the dev Neon endpoint is allowed — unchanged behaviour.
 * Opt-in: EXPECT_ENDPOINT=<id> must be in KNOWN_ENDPOINTS AND exactly equal the endpoint parsed from
 * DATABASE_URL. Anything else (unset URL, unparseable host, unknown/mismatched id) is refused, fail-closed.
 * Pure: no env/process access, so it is unit-testable.
 */

export const DEV_ENDPOINT = "ep-dark-term-ai0ufj4k";
export const PROD_ENDPOINT = "ep-little-paper-aipm0o0i";
/** The only endpoints EXPECT_ENDPOINT may name. */
export const KNOWN_ENDPOINTS: ReadonlySet<string> = new Set([DEV_ENDPOINT, PROD_ENDPOINT]);

/** Neon endpoint id from a connection string (drops any `-pooler` suffix), or null if unparseable. */
export function endpointOf(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (!host) return null;
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

export type GuardResult =
  | { ok: true; endpoint: string; isProduction: boolean }
  | { ok: false; reason: string };

export function checkDbTarget(databaseUrl: string | undefined, expectEndpoint: string | undefined): GuardResult {
  const endpoint = databaseUrl ? endpointOf(databaseUrl) : null;
  if (!endpoint) return { ok: false, reason: "DATABASE_URL is not set or its host cannot be parsed." };

  const expect = (expectEndpoint ?? "").trim();
  if (expect === "") {
    if (endpoint !== DEV_ENDPOINT) {
      return {
        ok: false,
        reason:
          `DATABASE_URL targets endpoint "${endpoint}", not the dev branch (${DEV_ENDPOINT}) — refusing to run. ` +
          "(Non-dev targets need an explicit EXPECT_ENDPOINT opt-in.)",
      };
    }
    return { ok: true, endpoint, isProduction: false };
  }
  if (!KNOWN_ENDPOINTS.has(expect)) {
    return { ok: false, reason: `EXPECT_ENDPOINT "${expect}" is not a known endpoint (${[...KNOWN_ENDPOINTS].join(", ")}).` };
  }
  if (expect !== endpoint) {
    return { ok: false, reason: `EXPECT_ENDPOINT "${expect}" does not match DATABASE_URL's endpoint "${endpoint}".` };
  }
  return { ok: true, endpoint, isProduction: endpoint === PROD_ENDPOINT };
}

/** Runs the guard against process.env; prints ABORT and exits non-zero on refusal, else prints the target. */
export function enforceDbTarget(): { endpoint: string; isProduction: boolean } {
  const r = checkDbTarget(process.env.DATABASE_URL, process.env.EXPECT_ENDPOINT);
  if (!r.ok) {
    console.error(`ABORT: ${r.reason}`);
    process.exit(1);
  }
  return { endpoint: r.endpoint, isProduction: r.isProduction };
}

export function describeTarget(t: { endpoint: string; isProduction: boolean }): string {
  return t.isProduction
    ? `Target DB endpoint: ${t.endpoint}  *** PRODUCTION ***`
    : `Target DB endpoint: ${t.endpoint} (dev)`;
}
