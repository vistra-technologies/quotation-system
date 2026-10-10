import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ownedProjectWhere,
  ownedInquiryWhere,
  recordsOutsideCompanyWhere,
} from "../../lib/data/ownership";
import type { SessionData } from "../../lib/session";

function session(over: Partial<SessionData>): SessionData {
  return {
    userId: "u1",
    organizationId: "org1",
    roleId: "r1",
    externalCompanyId: null,
    isExternal: false,
    username: "u",
    name: "U",
    ...over,
  };
}

test("internal user: whole org, no company filter", () => {
  for (const fn of [ownedProjectWhere, ownedInquiryWhere]) {
    assert.deepEqual(fn(session({})), { organizationId: "org1" });
  }
});

test("external user with a company: that company only", () => {
  for (const fn of [ownedProjectWhere, ownedInquiryWhere]) {
    assert.deepEqual(fn(session({ isExternal: true, externalCompanyId: "c1" })), {
      organizationId: "org1",
      externalCompanyId: "c1",
    });
  }
});

test("external user with NO company fails closed: matches nothing (legacy rows)", () => {
  for (const fn of [ownedProjectWhere, ownedInquiryWhere]) {
    assert.deepEqual(fn(session({ isExternal: true, externalCompanyId: null })), {
      organizationId: "org1",
      externalCompanyId: { in: [] },
    });
  }
});

test("external-ness comes from the role flag, not from the company id", () => {
  // internal role that happens to carry a company id is still whole-org
  assert.deepEqual(ownedProjectWhere(session({ isExternal: false, externalCompanyId: "c1" })), {
    organizationId: "org1",
  });
});

test("recordsOutsideCompanyWhere: other company OR no company; null target = everything", () => {
  assert.deepEqual(recordsOutsideCompanyWhere("c1"), {
    OR: [{ externalCompanyId: null }, { externalCompanyId: { not: "c1" } }],
  });
  assert.deepEqual(recordsOutsideCompanyWhere(null), {});
});
