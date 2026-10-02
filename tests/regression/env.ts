import path from "node:path";

export const TEST_ORG = "e2e-testorg";
/** git-ignored (.engineering/**): run state, the persistent ledger and per-run storage/cleanup files. */
export const RUN_DIR = path.resolve(__dirname, "..", "..", ".engineering", "regression");
/** Persists across runs — a crashed run's rows are drained by the next run's orphan recovery. */
export const LEDGER_FILE = path.join(RUN_DIR, "ledger.json");
export const RUN_FILE = path.join(RUN_DIR, "run.json");
/** Throwaway password for the suite's own rgr- users (never a real credential). */
export const RGR_PASSWORD = "Rgr-Pass-1234!";

export interface RegEnv {
  baseURL: string;
  saUser: string;
  saPass: string;
  /** Only needed when the Test Org does not exist yet and must be created (Ruling R1). */
  adminPass: string | undefined;
  bypass?: string;
}

const REQUIRED = ["PLAYWRIGHT_BASE_URL", "TEST_SA_USERNAME", "TEST_SA_PASSWORD"] as const;
const PRODUCTION_HOSTS = new Set(["easeetool.com", "www.easeetool.com", "v-quote.vercel.app"]);

export function requireEnv(env: Record<string, string | undefined> = process.env): RegEnv {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`regression suite: missing required env: ${missing.join(", ")}`);
  const baseURL = env.PLAYWRIGHT_BASE_URL!;
  const host = new URL(baseURL).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    throw new Error("regression suite: refusing a local target — run against a Vercel preview or test.easeetool.com (CLAUDE.md rule 7)");
  }
  if (PRODUCTION_HOSTS.has(host)) throw new Error("regression suite: refusing the production host");
  return {
    baseURL,
    saUser: env.TEST_SA_USERNAME!,
    saPass: env.TEST_SA_PASSWORD!,
    adminPass: env.TEST_ADMIN_PASSWORD || undefined,
    bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined,
  };
}
