/**
 * Orders: the inert placeholder (no Order model exists yet — the BOQ/Quotation/Order pipeline is a future
 * stage). The route authenticates and resolves the org, then always answers
 * `{ orders: [], total: 0, page, pageSize: 20 }`.
 *
 * The EXACT body is asserted on purpose: a real implementation must fail these tests and force them to be
 * rewritten against the real contract.
 *
 * Gate: any authenticated org member (no permission).
 */
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives } from "./api-matrix";
import { orgApi } from "./project-helpers";
import { ROLES } from "./permissions";

covers("GET /api/v1/orgs/[orgSlug]/orders");

registerNegatives([{ key: "GET /api/v1/orgs/[orgSlug]/orders", method: "GET", path: () => "/orders" }]);

test.describe("orders: inert placeholder contract", () => {
  test("every role gets exactly { orders: [], total: 0, page: 1, pageSize: 20 }", async ({ as, url }) => {
    for (const role of ROLES) {
      const r = await as[role].get(url("/orders"));
      expect(r.status(), `${role}: ${await r.text()}`).toBe(200);
      expect(await r.json(), role).toEqual({ orders: [], total: 0, page: 1, pageSize: 20 });
    }
  });

  test("`page` is echoed when it is a positive integer, otherwise 1; pageSize stays 20 and nothing else is read", async ({ as, url }) => {
    const cases: [string, number][] = [
      ["?page=3", 3],
      ["?page=1", 1],
      ["?page=0", 1],
      ["?page=-5", 1],
      ["?page=abc", 1],
      ["?page=2.9", 2], // parseInt
      ["?page=7&pageSize=100&search=x&status=OPEN", 7],
    ];
    for (const [qs, page] of cases) {
      const r = await as.member.get(url(`/orders${qs}`));
      expect(r.status(), qs).toBe(200);
      expect(await r.json(), qs).toEqual({ orders: [], total: 0, page, pageSize: 20 });
    }
  });

  test("org B's admin gets the same empty placeholder through its own slug", async ({ orgB, run }) => {
    const r = await orgB.get(orgApi(run.orgB.slug, "/orders"));
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toEqual({ orders: [], total: 0, page: 1, pageSize: 20 });
  });
});
