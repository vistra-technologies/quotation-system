/**
 * Apex landing (Stage 28, S28-16): GET / is a static route handler (app/route.ts) serving
 * content/landing/home.html — not a page. Anonymous, read-only.
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";

covers("GET /");

test("GET / → 200 text/html landing: no org list, no auth/Register controls, no API calls baked in", async ({ anon }) => {
  const r = await anon.get("/");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("text/html");
  const html = await r.text();
  expect(html).toMatch(/made easy/);
  expect(html).not.toMatch(/Select your organization/);
  expect(html).not.toMatch(/api\/v1\/orgs/);
  expect(html).not.toMatch(/fetch\(/);
});
