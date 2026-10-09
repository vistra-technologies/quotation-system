/**
 * Stage 30 observability: every wrapped route answers with an `x-request-id` header (org 200/401/404,
 * SuperAdmin 200/401, /api/auth sign-in 401), and /api/health stays unwrapped and unchanged.
 *
 * Read-only: no writes, no data created. The deterministic 500 body (`requestId` mirrored in the header)
 * is pinned in roles-permissions / projects / inquiries; it is not repeated here. A server-action-driven
 * page POST is not cheaply reachable from the API-level suite (actions are invoked through Next's
 * action protocol, not a stable URL), so it is not asserted here.
 */
import { test, expect, SA, GHOST } from "./sa-helpers";
import { bypass, signIn } from "./sign-in";
import type { APIResponse } from "@playwright/test";

/** x-request-id present and non-empty; when Vercel's own id is visible, it ends with ours (S30-3). */
function expectRequestId(r: APIResponse): string {
  const id = r.headers()["x-request-id"];
  expect(id, `x-request-id missing on ${r.url()} (${r.status()})`).toBeTruthy();
  expect(id).not.toContain("::");
  const vercelId = r.headers()["x-vercel-id"];
  if (vercelId) expect(vercelId.endsWith(id)).toBe(true);
  return id;
}

test.describe("x-request-id on wrapped routes", () => {
  test("org route 200 (GET /me)", async ({ as, url }) => {
    const r = await as.admin.get(url("/me"));
    expect(r.status(), await r.text()).toBe(200);
    expectRequestId(r);
  });

  test("org route 401 (GET /me, anonymous)", async ({ anon, url }) => {
    const r = await anon.get(url("/me"));
    expect(r.status()).toBe(401);
    expectRequestId(r);
  });

  test("org route 404 (GET /projects/<ghost id>)", async ({ as, url }) => {
    const r = await as.admin.get(url(`/projects/${GHOST}`));
    expect(r.status(), await r.text()).toBe(404);
    expectRequestId(r);
  });

  test("two requests get two different ids", async ({ as, url }) => {
    const a = expectRequestId(await as.admin.get(url("/me")));
    const b = expectRequestId(await as.admin.get(url("/me")));
    expect(a).not.toBe(b);
  });

  test("SuperAdmin route 200 (GET /ping)", async ({ sa }) => {
    const r = await sa.get(`${SA}/ping`);
    expect(r.status(), await r.text()).toBe(200);
    expectRequestId(r);
  });

  test("SuperAdmin route 401 (GET /ping, anonymous)", async ({ anon }) => {
    const r = await anon.get(`${SA}/ping`);
    expect(r.status()).toBe(401);
    expectRequestId(r);
  });

  test("/api/auth sign-in 401 (unknown user)", async ({ playwright, baseURL, run }) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypass() });
    try {
      const r = await signIn(ctx, run.testOrg.slug, `${run.prefix}obs-ghost`, "wrong-password-rgr");
      expect(r.status(), await r.text()).toBe(401);
      expectRequestId(r);
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe("/api/health stays unwrapped", () => {
  test("same 200 body as before and no x-request-id header", async ({ anon }) => {
    const r = await anon.get("/api/health");
    expect(r.status()).toBe(200);
    expect(Object.keys((await r.json()) as object).sort()).toEqual(["database", "healthCheckRows", "status", "timestamp"]);
    expect(r.headers()["x-request-id"]).toBeUndefined();
  });
});
