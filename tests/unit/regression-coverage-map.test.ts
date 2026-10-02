import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enumerateRoutes, enumeratePages, collectCovered, checkCoverage } from "../regression/coverage-map";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  const w = (p: string, c: string) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  w("app/api/v1/orgs/[orgSlug]/projects/route.ts", "export async function GET(){}\nexport async function POST(){}");
  w("app/api/v1/orgs/[orgSlug]/projects/[projectId]/route.ts", "export const dynamic='x';\nexport async function DELETE(){}");
  w("app/controls/(authenticated)/orgs/page.tsx", "export default function P(){return null}");
  w("app/[orgSlug]/dashboard/page.tsx", "export default function P(){return null}");
  w("tests/regression/api/a.spec.ts", `covers("GET /api/v1/orgs/[orgSlug]/projects"); coversPage('/[orgSlug]/dashboard');\ncovers("PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]")`);
  return root;
}

test("enumerateRoutes: one entry per exported verb; non-verb exports ignored", () => {
  const r = enumerateRoutes(path.join(fixture(), "app"));
  assert.deepEqual(r.sort(), ["DELETE /api/v1/orgs/[orgSlug]/projects/[projectId]", "GET /api/v1/orgs/[orgSlug]/projects", "POST /api/v1/orgs/[orgSlug]/projects"]);
});
test("enumerateRoutes: export const GET = ... is recognised", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  fs.mkdirSync(path.join(root, "app", "api", "x"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", "api", "x", "route.ts"), "export const GET = async () => {};");
  assert.deepEqual(enumerateRoutes(path.join(root, "app")), ["GET /api/x"]);
});
test("enumeratePages: route groups (parentheses) are stripped from the URL", () => {
  assert.deepEqual(enumeratePages(path.join(fixture(), "app")).sort(), ["/[orgSlug]/dashboard", "/controls/orgs"]);
});
test("enumeratePages: root page is '/' and groups are stripped", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  fs.mkdirSync(path.join(root, "app", "(marketing)", "about"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", "page.tsx"), "export default function P(){return null}");
  fs.writeFileSync(path.join(root, "app", "(marketing)", "about", "page.tsx"), "export default function P(){return null}");
  assert.deepEqual(enumeratePages(path.join(root, "app")).sort(), ["/", "/about"]);
});
test("checkCoverage reports untested routes/pages AND stale registrations", () => {
  const root = fixture();
  const routes = enumerateRoutes(path.join(root, "app"));
  const pages = enumeratePages(path.join(root, "app"));
  const covered = collectCovered(path.join(root, "tests", "regression"));
  const res = checkCoverage({ routes, pages }, covered);
  assert.deepEqual(res.untested.sort(), ["DELETE /api/v1/orgs/[orgSlug]/projects/[projectId]", "POST /api/v1/orgs/[orgSlug]/projects", "page /controls/orgs"]);
  assert.deepEqual(res.stale, ["PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]"]);
});
