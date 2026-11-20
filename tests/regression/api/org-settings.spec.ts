/**
 * Organization settings (Stage 38, S38-7): `GET` / `PATCH /api/v1/orgs/[orgSlug]/settings`, both gated by
 * MANAGE_ORG (admin only among the default roles; member, distributor, architect get 403).
 *
 * Mutations run ONLY in throwaway org B (rule 10); the Test Org's own default currency is never written.
 * Org B starts at the column default (INR, as every SuperAdmin-created org does) and is put back to INR in
 * `finally`, even when an assertion fails. `/me` carries `orgDefaultCurrency` for every user (asserted in
 * orgs-me-stats.spec.ts for all four roles).
 *
 * Not covered here: a suspended org answering 403 ORG_SUSPENDED is the generic getApiSession path, asserted
 * for org routes in superadmin-orgs.spec.ts (suspending org B mid-run would break sibling specs).
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { apiUrl } from "../../e2e/helpers";
import { registerNegatives } from "./api-matrix";
import { ok, rejected } from "./design-helpers";

covers("GET /api/v1/orgs/[orgSlug]/settings");
covers("PATCH /api/v1/orgs/[orgSlug]/settings");

const CURRENCY_ERR = "currency must be one of INR, AED, USD";

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/settings", method: "GET", path: () => "/settings", permission: "MANAGE_ORG" },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/settings",
    method: "PATCH",
    path: () => "/settings",
    permission: "MANAGE_ORG",
    body: () => ({ defaultCurrency: "EUR" }), // invalid on purpose: a leaked gate still writes nothing
    invalid: [
      { name: "{} (defaultCurrency required)", body: {}, status: 400 },
      { name: 'defaultCurrency "EUR"', body: { defaultCurrency: "EUR" }, status: 400 },
      { name: "defaultCurrency 5 (not a string)", body: { defaultCurrency: 5 }, status: 400 },
      { name: "defaultCurrency null", body: { defaultCurrency: null }, status: 400 },
      { name: "defaultCurrency blank", body: { defaultCurrency: "  " }, status: 400 },
      { name: "JSON array body", body: [], status: 400 },
      { name: "JSON null body", body: null, status: 400 },
    ],
  },
]);

test.describe("organization settings: default currency", () => {
  test.describe.configure({ mode: "serial" });

  test("org B (a SuperAdmin-created org) starts INR; PATCH round-trips, normalises case, and /me follows; INR restored", async ({ orgB, run }) => {
    const settings = apiUrl(run.orgB.slug, `/api/v1/orgs/${run.orgB.slug}/settings`);
    const me = apiUrl(run.orgB.slug, `/api/v1/orgs/${run.orgB.slug}/me`);
    const start = await ok<{ defaultCurrency: string }>(await orgB.get(settings));
    expect(start).toEqual({ defaultCurrency: "INR" });
    try {
      expect(await ok(await orgB.patch(settings, { data: { defaultCurrency: "AED" } }))).toEqual({ defaultCurrency: "AED" });
      expect(await ok(await orgB.get(settings))).toEqual({ defaultCurrency: "AED" });
      expect((await ok<{ orgDefaultCurrency: string }>(await orgB.get(me))).orgDefaultCurrency).toBe("AED");

      // trimmed and upper-cased
      expect(await ok(await orgB.patch(settings, { data: { defaultCurrency: " usd " } }))).toEqual({ defaultCurrency: "USD" });

      // a rejected write changes nothing
      await rejected(await orgB.patch(settings, { data: { defaultCurrency: "EUR" } }), 400, CURRENCY_ERR);
      expect(await ok(await orgB.get(settings))).toEqual({ defaultCurrency: "USD" });
    } finally {
      const back = await orgB.patch(settings, { data: { defaultCurrency: "INR" } });
      expect(back.status(), await back.text()).toBe(200);
    }
    expect(await ok(await orgB.get(settings))).toEqual({ defaultCurrency: "INR" });
  });

  test("the Test Org's default currency is untouched by this file (read-only check as its admin)", async ({ as, url }) => {
    const r = await ok<{ defaultCurrency: string }>(await as.admin.get(url("/settings")));
    expect(["INR", "AED", "USD"]).toContain(r.defaultCurrency);
    expect(Object.keys(r)).toEqual(["defaultCurrency"]);
  });
});
