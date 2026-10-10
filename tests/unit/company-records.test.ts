import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPANY_HAS_RECORDS_CODE,
  companyHasRecords,
  companyHasRecordsMessage,
} from "../../lib/company-records";

test("code is COMPANY_HAS_RECORDS", () => {
  assert.equal(COMPANY_HAS_RECORDS_CODE, "COMPANY_HAS_RECORDS");
});

test("companyHasRecords: any non-zero count blocks", () => {
  assert.equal(companyHasRecords({ users: 0, projects: 0, inquiries: 0 }), false);
  assert.equal(companyHasRecords({ users: 1, projects: 0, inquiries: 0 }), true);
  assert.equal(companyHasRecords({ users: 0, projects: 1, inquiries: 0 }), true);
  assert.equal(companyHasRecords({ users: 0, projects: 0, inquiries: 1 }), true);
});

test("message lists only the non-zero parts", () => {
  assert.equal(
    companyHasRecordsMessage({ users: 2, projects: 1, inquiries: 3 }),
    "This company still has 2 user(s), 1 project(s) and 3 inquiry(ies). Reassign or remove them first.",
  );
  assert.equal(
    companyHasRecordsMessage({ users: 0, projects: 1, inquiries: 0 }),
    "This company still has 1 project(s). Reassign or remove them first.",
  );
  assert.equal(
    companyHasRecordsMessage({ users: 4, projects: 0, inquiries: 2 }),
    "This company still has 4 user(s) and 2 inquiry(ies). Reassign or remove them first.",
  );
});
