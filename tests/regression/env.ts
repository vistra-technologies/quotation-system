import path from "node:path";

export const TEST_ORG = "e2e-testorg";
/** git-ignored (.engineering/**): run state, the persistent ledger and per-run storage/cleanup files. */
export const RUN_DIR = path.resolve(__dirname, "..", "..", ".engineering", "regression");
/** Persists across runs — a crashed run's rows are drained by the next run's orphan recovery. */
export const LEDGER_FILE = path.join(RUN_DIR, "ledger.json");
export const RUN_FILE = path.join(RUN_DIR, "run.json");
/** Last teardown's outcome, read by scripts/regression.mjs to decide whether a retry is allowed (R16). */
export const TEARDOWN_STATUS_FILE = path.join(RUN_DIR, "last-teardown.json");
/**
 * Env var carrying this run's generated password for its rgr- users (R18). Set by global setup and
 * inherited by Playwright workers; never written to disk.
 */
export const RUN_PASSWORD_ENV = "RGR_RUN_PASSWORD";

export interface RegEnv {
  baseURL: string;
  saUser: string;
  saPass: string;
  /** Only needed when the Test Org does not exist yet and must be created (Ruling R1). */
  adminPass: string | undefined;
  bypass?: string;
}

const REQUIRED = ["PLAYWRIGHT_BASE_URL", "TEST_SA_USERNAME", "TEST_SA_PASSWORD"] as const;
const PRODUCTION_ALIAS = "v-quote.vercel.app";

/**
 * ALLOWLIST of targets (R15): test.easeetool.com, *.test.easeetool.com, and *.vercel.app branch
 * previews other than the production alias v-quote.vercel.app. Every other host is refused —
 * including localhost and any other *.easeetool.com (production org subdomains).
 */
export function assertAllowedTarget(baseURL: string): void {
  let host: string;
  try {
    host = new URL(baseURL).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error(`regression suite: PLAYWRIGHT_BASE_URL "${baseURL}" is not a valid URL`);
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    throw new Error("regression suite: refusing a local target — run against a Vercel preview or test.easeetool.com (CLAUDE.md rule 7)");
  }
  if (host === PRODUCTION_ALIAS) throw new Error("regression suite: refusing the production host");
  const ok =
    host === "test.easeetool.com" ||
    host.endsWith(".test.easeetool.com") ||
    (host.endsWith(".vercel.app") && host.length > ".vercel.app".length);
  if (!ok) {
    throw new Error(
      `regression suite: refusing target "${host}" — only test.easeetool.com, *.test.easeetool.com and *.vercel.app previews are allowed (anything else may be production)`,
    );
  }
}

export function requireEnv(env: Record<string, string | undefined> = process.env): RegEnv {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`regression suite: missing required env: ${missing.join(", ")}`);
  const baseURL = env.PLAYWRIGHT_BASE_URL!;
  assertAllowedTarget(baseURL);
  return {
    baseURL,
    saUser: env.TEST_SA_USERNAME!,
    saPass: env.TEST_SA_PASSWORD!,
    adminPass: env.TEST_ADMIN_PASSWORD || undefined,
    bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined,
  };
}
