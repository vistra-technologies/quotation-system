import path from "node:path";

export const TEST_ORG = "e2e-testorg";
/** git-ignored (.engineering/**): run state, the persistent ledger and per-run storage/cleanup files. */
export const RUN_DIR = path.resolve(__dirname, "..", "..", ".engineering", "regression");
/** Persists across runs — a crashed run's rows are drained by the next run's orphan recovery. */
export const LEDGER_FILE = path.join(RUN_DIR, "ledger.json");
export const RUN_FILE = path.join(RUN_DIR, "run.json");
/** Exclusive per-checkout run lock (pid inside) — taken by global setup, released by global teardown. */
export const LOCK_FILE = path.join(RUN_DIR, "run.lock");
/** Last teardown's outcome, read by scripts/regression.mjs to decide whether a retry is allowed (R16). */
export const TEARDOWN_STATUS_FILE = path.join(RUN_DIR, "last-teardown.json");
/**
 * Env var carrying this run's generated password for its rgr- users (R18). Set by global setup and
 * inherited by Playwright workers; never written to disk.
 */
export const RUN_PASSWORD_ENV = "RGR_RUN_PASSWORD";
/** Set by global-setup (main process) so the reporter reads ONLY this run's cleanup.json. */
export const RUN_ID_ENV = "RGR_RUN_ID";

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
/** The staging branch's legacy alias (root CLAUDE.md, branching table) — still re-pointed at staging deployments. */
const STAGING_ALIAS = "v-quote-test.vercel.app";
/**
 * Vercel's per-BRANCH alias: quotation-system-git-<branch>-vistra-indias-projects.vercel.app (a long branch name
 * is truncated + hashed, e.g. quotation-system-git-hotfix-previ-f9b2c7-vistra-indias-projects.vercel.app).
 * The production branches (master / main) are refused below.
 */
const BRANCH_ALIAS = /^quotation-system-git-(.+)-vistra-indias-projects\.vercel\.app$/;
const PRODUCTION_BRANCH = /^(master|main)(-|$)/;

/**
 * ALLOWLIST of targets (R15 + final review C1): test.easeetool.com, *.test.easeetool.com, the staging alias
 * v-quote-test.vercel.app, and per-branch git aliases of any branch except master/main. Every other host is
 * refused — localhost, any other *.easeetool.com (production org subdomains), the production alias, and the
 * per-deployment hash URLs (quotation-system-<hash>-vistra-indias-projects.vercel.app), because a hash URL
 * looks the same for a production deployment as for a preview. Global setup additionally proves the target's
 * DB is the dev DB (API org ids must equal the dev DB's — fixtures/target-identity.ts).
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
  const branch = BRANCH_ALIAS.exec(host)?.[1];
  if (branch !== undefined && PRODUCTION_BRANCH.test(branch)) {
    throw new Error(`regression suite: refusing "${host}" — the ${branch.split("-")[0]} branch alias is the production deployment`);
  }
  const ok =
    host === "test.easeetool.com" ||
    host.endsWith(".test.easeetool.com") ||
    host === STAGING_ALIAS ||
    branch !== undefined;
  if (!ok) {
    throw new Error(
      `regression suite: refusing target "${host}" — only test.easeetool.com, *.test.easeetool.com, ${STAGING_ALIAS} and ` +
        `quotation-system-git-<branch>-vistra-indias-projects.vercel.app (not master/main) are allowed; per-deployment hash URLs ` +
        `are refused because a production deployment has one too — use the branch alias`,
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
