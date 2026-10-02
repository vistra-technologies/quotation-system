/**
 * External companies (distributors / architectural firms): list/create, get/patch/delete.
 *
 * Gates (route source): GET list + GET one → any authenticated org member (they feed the project /
 * inquiry create forms); POST / PATCH / DELETE → MANAGE_USERS.
 *
 * The GST-required-when-INDIA rule is enforced on projects/inquiries, not here (Task 8 covers it).
 * Test-Org companies come from `f.externalCompany` (ledgered); the org-B company used for foreign-id
 * probes goes with org B at teardown.
 */
import { randomBytes } from "node:crypto";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import { apiUrl } from "../../e2e/helpers";

covers("GET /api/v1/orgs/[orgSlug]/external-companies");
covers("POST /api/v1/orgs/[orgSlug]/external-companies");
covers("GET /api/v1/orgs/[orgSlug]/external-companies/[companyId]");
covers("PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId]");
covers("DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]");

type Company = { id: string; name: string; type: string; country: string; defaultCurrency: string };

const orgApi = (slug: string, p: string) => apiUrl(slug, `/api/v1/orgs/${slug}${p}`);
const tag = () => randomBytes(3).toString("hex");

/** One org-B company per worker for foreign-id probes (rgr- name; deleted with org B). */
let foreignCo: Promise<string> | undefined;
function foreignCompanyId(c: Ctx): Promise<string> {
  foreignCo ??= (async () => {
    const slug = c.run.orgB.slug;
    const name = `${c.run.prefix}b-co-${tag()}`;
    const r = await c.orgB.post(orgApi(slug, "/external-companies"), { data: { name, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" } });
    expect(r.status(), await r.text()).toBe(201);
    const l = await c.orgB.get(orgApi(slug, "/external-companies"));
    const id = ((await l.json()) as { companies: Company[] }).companies.find((x) => x.name === name)?.id;
    if (!id) throw new Error(`org-B company ${name} was created but is not listed`);
    return id;
  })();
  return foreignCo;
}

/** The Test Org's distributor's company (exists for the whole run; read-only use). */
async function distributorCompanyId(c: Ctx): Promise<string> {
  const r = await c.as.distributor.get(apiUrl(c.run.testOrg.slug, `/api/v1/orgs/${c.run.testOrg.slug}/me`));
  const id = ((await r.json()) as { externalCompanyId: string | null }).externalCompanyId;
  if (!id) throw new Error("the run's distributor has no external company");
  return id;
}

const valid = (c: Ctx, over: Record<string, unknown> = {}) => ({
  name: `${c.run.prefix}neg-co-${tag()}`,
  type: "DISTRIBUTOR",
  country: "UAE",
  defaultCurrency: "AED",
  ...over,
});

const bodyInvalid = [
  { name: "{} (all fields required)", body: {}, status: 400 },
  { name: "missing defaultCurrency", body: (c: Ctx) => { const b: Record<string, unknown> = valid(c); delete b.defaultCurrency; return b; }, status: 400 },
  { name: "blank name", body: (c: Ctx) => valid(c, { name: "   " }), status: 400 },
  { name: 'country "FRANCE" (must be INDIA or UAE)', body: (c: Ctx) => valid(c, { country: "FRANCE" }), status: 400 },
  { name: 'defaultCurrency "EUR" (must be INR, AED or USD)', body: (c: Ctx) => valid(c, { defaultCurrency: "EUR" }), status: 400 },
  { name: 'type "WIZARD" (must be DISTRIBUTOR or ARCHITECTURAL_FIRM)', body: (c: Ctx) => valid(c, { type: "WIZARD" }), status: 400 },
  { name: "lower-case enum value", body: (c: Ctx) => valid(c, { country: "uae" }), status: 400 },
];

registerNegatives([
  // any authenticated member — no permission gate
  { key: "GET /api/v1/orgs/[orgSlug]/external-companies", method: "GET", path: () => "/external-companies" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/external-companies",
    method: "POST",
    path: () => "/external-companies",
    permission: "MANAGE_USERS",
    body: (c) => ({ name: `${c.run.prefix}neg-co-auth` }), // incomplete → a leaked gate still creates nothing
    invalid: bodyInvalid,
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/external-companies/[companyId]",
    method: "GET",
    path: async (c) => `/external-companies/${await distributorCompanyId(c)}`,
    unknownId: () => `/external-companies/${GHOST}`,
    foreignId: async (c) => `/external-companies/${await foreignCompanyId(c)}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/external-companies/[companyId]",
    method: "PATCH",
    path: () => `/external-companies/${GHOST}`, // never a live row: a leaked gate updates nothing
    permission: "MANAGE_USERS",
    body: (c) => valid(c), // valid, so unknown/foreign ids reach the lookup
    unknownId: () => `/external-companies/${GHOST}`,
    foreignId: async (c) => `/external-companies/${await foreignCompanyId(c)}`,
    invalid: bodyInvalid,
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/external-companies/[companyId]",
    method: "DELETE",
    path: () => `/external-companies/${GHOST}`,
    permission: "MANAGE_USERS",
    unknownId: () => `/external-companies/${GHOST}`,
    foreignId: async (c) => `/external-companies/${await foreignCompanyId(c)}`,
  },
]);

test.describe("external companies: rules", () => {
  test("create → list → get → patch → delete; GET returns exactly the editable fields", async ({ as, f, url, ledger, orgB, run }) => {
    const co = await f.externalCompany();
    const list = (await (await as.admin.get(url("/external-companies"))).json()) as { companies: (Company & { organizationId: string })[] };
    const row = list.companies.find((x) => x.id === co.id);
    expect(row).toMatchObject({ name: co.name, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED", organizationId: run.testOrg.id });
    for (const c of list.companies) expect(c.organizationId).toBe(run.testOrg.id);

    const g = await as.admin.get(url(`/external-companies/${co.id}`));
    expect(g.status(), await g.text()).toBe(200);
    const got = ((await g.json()) as { company: Company }).company;
    expect(Object.keys(got).sort()).toEqual(["country", "defaultCurrency", "id", "name", "type"]);
    expect(got).toEqual({ id: co.id, name: co.name, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" });

    // org B cannot see it
    const bList = (await (await orgB.get(orgApi(run.orgB.slug, "/external-companies"))).json()) as { companies: Company[] };
    expect(bList.companies.map((x) => x.id)).not.toContain(co.id);

    const renamed = `${co.name}-renamed`;
    const p = await as.admin.patch(url(`/external-companies/${co.id}`), {
      data: { name: `  ${renamed} `, type: "ARCHITECTURAL_FIRM", country: "INDIA", defaultCurrency: "INR" },
    });
    expect(p.status(), await p.text()).toBe(200);
    expect(await p.json()).toEqual({ success: true });
    expect(((await (await as.admin.get(url(`/external-companies/${co.id}`))).json()) as { company: Company }).company).toEqual({
      id: co.id, name: renamed, type: "ARCHITECTURAL_FIRM", country: "INDIA", defaultCurrency: "INR",
    });

    // PATCH is a full replace: a partial body is rejected and nothing changes
    const partial = await as.admin.patch(url(`/external-companies/${co.id}`), { data: { name: `${co.name}-partial` } });
    expect(partial.status(), await partial.text()).toBe(400);
    expect(((await (await as.admin.get(url(`/external-companies/${co.id}`))).json()) as { company: Company }).company.name).toBe(renamed);

    const d = await as.admin.delete(url(`/external-companies/${co.id}`));
    expect(d.status(), await d.text()).toBe(200);
    expect(await d.json()).toEqual({ success: true });
    ledger.remove(co.id);
    expect((await as.admin.get(url(`/external-companies/${co.id}`))).status()).toBe(404);
    expect((await as.admin.delete(url(`/external-companies/${co.id}`))).status()).toBe(404);
    const after = (await (await as.admin.get(url("/external-companies"))).json()) as { companies: Company[] };
    expect(after.companies.map((x) => x.id)).not.toContain(co.id);
  });

  test("any org member (no MANAGE_USERS) can list and read companies, but not write them", async ({ as, f, url, run }) => {
    const co = await f.externalCompany();
    for (const role of ["member", "distributor", "architect"] as const) {
      const l = await as[role].get(url("/external-companies"));
      expect(l.status(), `${role}: ${await l.text()}`).toBe(200);
      expect(((await l.json()) as { companies: Company[] }).companies.map((x) => x.id)).toContain(co.id);
      const g = await as[role].get(url(`/external-companies/${co.id}`));
      expect(g.status(), role).toBe(200);
      const p = await as[role].patch(url(`/external-companies/${co.id}`), {
        data: { name: `${run.prefix}hijack`, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" },
      });
      expect(p.status(), role).toBe(403);
      expect((await as[role].delete(url(`/external-companies/${co.id}`))).status(), role).toBe(403);
    }
    expect(((await (await as.admin.get(url(`/external-companies/${co.id}`))).json()) as { company: Company }).company.name).toBe(co.name);
  });

  // Pinned (route + DAL doc, Stage 13 Batch 2): there is NO "in use" guard — User/Project/Inquiry
  // .externalCompanyId are ON DELETE SET NULL. Consequence flagged in the Task 7 report: an external-role
  // user is left without the company U3 requires.
  test("deleting a company that users reference succeeds (200) and nulls their externalCompanyId", async ({ as, f, url, ledger }) => {
    const u = await f.user("distributor"); // the factory creates + ledgers its company
    const g = await as.admin.get(url(`/users/${u.id}`));
    expect(g.status(), await g.text()).toBe(200);
    const coId = ((await g.json()) as { user: { externalCompanyId: string | null } }).user.externalCompanyId;
    expect(coId).toEqual(expect.any(String));

    const d = await as.admin.delete(url(`/external-companies/${coId}`));
    expect(d.status(), await d.text()).toBe(200);
    ledger.remove(coId!);
    expect((await as.admin.get(url(`/external-companies/${coId}`))).status()).toBe(404);
    const after = (await (await as.admin.get(url(`/users/${u.id}`))).json()) as { user: { externalCompanyId: string | null; active: boolean } };
    expect(after.user.externalCompanyId).toBeNull();
    expect(after.user.active).toBe(true);
  });

  test("duplicate names are allowed (no uniqueness constraint): a second create with the same name → 201", async ({ as, f, url, run, ledger }) => {
    const co = await f.externalCompany();
    const r = await as.admin.post(url("/external-companies"), {
      data: { name: co.name, type: "ARCHITECTURAL_FIRM", country: "INDIA", defaultCurrency: "USD" },
    });
    expect(r.status(), await r.text()).toBe(201);
    expect(await r.json()).toEqual({ success: true });
    const same = ((await (await as.admin.get(url("/external-companies"))).json()) as { companies: Company[] }).companies.filter((x) => x.name === co.name);
    const twin = same.find((x) => x.id !== co.id);
    if (twin) ledger.add({ kind: "externalCompany", id: twin.id, orgSlug: run.testOrg.slug, label: co.name });
    expect(same).toHaveLength(2);
    expect(twin).toMatchObject({ type: "ARCHITECTURAL_FIRM", country: "INDIA", defaultCurrency: "USD" });
  });
});
