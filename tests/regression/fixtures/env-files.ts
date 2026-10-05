// Pure-ish (fs/git injected) — unit-tested in tests/unit/regression-env-files.test.ts.
// Finds the git-ignored env files the regression suite needs when it runs from a git WORKTREE, where they are not
// checked out: resolve next to the config file first, then fall back to the MAIN checkout (git's common dir parent).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config as dotenv } from "dotenv";

/** Credentials / base URL (PLAYWRIGHT_BASE_URL, TEST_SA_*, bypass secret). Required unless those vars are already in the real env. */
export const CREDENTIALS_FILE = ".env.playwright.local";
/** DATABASE_URL source, same precedence as Next (.env.local over .env). At least one must provide DATABASE_URL. */
export const DB_FILES = [".env.local", ".env"] as const;

export interface EnvFileDeps {
  exists: (p: string) => boolean;
  /** Absolute path of the main checkout when `dir` is inside a worktree (else null). */
  mainCheckout: (dir: string) => string | null;
}

export const realDeps: EnvFileDeps = {
  exists: (p) => fs.existsSync(p),
  mainCheckout(dir) {
    const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: dir, encoding: "utf-8" });
    if (r.status !== 0 || !r.stdout.trim()) return null;
    // `<main>/.git` (may be relative to `dir`) → its parent is the main checkout.
    return path.dirname(path.resolve(dir, r.stdout.trim()));
  },
};

/** The first existing copy of `name`: `dir/name`, else `<main checkout>/name`; null when neither exists. */
export function findEnvFile(name: string, dir: string, deps: EnvFileDeps = realDeps): string | null {
  const here = path.join(dir, name);
  if (deps.exists(here)) return here;
  const main = deps.mainCheckout(dir);
  if (main && path.resolve(main) !== path.resolve(dir)) {
    const there = path.join(main, name);
    if (deps.exists(there)) return there;
  }
  return null;
}

/**
 * Loads the regression env files into `env` (dotenv never overrides a var that is already set, so a real env var
 * still wins). Throws — naming exactly which files to copy — when the suite could not possibly run:
 * the credentials are neither in the env nor in .env.playwright.local, or no DATABASE_URL after loading.
 */
export function loadRegressionEnv(
  dir: string,
  env: Record<string, string | undefined> = process.env,
  deps: EnvFileDeps = realDeps,
  load: (file: string) => void = (file) => void dotenv({ path: file, quiet: true, processEnv: env as NodeJS.ProcessEnv }),
): void {
  const creds = findEnvFile(CREDENTIALS_FILE, dir, deps);
  if (creds) load(creds);
  for (const name of DB_FILES) {
    const f = findEnvFile(name, dir, deps);
    if (f) load(f);
  }
  const missing: string[] = [];
  if (!creds && !(env.TEST_SA_USERNAME && env.TEST_SA_PASSWORD)) {
    missing.push(`${CREDENTIALS_FILE} (PLAYWRIGHT_BASE_URL, TEST_SA_USERNAME, TEST_SA_PASSWORD, ...)`);
  }
  if (!env.DATABASE_URL) missing.push(`${DB_FILES[0]} or ${DB_FILES[1]} (DATABASE_URL — the dev Neon branch)`);
  if (missing.length) {
    throw new Error(
      `regression suite: missing env file(s). Looked in ${dir} and in the main checkout (git rev-parse --git-common-dir).\n` +
        `Copy from the main checkout into ${dir}:\n  - ${missing.join("\n  - ")}`,
    );
  }
}
