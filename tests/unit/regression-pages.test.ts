import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { enumeratePages } from "../regression/coverage-map";
import { PAGES, fillPath, orgRelative } from "../regression/pages/page-table";
import { ALLOWED } from "../regression/pages/collect";

const root = path.resolve(__dirname, "..", "..");

test("page table = the app's page.tsx files = pages.spec.ts's literal coversPage() lines", () => {
  const app = enumeratePages(path.join(root, "app")).sort();
  const table = PAGES.map((r) => r.path).sort();
  assert.deepEqual(table, app);
  assert.equal(new Set(table).size, table.length, "duplicate rows");
  const spec = fs.readFileSync(path.join(root, "tests", "regression", "pages", "pages.spec.ts"), "utf-8");
  const literal = [...spec.matchAll(/^coversPage\("([^"]+)"\);$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(literal, app);
});

test("every row's params are fillable; orgRelative strips the org segment", () => {
  const params = { projectId: "p", inquiryId: "i", companyId: "c", userId: "u", setId: "s", orgId: "o" };
  for (const r of PAGES) assert.doesNotMatch(fillPath(orgRelative(r.path), params), /\[/, r.path);
  assert.equal(orgRelative("/[orgSlug]"), "/");
  assert.equal(orgRelative("/[orgSlug]/projects/[projectId]"), "/projects/[projectId]");
  assert.throws(() => fillPath("/x/[projectId]", {}), /no value for \[projectId\]/);
});

test("collector allow-list: only browser-aborted RSC, superseded navigations and Vercel tooling", () => {
  const ok = (p: string) => ALLOWED.some((a) => a.match(p));
  assert.equal(ALLOWED.length, 3, "allow-list grew — justify the new entry in collect.ts and the task report");
  // allowed
  assert.ok(ok("request failed [fetch/rsc] https://e2e-testorg.test.easeetool.com/projects?_rsc=4s5C net::ERR_ABORTED"));
  assert.ok(ok("request failed [fetch/rsc] https://e2e-testorg.test.easeetool.com/ net::ERR_ABORTED"));
  assert.ok(ok("request failed [document/nav] https://e2e-testorg.test.easeetool.com/login net::ERR_ABORTED"));
  assert.ok(ok("request failed [fetch] https://e2e-testorg.test.easeetool.com/.well-known/vercel/jwe net::ERR_ABORTED"));
  assert.ok(ok("request failed [script] https://vercel.live/login/validate?hostname=x net::ERR_ABORTED"));
  assert.ok(ok("request failed [fetch/OPTIONS] https://e2e-testorg.test.easeetool.com/ net::ERR_ABORTED"));
  // NOT allowed: other failure kinds, non-navigation document/API aborts, errors, 5xx
  assert.ok(!ok("request failed [fetch/rsc] https://e2e-testorg.test.easeetool.com/projects?_rsc=4s5C net::ERR_FAILED"));
  assert.ok(!ok("request failed [fetch] https://e2e-testorg.test.easeetool.com/projects?_rsc=4s5C net::ERR_ABORTED")); // no RSC header
  assert.ok(!ok("request failed [fetch] https://e2e-testorg.test.easeetool.com/api/v1/orgs/x/me net::ERR_ABORTED"));
  assert.ok(!ok("request failed [document/nav] https://e2e-testorg.test.easeetool.com/login net::ERR_CONNECTION_RESET"));
  assert.ok(!ok("request failed [script] https://evil.example/vercel.live/x net::ERR_ABORTED"));
  assert.ok(ok("request failed [fetch/OPTIONS] https://e2e-testorg.test.easeetool.com/dashboard net::ERR_ABORTED"));
  assert.ok(!ok("request failed [fetch/OPTIONS] https://e2e-testorg.test.easeetool.com/api/v1/orgs/x/me net::ERR_ABORTED"));
  assert.ok(!ok("request failed [fetch/POST] https://e2e-testorg.test.easeetool.com/ net::ERR_ABORTED"));
  assert.ok(!ok("console.error: Failed to load resource: the server responded with a status of 500 ()"));
  assert.ok(!ok("pageerror: MISSING_MESSAGE: Could not resolve `selections` in messages"));
  assert.ok(!ok("HTTP 500 https://e2e-testorg.test.easeetool.com/projects"));
});
