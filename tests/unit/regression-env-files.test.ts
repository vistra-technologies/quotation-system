import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { findEnvFile, loadRegressionEnv, type EnvFileDeps } from "../regression/fixtures/env-files";

const WT = path.resolve("/repo/.worktrees/wt");
const MAIN = path.resolve("/repo");
const deps = (present: string[], main: string | null = MAIN): EnvFileDeps => ({
  exists: (p) => present.map((x) => path.resolve(x)).includes(path.resolve(p)),
  mainCheckout: () => main,
});

test("findEnvFile prefers the file next to the config, then the main checkout, else null", () => {
  assert.equal(findEnvFile(".env.x", WT, deps([path.join(WT, ".env.x"), path.join(MAIN, ".env.x")])), path.join(WT, ".env.x"));
  assert.equal(findEnvFile(".env.x", WT, deps([path.join(MAIN, ".env.x")])), path.join(MAIN, ".env.x"));
  assert.equal(findEnvFile(".env.x", WT, deps([])), null);
  assert.equal(findEnvFile(".env.x", WT, deps([path.join(MAIN, ".env.x")], null)), null); // not a worktree / git unavailable
});

test("loadRegressionEnv loads credentials + DB files from the main checkout when run from a worktree", () => {
  const loaded: string[] = [];
  const env: Record<string, string | undefined> = {};
  loadRegressionEnv(
    WT,
    env,
    deps([path.join(MAIN, ".env.playwright.local"), path.join(MAIN, ".env.local")]),
    (f) => {
      loaded.push(f);
      if (f.endsWith(".env.local")) env.DATABASE_URL = "postgres://x";
    },
  );
  assert.deepEqual(loaded, [path.join(MAIN, ".env.playwright.local"), path.join(MAIN, ".env.local")]);
});

test("loadRegressionEnv throws naming exactly the files to copy when nothing is found", () => {
  assert.throws(
    () => loadRegressionEnv(WT, {}, deps([]), () => {}),
    (e: Error) =>
      e.message.includes(".env.playwright.local") &&
      e.message.includes(".env.local or .env") &&
      e.message.includes(WT),
  );
});

test("loadRegressionEnv: only the DB file missing is reported alone; real env vars satisfy the requirement", () => {
  assert.throws(
    () => loadRegressionEnv(WT, {}, deps([path.join(WT, ".env.playwright.local")]), () => {}),
    (e: Error) => !e.message.includes("TEST_SA_USERNAME") && e.message.includes("DATABASE_URL"),
  );
  // CI-style: everything already in the environment, no files at all.
  assert.doesNotThrow(() =>
    loadRegressionEnv(WT, { TEST_SA_USERNAME: "u", TEST_SA_PASSWORD: "p", DATABASE_URL: "d" }, deps([]), () => {}),
  );
});
