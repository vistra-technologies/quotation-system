import { test } from "node:test";
import assert from "node:assert/strict";
import { requireEnv } from "../regression/env";

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
  assert.equal(
    requireEnv({ ...base, PLAYWRIGHT_BASE_URL: "https://test.easeetool.com" }).baseURL,
    "https://test.easeetool.com",
  );
});

test("requireEnv passes the Vercel bypass secret through when present", () => {
  const env = { TEST_SA_USERNAME: "u", TEST_SA_PASSWORD: "p", PLAYWRIGHT_BASE_URL: "https://test.easeetool.com" };
  assert.equal(requireEnv(env).bypass, undefined);
  assert.equal(requireEnv({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: "s" }).bypass, "s");
});
