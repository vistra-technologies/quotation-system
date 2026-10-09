import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidUserLimit, UserLimitReachedError, USER_LIMIT_RANGE_MESSAGE } from "../../lib/data/user-limit";
import { RESERVED_ORG_SLUGS } from "../../lib/auth-utils";
import { neededTestOrgLimit, originalToRecord, TEST_ORG_LIMIT_HEADROOM } from "../regression/fixtures/test-org-limit";

test("isValidUserLimit accepts only whole numbers 1-10000", () => {
  for (const ok of [1, 3, 25, 9999, 10000]) assert.equal(isValidUserLimit(ok), true, String(ok));
  for (const bad of [0, -1, 10001, 1.5, NaN, Infinity, "3", "", null, undefined, true, [3], {}]) {
    assert.equal(isValidUserLimit(bad), false, String(bad));
  }
  assert.match(USER_LIMIT_RANGE_MESSAGE, /1 and 10000/);
});

test("UserLimitReachedError carries the 409 body fields", () => {
  const e = new UserLimitReachedError(3, 3);
  assert.equal(e.code, "USER_LIMIT_REACHED");
  assert.equal(e.limit, 3);
  assert.equal(e.current, 3);
  assert.equal(e.message, "User limit reached (3/3)");
  assert.ok(e instanceof Error);
});

test("RESERVED_ORG_SLUGS is the S29-10 list, all lowercase", () => {
  assert.deepEqual([...RESERVED_ORG_SLUGS].sort(), ["admin", "api", "app", "controls", "mail", "organizations", "platform", "staging", "test", "www"]);
  for (const s of RESERVED_ORG_SLUGS) assert.equal(s, s.toLowerCase());
});

test("Test Org limit: raise never lowers; a crashed run's recorded original wins over the raised value", () => {
  assert.equal(neededTestOrgLimit(3, 6), 6 + TEST_ORG_LIMIT_HEADROOM);
  assert.equal(neededTestOrgLimit(500, 6), 500);
  assert.equal(originalToRecord(56, null, "o1"), 56); // clean start: current is the original
  assert.equal(originalToRecord(56, { orgId: "o1", original: 3 }, "o1"), 3); // crashed run left the raised 56 behind
  assert.equal(originalToRecord(56, { orgId: "other", original: 3 }, "o1"), 56); // a record for another org is ignored
});
