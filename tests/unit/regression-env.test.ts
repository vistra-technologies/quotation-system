import { test } from "node:test";
import assert from "node:assert/strict";
import { requireEnv, assertAllowedTarget } from "../regression/env";

test("requireEnv lists EVERY missing required variable in one error (no silent skips)", () => {
  assert.throws(
    () => requireEnv({}),
    (e: Error) =>
      ["PLAYWRIGHT_BASE_URL", "TEST_SA_USERNAME", "TEST_SA_PASSWORD"].every((k) => e.message.includes(k)) &&
      !e.message.includes("TEST_ADMIN_PASSWORD"),
  );
});

test("requireEnv: TEST_ADMIN_PASSWORD is optional (only needed to create a missing Test Org)", () => {
  const base = { TEST_SA_USERNAME: "u", TEST_SA_PASSWORD: "p", PLAYWRIGHT_BASE_URL: "https://test.easeetool.com" };
  assert.equal(requireEnv(base).adminPass, undefined);
  assert.equal(requireEnv({ ...base, TEST_ADMIN_PASSWORD: "a" }).adminPass, "a");
});

test("requireEnv refuses localhost and production targets", () => {
  const base = { TEST_SA_USERNAME: "u", TEST_SA_PASSWORD: "p" };
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "http://localhost:3000" }), /local/i);
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000" }), /local/i);
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://easeetool.com" }), /production/i);
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://www.easeetool.com" }), /production/i);
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://v-quote.vercel.app" }), /production/i);
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://quotation-system-git-master-vistra-indias-projects.vercel.app" }), /production/i);
  assert.throws(() => requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://quotation-system-abc123xyz-vistra-indias-projects.vercel.app" }), /hash URLs/i);
  assert.equal(
    requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://test.easeetool.com" }).baseURL,
    "https://test.easeetool.com",
  );
});

test("assertAllowedTarget: allowlist — test.easeetool.com, *.test.easeetool.com, the staging alias and non-production branch aliases only", () => {
  for (const ok of [
    "https://test.easeetool.com",
    "https://test.easeetool.com.",
    "https://TEST.easeetool.com/",
    "https://e2e-testorg.test.easeetool.com",
    "https://quotation-system-git-feature-x-vistra-indias-projects.vercel.app",
    "https://quotation-system-git-feature-regression-suite-vistra-indias-projects.vercel.app",
    "https://quotation-system-git-hotfix-previ-f9b2c7-vistra-indias-projects.vercel.app",
    "https://quotation-system-git-staging-vistra-indias-projects.vercel.app",
    "https://v-quote-test.vercel.app",
  ]) {
    assert.doesNotThrow(() => assertAllowedTarget(ok), ok);
  }
  for (const bad of [
    "https://easeetool.com",
    "https://easeetool.com.",
    "https://www.easeetool.com",
    "https://vistra.easeetool.com",
    "https://e2e-testorg.easeetool.com",
    "https://cloisons.easeetool.com",
    "https://v-quote.vercel.app",
    "https://v-quote.vercel.app.",
    "https://vercel.app",
    // C1: production deployments are reachable on *.vercel.app too — hash URLs, master/main aliases, other projects
    "https://quotation-system-git-master-vistra-indias-projects.vercel.app",
    "https://quotation-system-git-main-vistra-indias-projects.vercel.app",
    "https://quotation-system-ezjf6j8iz-vistra-indias-projects.vercel.app",
    "https://quotation-system-vistra-indias-projects.vercel.app",
    "https://quotation-system.vercel.app",
    "https://quotation-system-git-feature-x-vistra.vercel.app",
    "https://some-other-app.vercel.app",
    "https://quotation-system-git-feature-x-vistra-indias-projects.vercel.app.evil.io",
    "https://test.easeetool.com.evil.io",
    "https://example.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "not a url",
  ]) {
    assert.throws(() => assertAllowedTarget(bad), Error, bad);
  }
});

test("requireEnv passes the Vercel bypass secret through when present", () => {
  const env = { TEST_SA_USERNAME: "u", TEST_SA_PASSWORD: "p", PLAYWRIGHT_BASE_URL: "https://test.easeetool.com" };
  assert.equal(requireEnv(env).bypass, undefined);
  assert.equal(requireEnv({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: "s" }).bypass, "s");
});
