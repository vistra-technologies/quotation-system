/**
 * Quotation API (Stage 38 Batch 3, 38b): `GET|POST|PATCH .../projects/[projectId]/quotation` and
 * `POST .../quotation/refresh | reset-prices | renew`.
 *
 * Gates (route source): GET / create / refresh = QUOTE; reset-prices = QUOTE, plus APPLY_DISCOUNT once any line is
 * edited (Q-D33); PATCH (money inputs) = APPLY_DISCOUNT; renew = EXTEND_QUOTE (Admin only by default). All also pass
 * the project ownership filter (an external user sees only their company's projects; a foreign id is 404).
 * Default roles: admin = QUOTE + APPLY_DISCOUNT + EXTEND_QUOTE, member = QUOTE + APPLY_DISCOUNT, distributor = QUOTE,
 * architect = none (the matrix at the bottom derives every 403 from tests/regression/api/permissions.ts).
 *
 * Data: quotations hang off ledgered Test-Org projects and go with them (DRAFT project delete = S38-D7). Prices come
 * from Test-Org inventory: every test records the item price lists it changes and puts exactly those back in
 * `finally` (rule 10). The "edited line" state has no API yet (Batch 5): `rgrSetQuotationLineUnitPrice` writes it
 * directly, scoped to the Test Org / rgr- orgs.
 *
 * Not covered live (unit-tested in tests/unit/quotation.test.ts): a Refresh that adds a NEW unpriced code, drops a
 * removed code, or caps a stored fixed discount under a lowered subtotal. Their inputs need a design change that
 * is not worth a live wall.
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives, GHOST } from "./api-matrix";
import { foreignProjectId } from "./project-helpers";
import { body, priceItems, materialCodes, submittedWall, distributorWall, type PriceRow } from "./quotation-helpers";
import { countQuotations, rgrSetQuotationLineUnitPrice } from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation");
covers("PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew");

const DAY = 24 * 60 * 60 * 1000;

type Line = {
  code: string; name: string; slot: string | string[]; unit: string; quantity: number;
  defaultPrice: string; minPrice: string; allowAbove: boolean; unitPrice: string; amount: string;
};
type Totals = { linesTotal: string; subtotal: string; discountAmount: string; discountedAmount: string; taxAmount: string; grandTotal: string };
type Q = {
  id: string; projectId: string; quotationNumber: number; number: string; status: string; currency: string; projectCurrency: string;
  currencyDiffers: boolean; lines: Line[]; transport: string; otherCharges: string; discountType: string; discount: string;
  taxPercent: string; totals: Totals; anyLineEdited: boolean; designChanged: boolean; pricedAt: string; validUntil: string;
};

const quotation = async (r: APIResponse, status = 200) => (await body<{ quotation: Q }>(r, status)).quotation;

/** 2 dp string to integer cents (the strings are exact 2 dp). */
const cents = (s: string) => Math.round(Number(s) * 100);
const fixed = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
/** Half-up integer arithmetic mirroring lib/money.ts (exact for safe integers). */
const lineAmount = (quantity: number, unitCents: number) => Math.floor((Math.round(quantity * 1000) * unitCents + 500) / 1000);
const pct = (c: number, hundredths: number) => Math.floor((c * hundredths + 5000) / 10000);

const qUrl = (url: (p: string) => string, projectId: string, tail = "") => url(`/projects/${projectId}/quotation${tail}`);

test.describe("quotation: create and read (API AC3)", () => {
  test("create → 201 QT number, lines at the Inventory max, validUntil = +30 days; second create 409; GET equals it", async ({ as, f, url }) => {
    test.setTimeout(180_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { price, restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      const r = await as.member.post(qUrl(url, projectId));
      const raw = await r.text();
      expect(r.status(), raw).toBe(201);
      expect(raw).not.toContain("materialByRoom");
      const q = (JSON.parse(raw) as { quotation: Q }).quotation;
      expect(q.number).toMatch(/^QT-\d{4}-\d{4,}$/);
      expect(Number(q.number.split("-")[2])).toBe(q.quotationNumber);
      expect(q).toMatchObject({ projectId, status: "DRAFT", currency: "AED", projectCurrency: "AED", currencyDiffers: false, designChanged: false, anyLineEdited: false });
      expect(q.lines.map((l) => l.code)).toEqual(expect.arrayContaining(codes));
      expect(q.lines).toHaveLength(codes.length);
      for (const l of q.lines) {
        expect(l.unitPrice, l.code).toBe(price.get(l.code));
        expect(l.defaultPrice, l.code).toBe(price.get(l.code));
        expect(l.amount, l.code).toBe(fixed(lineAmount(l.quantity, cents(l.unitPrice))));
        expect(l.minPrice, l.code).toMatch(/^\d+\.\d{2}$/);
      }
      expect(q.lines.find((l) => l.code === codes[0])!.allowAbove).toBe(true);
      const sum = q.lines.reduce((s, l) => s + cents(l.amount), 0);
      expect(q.totals).toMatchObject({ linesTotal: fixed(sum), subtotal: fixed(sum), discountAmount: "0.00", taxAmount: "0.00", grandTotal: fixed(sum) });
      expect([q.transport, q.otherCharges, q.discount, q.taxPercent]).toEqual(["0.00", "0.00", "0.00", "0.00"]);
      expect(Date.parse(q.validUntil) - Date.parse(q.pricedAt)).toBe(30 * DAY);

      const dup = await as.member.post(qUrl(url, projectId));
      expect(await body(dup, 409)).toMatchObject({ code: "QUOTATION_EXISTS" });

      expect(await quotation(await as.member.get(qUrl(url, projectId)))).toEqual(q);
    } finally {
      await restore();
    }
  });

  test("no calculation → 422 \"Submit the design first\" (create and refresh), GET → 404 NO_QUOTATION", async ({ as, f, url }) => {
    const fresh = await f.project();
    expect(await body(await as.member.post(qUrl(url, fresh.id)), 422)).toEqual({ error: "Submit the design first", code: "NO_CALCULATION" });
    expect(await body(await as.member.get(qUrl(url, fresh.id)), 404)).toEqual({ error: "No quotation found for this project", code: "NO_QUOTATION" });
    expect(await body(await as.member.post(qUrl(url, fresh.id, "/refresh")), 404)).toMatchObject({ code: "NO_QUOTATION" });
    expect(await countQuotations(fresh.id)).toBe(0);
  });
});

test.describe("quotation: missing prices block (API AC4)", () => {
  test("create refused 422 with a MISSING_PRICE report, nothing written; Reset all prices and a currency-change Refresh likewise", async ({ as, f, url }) => {
    test.setTimeout(240_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const target = codes[codes.length - 1];
    const restores: Array<() => Promise<void>> = [];
    try {
      restores.push((await priceItems(as.admin, url, codes, "AED", [target])).restore);
      const r = await as.member.post(qUrl(url, projectId));
      const rep = await body<{ ok: boolean; problemCount: number; error: string; problems: { kind: string; scope: string; code: string; itemName: string; currency: string; message: string }[] }>(r, 422);
      expect(rep.ok).toBe(false);
      expect(rep.problems.map((p) => p.code)).toEqual([target]);
      expect(rep.problems[0]).toMatchObject({ kind: "MISSING_PRICE", scope: "INVENTORY", currency: "AED", itemName: expect.any(String) });
      expect(rep.problems[0].message).toContain(target);
      expect(rep.error).toBe(rep.problems[0].message);
      expect(await countQuotations(projectId)).toBe(0);

      // price it: create succeeds
      restores.push((await priceItems(as.admin, url, [target], "AED")).restore);
      const q0 = await quotation(await as.member.post(qUrl(url, projectId)), 201);

      // Reset all prices with the target unpriced again: 422, the stored quotation is untouched
      restores.push((await priceItems(as.admin, url, [target], "AED", [target])).restore);
      const reset = await body<{ problems: { code: string; kind: string }[] }>(await as.member.post(qUrl(url, projectId, "/reset-prices")), 422);
      expect(reset.problems.map((p) => [p.kind, p.code])).toEqual([["MISSING_PRICE", target]]);
      expect(await quotation(await as.member.get(qUrl(url, projectId)))).toEqual(q0);

      // currency change: no USD prices at all, so a Refresh lists every code and writes nothing
      const patch = await as.admin.patch(url(`/projects/${projectId}`), { data: { currency: "USD" } });
      expect(patch.status(), await patch.text()).toBe(200);
      restores.push((await priceItems(as.admin, url, codes, "USD", codes)).restore); // clears any USD price
      const ref = await body<{ problems: { code: string; currency: string }[] }>(await as.member.post(qUrl(url, projectId, "/refresh")), 422);
      expect(ref.problems.map((p) => p.code).sort()).toEqual([...codes].sort());
      expect(ref.problems.every((p) => p.currency === "USD")).toBe(true);
      const still = await quotation(await as.member.get(qUrl(url, projectId)));
      expect(still).toMatchObject({ currency: "AED", projectCurrency: "USD", currencyDiffers: true });
      expect(still.lines).toEqual(q0.lines);
    } finally {
      for (const restore of restores.reverse()) await restore();
    }
  });
});

test.describe("quotation: refresh (API AC5), reset prices and renew (API AC6)", () => {
  test("Refresh keeps prices and validUntil; GET reports design changed before it and not after", async ({ as, f, url }) => {
    test.setTimeout(180_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      const q0 = await quotation(await as.member.post(qUrl(url, projectId)), 201);
      expect(q0.designChanged).toBe(false);
      const rc = await as.admin.post(url(`/projects/${projectId}/recompute`));
      expect(rc.status(), await rc.text()).toBe(200);
      expect((await quotation(await as.member.get(qUrl(url, projectId)))).designChanged).toBe(true);

      const q1 = await quotation(await as.member.post(qUrl(url, projectId, "/refresh")));
      expect(q1.designChanged).toBe(false);
      expect(q1.validUntil).toBe(q0.validUntil);
      expect(Date.parse(q1.pricedAt)).toBeGreaterThan(Date.parse(q0.pricedAt));
      expect(q1.lines.map((l) => [l.code, l.unitPrice, l.defaultPrice])).toEqual(q0.lines.map((l) => [l.code, l.unitPrice, l.defaultPrice]));
      expect(q1.quotationNumber).toBe(q0.quotationNumber);
    } finally {
      await restore();
    }
  });

  test("Reset all prices re-reads Inventory and restarts validUntil; Renew adds 30 days and needs EXTEND_QUOTE", async ({ as, f, url }) => {
    test.setTimeout(180_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      const q0 = await quotation(await as.member.post(qUrl(url, projectId)), 201);
      // the Inventory price of the first code moves (priceItems restores the original list at the end)
      const inv = await body<{ items: { id: string; code: string; prices: PriceRow[] }[] }>(await as.admin.get(url("/inventory")), 200);
      const item = inv.items.find((i) => i.code === codes[0])!;
      const bumped = item.prices.map((p) => (p.currency === "AED" ? { ...p, price: "777.00", minPrice: "700.00" } : p));
      expect((await as.admin.put(url(`/inventory/${item.id}/prices`), { data: bumped })).status()).toBe(200);
      // an Inventory change never touches the stored quotation
      expect((await quotation(await as.member.get(qUrl(url, projectId)))).lines).toEqual(q0.lines);

      const q1 = await quotation(await as.member.post(qUrl(url, projectId, "/reset-prices")));
      const l0 = q1.lines.find((l) => l.code === codes[0])!;
      expect([l0.unitPrice, l0.defaultPrice, l0.minPrice]).toEqual(["777.00", "777.00", "700.00"]);
      expect(q1.lines.map((l) => l.quantity)).toEqual(q0.lines.map((l) => l.quantity));
      expect(Date.parse(q1.validUntil)).toBeGreaterThan(Date.parse(q0.validUntil));
      expect(Date.parse(q1.validUntil) - Date.parse(q1.pricedAt)).toBe(30 * DAY);

      expect((await as.member.post(qUrl(url, projectId, "/renew"))).status()).toBe(403);
      const q2 = await quotation(await as.admin.post(qUrl(url, projectId, "/renew")));
      expect(Date.parse(q2.validUntil) - Date.parse(q1.validUntil)).toBe(30 * DAY);
      expect(q2.lines).toEqual(q1.lines); // no repricing
    } finally {
      await restore();
    }
  });
});

test.describe("quotation: permissions and the edited-line gates (API AC7, AC7b, AC7d)", () => {
  test("distributor (QUOTE only) creates, refreshes and resets on its own project; PATCH and Renew 403; another company's project is 404", async ({ as, f, url, run, ledger }) => {
    test.setTimeout(240_000);
    const projectId = await distributorWall(f, as, url, run, ledger);
    const codes = await materialCodes(as.admin, url, projectId);
    const restores: Array<() => Promise<void>> = [];
    try {
      restores.push((await priceItems(as.admin, url, codes, "AED")).restore);
      const q0 = await quotation(await as.distributor.post(qUrl(url, projectId)), 201);
      expect((await as.distributor.get(qUrl(url, projectId))).status()).toBe(200);
      expect((await as.distributor.patch(qUrl(url, projectId), { data: { transport: "1.00" } })).status()).toBe(403);
      expect((await as.distributor.post(qUrl(url, projectId, "/renew"))).status()).toBe(403);
      expect((await as.architect.get(qUrl(url, projectId))).status()).toBe(403);

      // no edited line: Reset all prices is a QUOTE action
      expect((await quotation(await as.distributor.post(qUrl(url, projectId, "/reset-prices")))).anyLineEdited).toBe(false);

      // API AC7b: one edited line -> QUOTE alone is refused, APPLY_DISCOUNT holders may reset
      const edited = fixed(cents(q0.lines[0].minPrice)); // the first code is priced 100.00, min 80.00
      expect(edited).not.toBe(q0.lines[0].defaultPrice);
      await rgrSetQuotationLineUnitPrice(projectId, edited);
      expect((await quotation(await as.admin.get(qUrl(url, projectId)))).anyLineEdited).toBe(true);
      const denied = await as.distributor.post(qUrl(url, projectId, "/reset-prices"));
      expect(await body(denied, 403)).toEqual({ error: "Forbidden: missing permission APPLY_DISCOUNT" });
      expect((await quotation(await as.admin.get(qUrl(url, projectId)))).lines[0].unitPrice).toBe(edited); // nothing written

      // API AC7d: Refresh (QUOTE only, same currency) is 200 and keeps the edit
      const kept = await quotation(await as.distributor.post(qUrl(url, projectId, "/refresh")));
      expect(kept.lines[0].unitPrice).toBe(edited);
      expect(kept.anyLineEdited).toBe(true);

      const cleared = await quotation(await as.member.post(qUrl(url, projectId, "/reset-prices")));
      expect(cleared.anyLineEdited).toBe(false);
      expect(cleared.lines[0].unitPrice).toBe(cleared.lines[0].defaultPrice);

      // API AC7d, currency change: a fixed discount, an edit, then the project moves to USD
      expect((await quotation(await as.member.patch(qUrl(url, projectId), { data: { discountType: "FIXED", discount: "10.00" } }))).discount).toBe("10.00");
      await rgrSetQuotationLineUnitPrice(projectId, fixed(cents(q0.lines[0].minPrice)));
      const patch = await as.admin.patch(url(`/projects/${projectId}`), { data: { currency: "USD" } });
      expect(patch.status(), await patch.text()).toBe(200);
      const usd = await priceItems(as.admin, url, codes, "USD");
      restores.push(usd.restore);
      const changed = await quotation(await as.distributor.post(qUrl(url, projectId, "/refresh")));
      expect(changed).toMatchObject({ currency: "USD", projectCurrency: "USD", currencyDiffers: false, anyLineEdited: false, discountType: "FIXED", discount: "0.00" });
      for (const l of changed.lines) expect(l.unitPrice, l.code).toBe(usd.price.get(l.code));
    } finally {
      for (const restore of restores.reverse()) await restore();
    }

    // ownership: the company-less project of another test is invisible to the distributor
    const other = await f.project();
    expect(await body(await as.distributor.get(qUrl(url, other.id)), 404)).toEqual({ error: "Project not found" });
    expect((await as.distributor.post(qUrl(url, other.id))).status()).toBe(404);
  });
});

test.describe("quotation: money inputs (API AC7c)", () => {
  test("PATCH recomputes the totals chain server-side; a typed fixed discount above the subtotal is 400, equal is 200", async ({ as, f, url }) => {
    test.setTimeout(180_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      const q0 = await quotation(await as.member.post(qUrl(url, projectId)), 201);
      const lines = q0.lines.reduce((s, l) => s + cents(l.amount), 0);

      const q1 = await quotation(
        await as.member.patch(qUrl(url, projectId), { data: { transport: "10.00", otherCharges: 5.5, discountType: "PERCENT", discount: "10", taxPercent: "18" } }),
      );
      const subtotal = lines + 1000 + 550;
      const discount = pct(subtotal, 1000);
      const tax = pct(subtotal - discount, 1800);
      expect([q1.transport, q1.otherCharges, q1.discountType, q1.discount, q1.taxPercent]).toEqual(["10.00", "5.50", "PERCENT", "10.00", "18.00"]);
      expect(q1.totals).toEqual({
        linesTotal: fixed(lines), subtotal: fixed(subtotal), discountAmount: fixed(discount),
        discountedAmount: fixed(subtotal - discount), taxAmount: fixed(tax), grandTotal: fixed(subtotal - discount + tax),
      });

      // a typed fixed discount above the subtotal: 400 naming the subtotal, nothing written
      const over = await as.member.patch(qUrl(url, projectId), { data: { discountType: "FIXED", discount: fixed(subtotal + 1) } });
      expect(await body(over, 400)).toEqual({ error: `The discount cannot exceed the subtotal (${fixed(subtotal)})` });
      const after = await quotation(await as.member.get(qUrl(url, projectId)));
      expect([after.discountType, after.discount]).toEqual(["PERCENT", "10.00"]);
      // a percentage above 100 likewise
      expect((await as.member.patch(qUrl(url, projectId), { data: { discountType: "PERCENT", discount: "100.01" } })).status()).toBe(400);

      // equal to the subtotal fits; tax on the zero remainder is zero
      const eq = await quotation(await as.member.patch(qUrl(url, projectId), { data: { discountType: "FIXED", discount: fixed(subtotal) } }));
      expect(eq.totals).toMatchObject({ subtotal: fixed(subtotal), discountAmount: fixed(subtotal), discountedAmount: "0.00", taxAmount: "0.00", grandTotal: "0.00" });
    } finally {
      await restore();
    }
  });
});

test.describe("quotation: deleted with its project (API AC9)", () => {
  test("DELETE project removes its quotation", async ({ as, f, url }) => {
    test.setTimeout(180_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      await quotation(await as.member.post(qUrl(url, projectId)), 201);
      expect(await countQuotations(projectId)).toBe(1);
      const del = await as.admin.delete(url(`/projects/${projectId}`));
      expect(del.status(), await del.text()).toBe(200);
      expect(await countQuotations(projectId)).toBe(0);
    } finally {
      await restore();
    }
  });
});

// ─── negative matrix: 401, every 403 derived from the permission table, cross-tenant, 404s, 400s ─────────

const QPATH = (id: string, tail = "") => `/projects/${id}/quotation${tail}`;
const foreignQ = (tail = "") => async (c: Parameters<typeof foreignProjectId>[0]) => QPATH(await foreignProjectId(c), tail);
const noJson = { malformedJson: false } as const;

registerNegatives([
  {
    key: "GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation", method: "GET", permission: "QUOTE",
    path: () => QPATH(GHOST), unknownId: () => QPATH(GHOST), foreignId: foreignQ(),
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation", method: "POST", permission: "QUOTE", ...noJson,
    path: () => QPATH(GHOST), unknownId: () => QPATH(GHOST), foreignId: foreignQ(),
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation", method: "PATCH", permission: "APPLY_DISCOUNT",
    path: () => QPATH(GHOST), body: () => ({ transport: "1.00" }), unknownId: () => QPATH(GHOST), foreignId: foreignQ(),
    invalid: [
      { name: "{} (nothing to update)", body: {}, status: 400 },
      { name: "an array body", body: [], status: 400 },
      { name: "unknown field", body: { foo: 1 }, status: 400 },
      { name: "negative transport", body: { transport: -1 }, status: 400 },
      { name: "3 dp otherCharges", body: { otherCharges: "1.005" }, status: 400 },
      { name: "taxPercent above 100", body: { taxPercent: 100.01 }, status: 400 },
      { name: "discountType AMOUNT", body: { discountType: "AMOUNT" }, status: 400 },
      { name: "non-numeric discount", body: { discount: "x" }, status: 400 },
    ],
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh", method: "POST", permission: "QUOTE", ...noJson,
    path: () => QPATH(GHOST, "/refresh"), unknownId: () => QPATH(GHOST, "/refresh"), foreignId: foreignQ("/refresh"),
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices", method: "POST", permission: "QUOTE", ...noJson,
    path: () => QPATH(GHOST, "/reset-prices"), unknownId: () => QPATH(GHOST, "/reset-prices"), foreignId: foreignQ("/reset-prices"),
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew", method: "POST", permission: "EXTEND_QUOTE", ...noJson,
    path: () => QPATH(GHOST, "/renew"), unknownId: () => QPATH(GHOST, "/renew"), foreignId: foreignQ("/renew"),
  },
]);

