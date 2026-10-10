import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject } from "../../lib/data/projects";
import { createInquiry } from "../../lib/data/inquiries";
import type { SessionData } from "../../lib/session";

// Stage 31 R1 fix: replaces the live check that the S31-5 rework dropped. The guard runs before any DB
// access, so an external user with no company (legacy row) is refused with code NO_COMPANY (routes map it
// to 403 "Your account is not linked to a company").
const orphan: SessionData = {
  userId: "u1",
  organizationId: "org1",
  roleId: "r1",
  externalCompanyId: null,
  isExternal: true,
  username: "u",
  name: "U",
};

test("createProject refuses an external user with no company (NO_COMPANY) before touching the DB", async () => {
  await assert.rejects(
    createProject(orphan, { name: "p", currency: "AED" } as never),
    (e: Error & { code?: string }) => e.code === "NO_COMPANY" && e.message === "Your account is not linked to a company",
  );
});

test("createInquiry refuses an external user with no company (NO_COMPANY) before touching the DB", async () => {
  await assert.rejects(
    createInquiry(orphan, { name: "i", currency: "AED" } as never),
    (e: Error & { code?: string }) => e.code === "NO_COMPANY" && e.message === "Your account is not linked to a company",
  );
});
