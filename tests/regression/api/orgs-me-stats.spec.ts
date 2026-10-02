/**
 * Org listing, /me, /stats and the global permission catalog.
 * Negatives come from the matrix; happy paths and leak checks are explicit below.
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives } from "./api-matrix";
import { PERMISSION_CODES, ROLES, ROLE_NAME, ROLE_PERMISSIONS } from "./permissions";
import { apiUrl } from "../../e2e/helpers";

covers("GET /api/v1/orgs");
covers("GET /api/v1/orgs/[orgSlug]/me");
covers("GET /api/v1/orgs/[orgSlug]/stats");
covers("GET /api/v1/permissions");

registerNegatives([
  // any authenticated org member — no permission gate
  { key: "GET /api/v1/orgs/[orgSlug]/me", method: "GET", path: () => "/me" },
  { key: "GET /api/v1/orgs/[orgSlug]/stats", method: "GET", path: () => "/stats" },
  // global catalog: session + MANAGE_FEATURES, no org slug
  { key: "GET /api/v1/permissions", method: "GET", orgScoped: false, path: () => "/api/v1/permissions", permission: "MANAGE_FEATURES" },
]);

const SECRET_FIELD = /password|hash|secret|token/i;

test.describe("GET /api/v1/orgs/[orgSlug]/me", () => {
  for (const role of ROLES) {
    test(`${role}: returns the signed-in user, its role and exactly its role's permissions`, async ({ as, url, run }) => {
      const r = await as[role].get(url("/me"));
      expect(r.status(), await r.text()).toBe(200);
      const me = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(me).sort()).toEqual(
        ["adminPermissions", "externalCompanyId", "externalCompanyName", "name", "orgName", "permissionCodes", "roleName", "userId", "username"].sort(),
      );
      expect(Object.keys(me).filter((k) => SECRET_FIELD.test(k))).toEqual([]);
      expect(me.userId).toBe(run.users[role].id);
      expect(me.username).toBe(run.users[role].username);
      expect(me.roleName).toBe(ROLE_NAME[role]);
      expect([...(me.permissionCodes as string[])].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
      const adminish = ["MANAGE_USERS", "MANAGE_FEATURES", "MANAGE_PRICING"];
      expect([...(me.adminPermissions as string[])].sort()).toEqual(ROLE_PERMISSIONS[role].filter((p) => adminish.includes(p)).sort());
      if (role === "admin" || role === "member") expect(me.externalCompanyId).toBeNull();
      else expect(me.externalCompanyId).toEqual(expect.any(String));
    });
  }

  test("org B's admin sees org B's identity on org B's slug (no Test-Org data)", async ({ orgB, run }) => {
    const r = await orgB.get(apiUrl(run.orgB.slug, `/api/v1/orgs/${run.orgB.slug}/me`));
    expect(r.status(), await r.text()).toBe(200);
    const me = (await r.json()) as { username: string; userId: string };
    expect(me.username).toBe(run.orgB.adminUser);
    expect(Object.values(run.users).map((u) => u.id)).not.toContain(me.userId);
  });
});

test.describe("GET /api/v1/orgs/[orgSlug]/stats", () => {
  const KEYS = ["inquiriesNew", "inquiriesTotal", "ordersTotal", "projectsInProgress", "projectsTotal"];

  test("returns exactly the numeric KPI counters (ordersTotal is 0 until Orders exist)", async ({ as, url }) => {
    for (const role of ROLES) {
      const r = await as[role].get(url("/stats"));
      expect(r.status(), await r.text()).toBe(200);
      const s = (await r.json()) as Record<string, unknown>;
      expect(Object.keys(s).sort()).toEqual(KEYS);
      for (const k of KEYS) expect(Number.isInteger(s[k]) && (s[k] as number) >= 0, `${role} ${k}=${String(s[k])}`).toBe(true);
      expect(s.ordersTotal).toBe(0);
    }
  });

  test("a new Test-Org project is counted for the admin and never in org B's counters", async ({ as, url, f, orgB, run }) => {
    const stats = async (g: typeof orgB, u: string) => {
      const r = await g.get(u);
      expect(r.status(), await r.text()).toBe(200);
      return (await r.json()) as { projectsTotal: number; projectsInProgress: number };
    };
    const orgBUrl = apiUrl(run.orgB.slug, `/api/v1/orgs/${run.orgB.slug}/stats`);
    const before = await stats(as.admin, url("/stats"));
    const bBefore = await stats(orgB, orgBUrl);
    await f.project();
    const after = await stats(as.admin, url("/stats"));
    const bAfter = await stats(orgB, orgBUrl);
    expect(after.projectsTotal).toBeGreaterThanOrEqual(before.projectsTotal + 1);
    expect(after.projectsInProgress).toBeGreaterThanOrEqual(before.projectsInProgress + 1); // new projects are DRAFT
    expect(bAfter).toEqual(bBefore);
  });
});

test.describe("GET /api/v1/orgs (public org selector)", () => {
  test("anonymous 200: every org as exactly {id, slug, name} — no other fields", async ({ anon, run }) => {
    // Intentionally public (route doc: the apex org-selector and login page fetch it without a session).
    const r = await anon.get(apiUrl(run.testOrg.slug, "/api/v1/orgs"));
    expect(r.status(), await r.text()).toBe(200);
    const { orgs } = (await r.json()) as { orgs: Record<string, unknown>[] };
    expect(Array.isArray(orgs)).toBe(true);
    for (const o of orgs) expect(Object.keys(o).sort()).toEqual(["id", "name", "slug"]);
    expect(orgs.map((o) => o.slug)).toEqual(expect.arrayContaining([run.testOrg.slug, run.orgB.slug]));
  });

  test("an org session sees the same public list (the session grants nothing extra)", async ({ anon, as, run }) => {
    const u = apiUrl(run.testOrg.slug, "/api/v1/orgs");
    const [a, s] = await Promise.all([anon.get(u), as.admin.get(u)]);
    expect(s.status()).toBe(200);
    const keys = (b: { orgs: Record<string, unknown>[] }) => b.orgs.map((o) => Object.keys(o).sort().join(",")).filter((k) => k !== "id,name,slug");
    expect(keys((await s.json()) as { orgs: Record<string, unknown>[] })).toEqual([]);
    expect(a.status()).toBe(200);
  });
});

test.describe("GET /api/v1/permissions", () => {
  test("admin (MANAGE_FEATURES): the catalog holds the 8 permission codes, each {id, code, description}", async ({ as, run }) => {
    const r = await as.admin.get(apiUrl(run.testOrg.slug, "/api/v1/permissions"));
    expect(r.status(), await r.text()).toBe(200);
    const { permissions } = (await r.json()) as { permissions: Record<string, unknown>[] };
    for (const p of permissions) expect(Object.keys(p).sort()).toEqual(["code", "description", "id"]);
    const codes = permissions.map((p) => p.code as string);
    expect(codes).toEqual(expect.arrayContaining([...PERMISSION_CODES]));
  });
});
