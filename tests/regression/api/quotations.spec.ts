/**
 * Quotation API (Stage 38 Batches 3 and 5, 38b/38c): `GET|POST|PATCH .../projects/[projectId]/quotation`,
 * `POST .../quotation/refresh | reset-prices | renew` and `PATCH .../quotation/lines` (one line's unit price).
 *
 * Gates (route source): GET / create / refresh = QUOTE; reset-prices = QUOTE, plus APPLY_DISCOUNT once any line is
 * edited (Q-D33); PATCH (money inputs) and PATCH lines (line price edit, internal users only) = APPLY_DISCOUNT; renew =
 * EXTEND_QUOTE (Admin only by default). All also pass
 * the project ownership filter (an external user sees only their company's projects; a foreign id is 404).
 * Default roles: admin = QUOTE + APPLY_DISCOUNT + EXTEND_QUOTE, member = QUOTE + APPLY_DISCOUNT, distributor = QUOTE,
 * architect = none (the matrix at the bottom derives every 403 from tests/regression/api/permissions.ts).
 *
 * Data: quotations hang off ledgered Test-Org projects and go with them (DRAFT project delete = S38-D7). Prices come
 * from Test-Org inventory: every test records the item price lists it changes and puts exactly those back in
 * `finally` (rule 10). An "edited line" is made through PATCH .../quotation/lines (Batch 5).
 *
 * ONE-WORKER RULE: every test that writes Test Org item prices lives in THIS file (the quotation tests, the projects
 * "AC3 missingPrices" test and the Summary-notice page test, both moved here), because a file runs on one worker, in
 * order. No other spec may write Test Org item prices: a second writer interleaves record/restore and leaves
 * prices changed or makes a quotation create see a price another test just cleared.
 *
 * Not covered live (unit-tested in tests/unit/quotation.test.ts): a Refresh that adds a NEW unpriced code, drops a
 * removed code, or caps a stored fixed discount under a lowered subtotal. Their inputs need a design change that
 * is not worth a live wall.
 */
import fs from "node:fs";
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives, GHOST } from "./api-matrix";
import { foreignProjectId } from "./project-helpers";
import { openAs, orgTarget, settledProblems } from "../pages/page-helpers";
import { isHydrated } from "../pages/collect";
import { pillState } from "../journeys/journey-helpers";
import { ok } from "./design-helpers";
import { body, priceItems, materialCodes, submittedWall, distributorWall, type PriceRow } from "./quotation-helpers";
import { countQuotations } from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation");
covers("PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/refresh");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/reset-prices");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew");
covers("PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/lines");

const DAY = 24 * 60 * 60 * 1000;

type Line = {
  code: string; name: string; slot: string | string[]; unit: string; perUnitQuantity: number; quantity: number;
  defaultPrice?: string; minPrice?: string; allowAbove?: boolean; unitPrice: string; amount: string;
};
type Totals = { linesTotal: string; subtotal: string; discountAmount: string; discountedAmount: string; taxAmount: string; grandTotal: string };
type Q = {
  id: string; projectId: string; quotationNumber: number; number: string; status: string; currency: string; projectCurrency: string;
  currencyDiffers: boolean; lines: Line[]; transport: string; otherCharges: string; discountType: string; discount: string;
  taxPercent: string; totals: Totals; anyLineEdited: boolean; designChanged: boolean; createdByName: string | null; pricedAt: string; quantitiesAt: string; validUntil: string;
};

const quotation = async (r: APIResponse, status = 200) => (await body<{ quotation: Q }>(r, status)).quotation;

/** 2 dp string to integer cents (the strings are exact 2 dp). */
const cents = (s: string) => Math.round(Number(s) * 100);
const fixed = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
/** Half-up integer arithmetic mirroring lib/money.ts (exact for safe integers). */
const lineAmount = (quantity: number, unitCents: number) => Math.floor((Math.round(quantity * 1000) * unitCents + 500) / 1000);
const pct = (c: number, hundredths: number) => Math.floor((c * hundredths + 5000) / 10000);

const qUrl = (url: (p: string) => string, projectId: string, tail = "") => url(`/projects/${projectId}/quotation${tail}`);

// The page test below carries session cookies: no traces (same as pages.spec.ts).
test.use({ trace: "off" });

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
      // M-1: "Prepared by" is the quoting user's full name (User.name, else the username), not the project creator's username
      const me = await body<{ name: string; username: string }>(await as.member.get(url("/me")), 200);
      expect(q.createdByName).toBe(me.name.trim() !== "" ? me.name : me.username);
      expect(Number(q.number.split("-")[2])).toBe(q.quotationNumber);
      expect(q).toMatchObject({ projectId, status: "DRAFT", currency: "AED", projectCurrency: "AED", currencyDiffers: false, designChanged: false, anyLineEdited: false });
      expect(q.lines.map((l) => l.code)).toEqual(expect.arrayContaining(codes));
      expect(q.lines).toHaveLength(codes.length);
      const calc = await body<{ materialList: { code: string; perUnitQuantity: number }[] }>(await as.admin.get(url(`/projects/${projectId}/calculation`)), 200);
      for (const l of q.lines) {
        expect(l.perUnitQuantity, `${l.code} pack size`).toBe(calc.materialList.find((x) => x.code === l.code)!.perUnitQuantity);
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

      // Q-D36: Reset all prices re-prices the STORED quantities, so it must not clear the banner (quantitiesAt untouched)
      const reset = await quotation(await as.member.post(qUrl(url, projectId, "/reset-prices")));
      expect(reset.designChanged).toBe(true);
      expect(reset.quantitiesAt).toBe(q0.quantitiesAt);
      expect(Date.parse(reset.pricedAt)).toBeGreaterThan(Date.parse(q0.pricedAt));
      const renewed = await quotation(await as.admin.post(qUrl(url, projectId, "/renew")));
      expect(renewed.designChanged).toBe(true);
      const patched = await quotation(await as.member.patch(qUrl(url, projectId), { data: { taxPercent: "5" } }));
      expect(patched.designChanged).toBe(true);
      expect(patched.quantitiesAt).toBe(q0.quantitiesAt);

      const q1 = await quotation(await as.member.post(qUrl(url, projectId, "/refresh")));
      expect(q1.designChanged).toBe(false);
      expect(Date.parse(q1.quantitiesAt)).toBeGreaterThan(Date.parse(q0.quantitiesAt));
      expect(q1.validUntil).toBe(patched.validUntil); // Refresh never touches validUntil
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
      // Q-D34: an external user never receives the price floor (minPrice / allowAbove / defaultPrice), on create or GET
      const noRange = ["amount", "code", "name", "perUnitQuantity", "quantity", "slot", "unit", "unitPrice"];
      for (const l of q0.lines) expect(Object.keys(l).sort(), l.code).toEqual(noRange);
      const dGet = await as.distributor.get(qUrl(url, projectId));
      expect(dGet.status()).toBe(200);
      for (const l of (await quotation(dGet)).lines) expect(Object.keys(l).sort(), l.code).toEqual(noRange);
      // staff do get it
      const staff0 = await quotation(await as.admin.get(qUrl(url, projectId)));
      for (const l of staff0.lines) expect([l.defaultPrice, l.minPrice], l.code).toEqual([expect.stringMatching(/^\d+\.\d{2}$/), expect.stringMatching(/^\d+\.\d{2}$/)]);
      expect((await as.distributor.patch(qUrl(url, projectId), { data: { transport: "1.00" } })).status()).toBe(403);
      expect((await as.distributor.post(qUrl(url, projectId, "/renew"))).status()).toBe(403);
      // 38c: line price edits are internal-staff only (APPLY_DISCOUNT); the distributor is refused before anything is read
      expect((await as.distributor.patch(qUrl(url, projectId, "/lines"), { data: { code: staff0.lines[0].code, reset: true } })).status()).toBe(403);
      expect((await as.architect.get(qUrl(url, projectId))).status()).toBe(403);

      // no edited line: Reset all prices is a QUOTE action
      expect((await quotation(await as.distributor.post(qUrl(url, projectId, "/reset-prices")))).anyLineEdited).toBe(false);

      // API AC7b: one edited line -> QUOTE alone is refused, APPLY_DISCOUNT holders may reset
      const edited = fixed(cents(staff0.lines[0].minPrice!)); // the first code is priced 100.00, min 80.00
      expect(edited).not.toBe(staff0.lines[0].defaultPrice);
      const code0 = staff0.lines[0].code;
      expect((await quotation(await as.admin.patch(qUrl(url, projectId, "/lines"), { data: { code: code0, unitPrice: edited } }))).anyLineEdited).toBe(true);
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
      expect(cleared.lines[0].unitPrice).toBe(cleared.lines[0].defaultPrice); // (member = staff, sees the range)

      // API AC7d, currency change: a fixed discount, an edit, then the project moves to USD
      expect((await quotation(await as.member.patch(qUrl(url, projectId), { data: { discountType: "FIXED", discount: "10.00" } }))).discount).toBe("10.00");
      expect((await quotation(await as.admin.patch(qUrl(url, projectId, "/lines"), { data: { code: code0, unitPrice: fixed(cents(staff0.lines[0].minPrice!)) } }))).anyLineEdited).toBe(true);
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

test.describe("quotation: line price edits (38c, API AC2, AC3)", () => {
  test("PATCH lines sets one line within its stored range, recomputes amount and totals, 400 names the range, 404 unknown code, reset restores the stored default", async ({ as, f, url }) => {
    test.setTimeout(240_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    expect(codes.length).toBeGreaterThanOrEqual(2);
    const restores: Array<() => Promise<void>> = [];
    try {
      restores.push((await priceItems(as.admin, url, codes, "AED")).restore);
      const q0 = await quotation(await as.member.post(qUrl(url, projectId)), 201);
      const [free, capped] = [q0.lines.find((l) => l.code === codes[0])!, q0.lines.find((l) => l.code === codes[1])!];
      // priceItems: codes[0] = 100.00 / min 80.00 with no upper limit; codes[1] = 110.00 / min 90.00 capped at the max
      expect([free.allowAbove, capped.allowAbove]).toEqual([true, false]);
      const lines = qUrl(url, projectId, "/lines");

      // a valid edit: price, amount and totals follow; pricing/quantity timestamps and validUntil do not move
      const edit = await quotation(await as.member.patch(lines, { data: { code: capped.code, unitPrice: "95.50" } }));
      const l1 = edit.lines.find((l) => l.code === capped.code)!;
      expect([l1.unitPrice, l1.defaultPrice, l1.minPrice]).toEqual(["95.50", capped.defaultPrice, capped.minPrice]);
      expect(l1.amount).toBe(fixed(lineAmount(l1.quantity, 9550)));
      expect(edit.anyLineEdited).toBe(true);
      const sum = edit.lines.reduce((s, l) => s + cents(l.amount), 0);
      expect(edit.totals).toMatchObject({ linesTotal: fixed(sum), grandTotal: fixed(sum) });
      expect([edit.pricedAt, edit.quantitiesAt, edit.validUntil]).toEqual([q0.pricedAt, q0.quantitiesAt, q0.validUntil]);
      expect(edit.lines.find((l) => l.code === free.code)).toEqual(free); // the other lines are untouched
      expect((await quotation(await as.member.get(qUrl(url, projectId)))).lines.find((l) => l.code === capped.code)!.unitPrice).toBe("95.50");

      // bounds are inclusive, the message names the range, nothing is written on a refusal
      for (const price of ["90.00", "110.00"]) {
        expect((await quotation(await as.member.patch(lines, { data: { code: capped.code, unitPrice: price } }))).lines.find((l) => l.code === capped.code)!.unitPrice).toBe(price);
      }
      for (const price of ["89.99", "110.01"]) {
        expect(await body(await as.member.patch(lines, { data: { code: capped.code, unitPrice: price } }), 400)).toEqual({ error: "Enter a price from 90 to 110." });
      }
      expect(await body(await as.member.patch(lines, { data: { code: free.code, unitPrice: "79.99" } }), 400)).toEqual({ error: "Enter a price of 80 or more." });
      expect((await quotation(await as.member.patch(lines, { data: { code: free.code, unitPrice: "4200.00" } }))).lines.find((l) => l.code === free.code)!.unitPrice).toBe("4200.00");
      expect((await quotation(await as.member.get(qUrl(url, projectId)))).lines.find((l) => l.code === capped.code)!.unitPrice).toBe("110.00");

      // unknown code is 404 NO_LINE; both bodies are refused when malformed
      expect(await body(await as.member.patch(lines, { data: { code: "NOPE-0", unitPrice: "1.00" } }), 404)).toMatchObject({ code: "NO_LINE" });
      expect(await body(await as.member.patch(lines, { data: { code: "NOPE-0", reset: true } }), 404)).toMatchObject({ code: "NO_LINE" });

      // reset one line: back to its stored default, the other edit stays
      const reset = await quotation(await as.member.patch(lines, { data: { code: free.code, reset: true } }));
      expect(reset.lines.find((l) => l.code === free.code)).toEqual(free);
      expect(reset.lines.find((l) => l.code === capped.code)!.unitPrice).toBe("110.00");
      expect(reset.anyLineEdited).toBe(false); // 110.00 equals the stored default again
    } finally {
      for (const restore of restores.reverse()) await restore();
    }
  });

  test("API AC3: a later Inventory price or minimum change does not touch an edited line; Refresh keeps it; the range check keeps using the stored copy; Reset all prices discards it", async ({ as, f, url }) => {
    test.setTimeout(240_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const restores: Array<() => Promise<void>> = [];
    try {
      restores.push((await priceItems(as.admin, url, codes, "AED")).restore);
      const q0 = await quotation(await as.member.post(qUrl(url, projectId)), 201);
      const target = q0.lines.find((l) => l.code === codes[1])!; // 110.00, min 90.00, capped
      const lines = qUrl(url, projectId, "/lines");
      expect((await quotation(await as.member.patch(lines, { data: { code: target.code, unitPrice: "95.00" } }))).anyLineEdited).toBe(true);

      // the live Inventory now says 500.00 / min 400.00 for the same item
      const inv = await body<{ items: { id: string; code: string; prices: PriceRow[] }[] }>(await as.admin.get(url("/inventory")), 200);
      const item = inv.items.find((x) => x.code === target.code)!;
      const prior = item.prices.map(({ currency, price, minPrice, allowAbove }) => ({ currency, price, minPrice, allowAbove }));
      restores.push(async () => {
        const r = await as.admin.put(url(`/inventory/${item.id}/prices`), { data: prior });
        expect(r.status(), await r.text()).toBe(200);
      });
      const live = [...prior.filter((p) => p.currency !== "AED"), { currency: "AED", price: "500.00", minPrice: "400.00", allowAbove: false }];
      const put = await as.admin.put(url(`/inventory/${item.id}/prices`), { data: live });
      expect(put.status(), await put.text()).toBe(200);

      const after = await quotation(await as.member.get(qUrl(url, projectId)));
      const kept = after.lines.find((l) => l.code === target.code)!;
      expect([kept.unitPrice, kept.defaultPrice, kept.minPrice]).toEqual(["95.00", "110.00", "90.00"]);
      // Refresh in the same currency keeps the edit and the stored range
      const refreshed = (await quotation(await as.member.post(qUrl(url, projectId, "/refresh")))).lines.find((l) => l.code === target.code)!;
      expect([refreshed.unitPrice, refreshed.defaultPrice, refreshed.minPrice]).toEqual(["95.00", "110.00", "90.00"]);
      // the check uses the stored copy: 96 is inside 90 to 110 although the live minimum is 400; 450 is above the stored cap
      expect((await quotation(await as.member.patch(lines, { data: { code: target.code, unitPrice: "96.00" } }))).lines.find((l) => l.code === target.code)!.unitPrice).toBe("96.00");
      expect(await body(await as.member.patch(lines, { data: { code: target.code, unitPrice: "450.00" } }), 400)).toEqual({ error: "Enter a price from 90 to 110." });
      // per-line Reset goes to the STORED default (110.00), not the live 500.00
      expect((await quotation(await as.member.patch(lines, { data: { code: target.code, reset: true } }))).lines.find((l) => l.code === target.code)!.unitPrice).toBe("110.00");
      // Reset all prices re-reads Inventory and discards edits: now the live 500.00 / 400.00
      await quotation(await as.member.patch(lines, { data: { code: target.code, unitPrice: "100.00" } }));
      const all = (await quotation(await as.admin.post(qUrl(url, projectId, "/reset-prices")))).lines.find((l) => l.code === target.code)!;
      expect([all.unitPrice, all.defaultPrice, all.minPrice]).toEqual(["500.00", "500.00", "400.00"]);
    } finally {
      for (const restore of restores.reverse()) await restore();
    }
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

// ─── moved here (Test Org price writers, one worker) ────────────────────────────────────────────────────────

test.describe("Test Org price writers kept in this file", () => {
  // Was projects.spec.ts "AC3": the calculation GET lists material-list items with no price in the project currency.
  test("projects AC3: missingPrices lists unpriced list items; pricing one in the project currency removes it (prices restored)", async ({ as, f, url }) => {
    test.setTimeout(180_000);
    const projectId = await submittedWall(f, as, url);
    type Calc = { materialList: { code: string }[]; missingPrices: { currency: string; items: { code: string; name: string }[] } };
    const readCalc = async () => await body<Calc>(await as.member.get(url(`/projects/${projectId}/calculation`)), 200);
    const before = await readCalc();
    const { currency } = before.missingPrices;
    const target = before.missingPrices.items[0]?.code ?? before.materialList[0].code;
    const inv = await body<{ items: { id: string; code: string; prices: PriceRow[] }[] }>(await as.admin.get(url("/inventory")), 200);
    const item = inv.items.find((i) => i.code === target);
    expect(item, `inventory item ${target}`).toBeTruthy();
    // Rule 10: record the item's own price list first and put exactly that back, even when an assertion fails.
    const prior = item!.prices.map((x) => ({ currency: x.currency, price: x.price, minPrice: x.minPrice, allowAbove: x.allowAbove }));
    try {
      const others = prior.filter((x) => x.currency !== currency);
      // Unpriced first (positive half): the target must be listed whatever the Test Org already had priced.
      const clear = await as.admin.put(url(`/inventory/${item!.id}/prices`), { data: others });
      expect(clear.status(), await clear.text()).toBe(200);
      const unpriced = await readCalc();
      expect(unpriced.missingPrices.currency).toBe(currency);
      expect(unpriced.missingPrices.items.map((i) => i.code)).toContain(target);
      expect(unpriced.missingPrices.items.find((i) => i.code === target)!.name).toEqual(expect.any(String));
      // Then priced: it disappears and nothing else changes.
      const put = await as.admin.put(url(`/inventory/${item!.id}/prices`), { data: [...others, { currency, price: "10.00", minPrice: "8.00", allowAbove: false }] });
      expect(put.status(), await put.text()).toBe(200);
      const after = await readCalc();
      expect(after.missingPrices.currency).toBe(currency);
      expect(after.missingPrices.items.map((i) => i.code)).not.toContain(target);
      expect(after.missingPrices.items.length).toBe(unpriced.missingPrices.items.length - 1);
    } finally {
      const back = await as.admin.put(url(`/inventory/${item!.id}/prices`), { data: prior });
      expect(back.status(), await back.text()).toBe(200);
    }
    // restored: the target is listed again exactly when it was before this test touched it
    expect((await readCalc()).missingPrices.items.map((i) => i.code).includes(target)).toBe(before.missingPrices.items.some((i) => i.code === target));
    // and the restore is exact
    const finalInv = await body<{ items: { id: string; prices: PriceRow[] }[] }>(await as.admin.get(url("/inventory")), 200);
    expect(finalInv.items.find((i) => i.id === item!.id)!.prices.map((x) => ({ currency: x.currency, price: x.price, minPrice: x.minPrice, allowAbove: x.allowAbove }))).toEqual(prior);
  });

  // Stage 38 B2 review N3: the notice's "Open Inventory" link needs MANAGE_PRICING: a distributor sees the notice without it.
  test("UI AC3b: Summary missing-price notice, a distributor sees it but no 'Open Inventory' link; an admin sees the link", async ({ browser, run, f, as, url, ledger }) => {
    test.setTimeout(240_000);
    const projectId = await distributorWall(f, as, url, run, ledger);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, [codes[0]], "AED", [codes[0]]); // AED = the project currency
    try {
      const calc = await ok<{ missingPrices: { currency: string; items: { code: string }[] } }>(await as.admin.get(url(`/projects/${projectId}/calculation`)));
      expect(calc.missingPrices.items.map((i) => i.code)).toContain(codes[0]);
      const n = calc.missingPrices.items.length;
      const text = `${n === 1 ? "1 item has" : `${n} items have`} no AED price; a quotation can't be made yet.`;
      for (const who of ["distributor", "admin"] as const) {
        const o = await openAs(browser, run, who);
        try {
          await o.page.goto(orgTarget(run, `/projects/${projectId}/summary`));
          const notice = o.page.getByTestId("missing-prices-notice").filter({ visible: true });
          await expect(notice).toContainText(text);
          const link = notice.getByRole("link", { name: "Open Inventory" });
          if (who === "distributor") await expect(link).toHaveCount(0);
          else await expect(link).toHaveAttribute("href", /\/admin\/inventory$/);
        } finally {
          await o.ctx.close();
        }
      }
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
    key: "PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/lines", method: "PATCH", permission: "APPLY_DISCOUNT",
    path: () => QPATH(GHOST, "/lines"), body: () => ({ code: "X", reset: true }), unknownId: () => QPATH(GHOST, "/lines"), foreignId: foreignQ("/lines"),
    invalid: [
      { name: "{} (no code)", body: {}, status: 400 },
      { name: "an array body", body: [], status: 400 },
      { name: "code without unitPrice or reset", body: { code: "X" }, status: 400 },
      { name: "unitPrice and reset together", body: { code: "X", unitPrice: "1.00", reset: true }, status: 400 },
      { name: "reset false", body: { code: "X", reset: false }, status: 400 },
      { name: "negative unitPrice", body: { code: "X", unitPrice: -1 }, status: 400 },
      { name: "3 dp unitPrice", body: { code: "X", unitPrice: "1.005" }, status: 400 },
      { name: "unknown field", body: { code: "X", unitPrice: "1.00", foo: 1 }, status: 400 },
    ],
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/projects/[projectId]/quotation/renew", method: "POST", permission: "EXTEND_QUOTE", ...noJson,
    path: () => QPATH(GHOST, "/renew"), unknownId: () => QPATH(GHOST, "/renew"), foreignId: foreignQ("/renew"),
  },
]);

// ─── Quotation page (Stage 38 Batch 4, UI AC1 to AC5, mockup B rev 3) ────────────────────────────────────
// These live in THIS file because they write Test Org item prices (ONE-WORKER RULE above). Every price change is
// put back by `restore` in `finally`.

/** "1234.5" to "1,234.50": how the page prints a 2 dp amount (test values are small, float-safe). */
const fmt = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

test.describe("quotation page (UI)", () => {
  test("UI AC1, AC1c, AC2, AC3: admin creates it, sections by slot with no range text, totals change after Save only, discount cap, read-only first", async ({ browser, run, f, as, url }) => {
    test.setTimeout(360_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      const o = await openAs(browser, run, "admin");
      try {
        const page = o.page;
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        // AC1: no quotation and a submitted design: Create is enabled; step 5 is open.
        const create = page.getByRole("button", { name: "Create quotation" });
        await expect(create).toBeEnabled();
        await expect.poll(() => isHydrated(create)).toBe(true);
        expect((await pillState(o)).Quotation).toBe("open");
        const [created] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "POST" && /\/quotation$/.test(r.url())),
          create.click(),
        ]);
        expect(created.status(), await created.text()).toBe(201);
        const q = (JSON.parse(await created.text()) as { quotation: Q }).quotation;
        await expect(page.getByTestId("quotation-number")).toHaveText(q.number);
        await expect(page.getByTestId("quotation-status")).toHaveText("Draft");

        // AC2: one row per stored line, sections grouped by slot (data-driven), no range text on any row (Q-D34).
        const rows = page.getByTestId("quotation-line");
        await expect(rows).toHaveCount(q.lines.length);
        const slots = [...new Set(q.lines.map((l) => (Array.isArray(l.slot) ? "shared" : l.slot)))].sort();
        const shown = await page.getByTestId("quotation-section").evaluateAll((els) => els.map((e) => e.getAttribute("data-slot") ?? ""));
        expect([...shown].sort()).toEqual(slots);
        const ledger = (await page.getByTestId("quotation-section").allInnerTexts()).join("\n");
        expect(ledger).not.toMatch(/No upper limit|and up|Range/);
        for (const l of q.lines) {
          const row = page.locator(`[data-testid="quotation-line"][data-code="${l.code}"]`);
          await expect(row).toContainText(fmt(l.unitPrice));
          await expect(row).toContainText(`AED/`);
          await expect(row).toContainText(fmt(l.amount));
        }
        // KPI tiles, Grand total on top and in the totals panel, from one response.
        const tile = page.getByTestId("quotation-grand-total-tile");
        await expect(tile).toContainText(fmt(q.totals.grandTotal));
        await expect(page.getByTestId("totals-grand")).toHaveText(fmt(q.totals.grandTotal));

        // AC3 + AC1c: read-only first; Edit opens the fields; nothing changes while typing, only after Save.
        const totals = page.getByTestId("quotation-totals");
        await expect(totals.getByLabel("Transport")).toHaveCount(0);
        await totals.getByRole("button", { name: "Edit", exact: true }).click();
        await totals.getByLabel("Transport").fill("1,000.00");
        await expect(tile).toContainText(fmt(q.totals.grandTotal)); // typing changed nothing
        const [patched] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "PATCH" && /\/quotation$/.test(r.url())),
          totals.getByRole("button", { name: "Save", exact: true }).click(),
        ]);
        expect(patched.status(), await patched.text()).toBe(200);
        const q2 = (JSON.parse(await patched.text()) as { quotation: Q }).quotation;
        expect(q2.transport).toBe("1000.00");
        expect(q2.totals.grandTotal).not.toBe(q.totals.grandTotal);
        await expect(tile).toContainText(fmt(q2.totals.grandTotal));
        await expect(page.getByTestId("totals-subtotal")).toHaveText(fmt(q2.totals.subtotal));
        await expect(page.getByTestId("totals-grand")).toHaveText(fmt(q2.totals.grandTotal));
        await expect(totals.getByLabel("Transport")).toHaveCount(0); // back to read-only

        // Q-D33: a typed fixed discount above the subtotal is refused in the form, Save disabled, nothing sent.
        await totals.getByRole("button", { name: "Edit", exact: true }).click();
        await totals.getByRole("group", { name: "Discount type" }).getByRole("button", { name: "AED" }).click();
        await totals.getByLabel("Discount", { exact: true }).fill("99,999,999.00");
        await expect(page.getByTestId("discount-cap-error")).toContainText(`Enter at most ${fmt(q2.totals.subtotal)} (the subtotal).`);
        await expect(totals.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
        await totals.getByRole("button", { name: "Cancel", exact: true }).click();
        expect((await quotation(await as.admin.get(qUrl(url, projectId)))).discount).toBe("0.00");

        expect(await settledProblems(o)).toEqual([]);
      } finally {
        await o.ctx.close();
      }
    } finally {
      await restore();
    }
  });

  test("UI AC4 (38c), M-1: row popover edit shows the range only there, the Edited tag and per-line Reset, a distributor sees none of it, Prepared by is the quoting user's name", async ({ browser, run, f, as, url, ledger }) => {
    test.setTimeout(480_000);
    const projectId = await distributorWall(f, as, url, run, ledger);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      // The ADMIN quotes the distributor's project: "Prepared by" must be the admin, not the project creator (M-1).
      const q0 = await quotation(await as.admin.post(qUrl(url, projectId)), 201);
      const me = await body<{ name: string; username: string }>(await as.admin.get(url("/me")), 200);
      const adminName = me.name.trim() !== "" ? me.name : me.username;
      expect(q0.createdByName).toBe(adminName);
      const capped = q0.lines.find((l) => l.code === codes[1])!; // 110.00, min 90.00, capped at the stored default
      const rowOf = (page: { locator: import("@playwright/test").Page["locator"] }, code: string) => page.locator(`[data-testid="quotation-line"][data-code="${code}"]`);

      const o = await openAs(browser, run, "admin");
      try {
        const page = o.page;
        // scoped to <main>: a streamed hidden copy of the page can still be in the DOM right after goto (also on test.easeetool.com)
        const main = page.getByRole("main");
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        await expect(main.getByTestId("quotation-number")).toHaveText(q0.number);
        await expect(main.getByTestId("quotation-prepared-by")).toContainText(adminName);

        const row = rowOf(main, capped.code);
        // read-only first: a pencil per row, no Edited tag, no Reset icon, no popover, and no range on the row (Q-D34)
        await expect(main.getByTestId("quotation-line-edit")).toHaveCount(q0.lines.length);
        await expect(main.getByTestId("quotation-line-edited")).toHaveCount(0);
        await expect(main.getByTestId("quotation-line-reset")).toHaveCount(0);
        await expect(main.getByTestId("quotation-line-popover")).toHaveCount(0);
        await expect(row).not.toContainText(/Range|and up|No upper limit/);

        const pencil = row.getByTestId("quotation-line-edit");
        await expect.poll(() => isHydrated(pencil)).toBe(true);
        await pencil.click();
        const pop = main.getByTestId("quotation-line-popover");
        await expect(pop).toBeVisible();
        await expect(pop).toContainText(capped.code);
        await expect(pop.getByTestId("quotation-line-range")).toHaveText("Range 90 to 110");
        const input = pop.getByTestId("quotation-line-input");
        const save = pop.getByTestId("quotation-line-save");

        // out of range: the error names the range, Save is disabled, nothing is sent
        await input.fill("89");
        await expect(pop.getByTestId("quotation-line-error")).toHaveText("Enter a price from 90 to 110.");
        await expect(save).toBeDisabled();
        await input.fill("abc");
        await expect(pop.getByTestId("quotation-line-error")).toHaveText("Enter an amount with up to 2 decimal places.");
        await expect(save).toBeDisabled();

        // a valid price: one PATCH .../lines for this line, totals follow, the Edited tag and Reset icon appear
        await input.fill("95.50");
        await expect(save).toBeEnabled();
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/quotation/lines")),
          save.click(),
        ]);
        expect(res.status(), await res.text()).toBe(200);
        expect(JSON.parse(res.request().postData() ?? "{}")).toEqual({ code: capped.code, unitPrice: "95.50" });
        const q1 = (JSON.parse(await res.text()) as { quotation: Q }).quotation;
        await expect(pop).toHaveCount(0);
        await expect(row.getByTestId("quotation-line-edited")).toHaveText("Edited");
        await expect(row).toContainText(fmt("95.50"));
        await expect(row).toContainText(fmt(q1.lines.find((l) => l.code === capped.code)!.amount));
        await expect(main.getByTestId("totals-grand")).toHaveText(fmt(q1.totals.grandTotal));
        await expect(main.getByTestId("quotation-line-edited")).toHaveCount(1);
        await expect(row).not.toContainText(/Range|and up|No upper limit/);

        // M-2: a FAILED row-icon Reset (popover closed) shows its error in the page strip; the line stays edited
        await page.route("**/quotation/lines", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Stubbed failure" }) }));
        await row.getByTestId("quotation-line-reset").click();
        await expect(main.getByTestId("quotation-error")).toBeVisible();
        await expect(row.getByTestId("quotation-line-edited")).toHaveText("Edited");
        await page.unroute("**/quotation/lines");

        // the row's Reset icon puts one line back to its stored default
        const [reset] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/quotation/lines")),
          row.getByTestId("quotation-line-reset").click(),
        ]);
        expect(reset.status(), await reset.text()).toBe(200);
        expect(JSON.parse(reset.request().postData() ?? "{}")).toEqual({ code: capped.code, reset: true });
        await expect(main.getByTestId("quotation-line-edited")).toHaveCount(0);
        await expect(main.getByTestId("quotation-line-reset")).toHaveCount(0);
        await expect(row).toContainText(fmt(capped.defaultPrice!));
        await expect(main.getByTestId("totals-grand")).toHaveText(fmt(q0.totals.grandTotal));

        // Cancel closes without writing
        await pencil.click();
        await expect(main.getByTestId("quotation-line-popover")).toBeVisible();
        await main.getByTestId("quotation-line-cancel").click();
        await expect(main.getByTestId("quotation-line-popover")).toHaveCount(0);
        expect((await quotation(await as.admin.get(qUrl(url, projectId)))).anyLineEdited).toBe(false);
        expect(await settledProblems(o)).toEqual([]);
      } finally {
        await o.ctx.close();
      }

      // A distributor (external): the same quotation with an edited line shows no pencil, no Edited tag, no Reset icon
      expect((await quotation(await as.admin.patch(qUrl(url, projectId, "/lines"), { data: { code: capped.code, unitPrice: "95.50" } }))).anyLineEdited).toBe(true);
      const dist = await openAs(browser, run, "distributor");
      try {
        const page = dist.page;
        // scoped to <main>: right after goto the streamed (hidden) copy of the page can still be in the DOM on the alias
        const main = page.getByRole("main");
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        await expect(main.getByTestId("quotation-number")).toHaveText(q0.number);
        await expect(main.getByTestId("quotation-prepared-by")).toContainText(adminName);
        const row = rowOf(main, capped.code);
        await expect(row).toContainText(fmt("95.50"));
        await expect(main.getByTestId("quotation-line-edit")).toHaveCount(0);
        await expect(main.getByTestId("quotation-line-edited")).toHaveCount(0);
        await expect(main.getByTestId("quotation-line-reset")).toHaveCount(0);
        await expect(main.getByTestId("quotation-line-popover")).toHaveCount(0);
        await expect(main.getByTestId("quotation-section").first()).not.toContainText(/Range|and up|No upper limit/);
        expect(await settledProblems(dist)).toEqual([]);
      } finally {
        await dist.ctx.close();
      }
    } finally {
      await restore();
    }
  });

  test("UI AC4, AC5: Refresh, Reset all prices and Renew are confirm-gated; Export PDF carries the number, Rate (AED), every code and the grand total, no minimum, footer only", async ({ browser, run, f, as, url }) => {
    test.setTimeout(360_000);
    const projectId = await submittedWall(f, as, url);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, codes, "AED");
    try {
      const q0 = await quotation(await as.admin.post(qUrl(url, projectId)), 201);
      const o = await openAs(browser, run, "admin");
      try {
        const page = o.page;
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        await expect(page.getByTestId("quotation-number")).toHaveText(q0.number);
        const dialog = page.getByRole("dialog");
        const confirm = async (open: string, title: string, confirmName: string, tail: string, toast: RegExp) => {
          const btn = page.getByRole("button", { name: open, exact: true }).first();
          await expect.poll(() => isHydrated(btn)).toBe(true);
          await btn.click();
          await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
          // Cancel sends nothing and closes it
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
          await expect(dialog).toHaveCount(0);
          await btn.click();
          const [res] = await Promise.all([
            page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(tail)),
            dialog.getByRole("button", { name: confirmName, exact: true }).click(),
          ]);
          expect(res.status(), await res.text()).toBe(200);
          await expect(page.getByRole("status").filter({ hasText: toast })).toBeVisible();
          await expect(dialog).toHaveCount(0);
        };
        await confirm("Refresh", "Refresh quotation?", "Refresh", "/quotation/refresh", /Quotation refreshed/);
        await confirm("Reset all prices", "Reset all prices?", "Reset all prices", "/quotation/reset-prices", /All prices reset/);
        await confirm("Renew", "Renew quotation?", "Renew", "/quotation/renew", /Quotation renewed\. Valid until /);

        // AC5: Export PDF
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]);
        expect(download.suggestedFilename()).toBe(`quotation-${q0.number}.pdf`);
        const bytes = fs.readFileSync((await download.path())!);
        expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
        const text = bytes.toString("latin1");
        expect(text.includes("FlateDecode"), "uncompressed PDF").toBe(false);
        const q1 = await quotation(await as.admin.get(qUrl(url, projectId)));
        const missing = [
          q1.number, "Rate \\(AED\\)", `AED ${fmt(q1.totals.grandTotal)}`,
          ...q1.lines.map((l) => l.code).filter((c) => !text.includes(c)),
        ].filter((t) => !text.includes(t));
        expect(missing, "tokens missing from the PDF").toEqual([]);
        const printed = new Set(q1.lines.flatMap((l) => [fmt(l.unitPrice), fmt(l.amount)]));
        for (const l of q1.lines) {
          const min = fmt(l.minPrice!);
          if (!printed.has(min)) expect(text.includes(`(${min})`), `minimum ${min} of ${l.code} must not be printed`).toBe(false);
        }
        expect(text).toMatch(/\(Page 1 of \d+\) Tj/);
        expect(/terms|conditions/i.test(text)).toBe(false);
        expect(await settledProblems(o)).toEqual([]);
      } finally {
        await o.ctx.close();
      }
    } finally {
      await restore();
    }
  });

  test("UI AC1b, AC3, AC4, AC4b: missing prices popup is viewer specific; a distributor is read-only; step 5 stays open after Reset project; Refresh in the new currency is open to QUOTE", async ({ browser, run, f, as, url, ledger }) => {
    test.setTimeout(480_000);
    const projectId = await distributorWall(f, as, url, run, ledger);
    const codes = await materialCodes(as.admin, url, projectId);
    const gaps = await priceItems(as.admin, url, codes, "AED", [codes[0]]); // every code but the first
    const restores: Array<() => Promise<void>> = [gaps.restore];
    try {
      // ── missing prices on create: the popup reads differently for staff and for an external user ──
      // codes[0] is still unpriced here: both create attempts are refused (422) and write nothing.
      for (const who of ["distributor", "admin"] as const) {
        const o = await openAs(browser, run, who);
        try {
          await o.page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
          const create = o.page.getByRole("button", { name: "Create quotation" });
          await expect(create).toBeEnabled();
          await expect.poll(() => isHydrated(create)).toBe(true);
          const [res] = await Promise.all([
            o.page.waitForResponse((r) => r.request().method() === "POST" && /\/quotation$/.test(r.url())),
            create.click(),
          ]);
          expect(res.status(), await res.text()).toBe(422);
          const dlg = o.page.getByRole("dialog", { name: "Quotation can't be created" });
          await expect(dlg).toBeVisible();
          const row = dlg.getByTestId("problem-row");
          await expect(row).toHaveCount(1);
          await expect(row).toContainText("has no AED price");
          await expect(row).toContainText(`Code: ${codes[0]}`);
          if (who === "admin") {
            await expect(dlg).toContainText("Fix your inventory");
            await expect(dlg.getByRole("link", { name: "Go" })).toHaveAttribute("href", /\/admin\/inventory/);
          } else {
            await expect(dlg).toContainText("Missing prices");
            await expect(dlg).toContainText("1 item has no AED price. Ask your admin to add it.");
            await expect(dlg).not.toContainText("Fix your inventory");
            await expect(dlg.getByRole("link", { name: "Go" })).toHaveCount(0);
          }
          expect(await countQuotations(projectId)).toBe(0); // nothing was written
        } finally {
          await o.ctx.close();
        }
      }

      // ── M-3: an architect (no QUOTE) sees the no-access state, no Create ──
      const arch = await openAs(browser, run, "architect");
      try {
        await arch.page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        const archMain = arch.page.getByRole("main");
        await expect(archMain.getByTestId("quotation-no-access")).toContainText("You don't have access to quotations");
        await expect(archMain.getByRole("button", { name: "Create quotation" })).toHaveCount(0);
      } finally {
        await arch.ctx.close();
      }

      // ── price the gap, the distributor creates it, read-only for an external user ──
      const gap = await priceItems(as.admin, url, [codes[0]], "AED");
      restores.push(gap.restore);
      const dist = await openAs(browser, run, "distributor");
      try {
        const page = dist.page;
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        const create = page.getByRole("button", { name: "Create quotation" });
        await expect.poll(() => isHydrated(create)).toBe(true);
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "POST" && /\/quotation$/.test(r.url())),
          create.click(),
        ]);
        expect(res.status(), await res.text()).toBe(201);
        const q = (JSON.parse(await res.text()) as { quotation: Q }).quotation;
        await expect(page.getByTestId("quotation-number")).toHaveText(q.number);
        // AC3: no Edit on the totals, no Renew; Reset all prices stays (no edited line, Q-D33); no range keys in the payload
        await expect(page.getByTestId("quotation-totals").getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Renew", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Reset all prices", exact: true })).toBeVisible();
        await expect(page.getByTestId("quotation-banner-currency")).toHaveCount(0);

        // ── AC4b: the project moves to USD; a distributor (QUOTE only) gets an enabled "Refresh in USD" ──
        const cur = await as.admin.patch(url(`/projects/${projectId}`), { data: { currency: "USD" } });
        expect(cur.status(), await cur.text()).toBe(200);
        const usd = await priceItems(as.admin, url, codes, "USD");
        restores.push(usd.restore);
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        const banner = page.getByTestId("quotation-banner-currency");
        await expect(banner).toContainText("The project currency is now USD. This quotation is in AED.");
        const refreshIn = banner.getByRole("button", { name: "Refresh in USD" });
        await expect(refreshIn).toBeEnabled();
        await expect.poll(() => isHydrated(refreshIn)).toBe(true);
        await refreshIn.click();
        const dlg = page.getByRole("dialog");
        await expect(dlg.getByRole("heading", { name: "Refresh in USD?" })).toBeVisible();
        await expect(dlg).toContainText("edited line prices will be replaced");
        const [res2] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/quotation/refresh")),
          dlg.getByRole("button", { name: "Refresh in USD", exact: true }).click(),
        ]);
        expect(res2.status(), await res2.text()).toBe(200);
        const q3 = (JSON.parse(await res2.text()) as { quotation: Q }).quotation;
        expect(q3).toMatchObject({ currency: "USD", currencyDiffers: false });
        await expect(page.getByTestId("quotation-banner-currency")).toHaveCount(0);
        for (const l of q3.lines) {
          await expect(page.locator(`[data-testid="quotation-line"][data-code="${l.code}"]`)).toContainText(`USD/`);
        }

        // ── AC1b: Reset project deletes the calculation and clears designSubmittedAt; the quotation survives ──
        const reset = await as.admin.post(url(`/projects/${projectId}/reset`));
        expect(reset.status(), await reset.text()).toBe(200);
        await page.goto(orgTarget(run, `/projects/${projectId}/quotation`));
        await expect(page.getByTestId("quotation-number")).toHaveText(q.number);
        expect(await pillState(dist)).toMatchObject({ Summary: "locked", Quotation: "open" });
        const designBanner = page.getByTestId("quotation-banner-design");
        await expect(designBanner).toContainText("Submit the design first.");
        await expect(designBanner.getByRole("link", { name: "Go to Design" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Refresh", exact: true }).first()).toBeDisabled();
        expect(await settledProblems(dist)).toEqual([]);
      } finally {
        await dist.ctx.close();
      }
    } finally {
      for (const r of restores.reverse()) await r();
    }
  });
});
