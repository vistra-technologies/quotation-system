/** Pure unit tests for prisma/db-target-guard.ts (Stage 22 D-19). No DB, no env. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkDbTarget, DEV_ENDPOINT, PROD_ENDPOINT } from "../../prisma/db-target-guard";

const url = (ep: string, pooler = false) =>
  `postgresql://u:p@${ep}${pooler ? "-pooler" : ""}.us-east-2.aws.neon.tech/db?sslmode=require`;

describe("checkDbTarget", () => {
  test("default (EXPECT_ENDPOINT unset/empty): dev allowed, not flagged production", () => {
    for (const e of [undefined, "", "  "]) {
      assert.deepEqual(checkDbTarget(url(DEV_ENDPOINT), e), { ok: true, endpoint: DEV_ENDPOINT, isProduction: false });
    }
    assert.equal(checkDbTarget(url(DEV_ENDPOINT, true), undefined).ok, true); // pooler suffix stripped
  });

  test("default: prod (and any other endpoint) is refused without the opt-in", () => {
    assert.equal(checkDbTarget(url(PROD_ENDPOINT), undefined).ok, false);
    assert.equal(checkDbTarget(url(PROD_ENDPOINT, true), "").ok, false);
    assert.equal(checkDbTarget(url("ep-other-123456"), undefined).ok, false);
  });

  test("opt-in matching prod: allowed and flagged production", () => {
    assert.deepEqual(checkDbTarget(url(PROD_ENDPOINT, true), PROD_ENDPOINT), {
      ok: true,
      endpoint: PROD_ENDPOINT,
      isProduction: true,
    });
  });

  test("opt-in matching dev: allowed, not production", () => {
    const r = checkDbTarget(url(DEV_ENDPOINT), DEV_ENDPOINT);
    assert.equal(r.ok && r.isProduction, false);
    assert.equal(r.ok, true);
  });

  test("opt-in mismatch is refused (either direction)", () => {
    assert.equal(checkDbTarget(url(DEV_ENDPOINT), PROD_ENDPOINT).ok, false);
    assert.equal(checkDbTarget(url(PROD_ENDPOINT), DEV_ENDPOINT).ok, false);
  });

  test("opt-in naming an unknown endpoint is refused even if it matches the URL", () => {
    assert.equal(checkDbTarget(url("ep-other-123456"), "ep-other-123456").ok, false);
  });

  test("unset / unparseable DATABASE_URL is refused regardless of opt-in", () => {
    assert.equal(checkDbTarget(undefined, PROD_ENDPOINT).ok, false);
    assert.equal(checkDbTarget("", undefined).ok, false);
    assert.equal(checkDbTarget("not a url", DEV_ENDPOINT).ok, false);
  });
});
