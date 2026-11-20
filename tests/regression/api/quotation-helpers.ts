/**
 * Shared helpers for the quotation specs (Stage 38): quotations.spec.ts and the Summary-notice page test.
 * Every price change is recorded and put back exactly by the returned `restore` (rule 10).
 */
import { expect, type APIResponse } from "@playwright/test";
import type { Guarded } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import type { Ledger } from "../fixtures/ledger";
import type { RunState } from "../fixtures/run-state";
import { tag, glassConfig, expectSubmitted, oneCellDesign, createLedgered } from "./project-helpers";

export type PriceRow = { currency: string; price: string; minPrice: string; allowAbove: boolean };

export async function body<T>(r: APIResponse, status: number): Promise<T> {
  const text = await r.text();
  expect(r.status(), text).toBe(status);
  return JSON.parse(text) as T;
}

/**
 * Prices every code in `codes` in `currency` (price 100 + 10 i, min 80 + 10 i, the first code with "No upper
 * limit"); codes in `skip` get NO price in that currency. Returns the prices set and a `restore` that puts every
 * touched item's own price list back exactly.
 */
export async function priceItems(admin: Guarded, url: (p: string) => string, codes: string[], currency: string, skip: string[] = []) {
  const inv = await body<{ items: { id: string; code: string; prices: PriceRow[] }[] }>(await admin.get(url("/inventory")), 200);
  const touched: { id: string; prior: PriceRow[] }[] = [];
  const price = new Map<string, string>();
  const restore = async () => {
    for (const t of touched.splice(0).reverse()) {
      const r = await admin.put(url(`/inventory/${t.id}/prices`), { data: t.prior });
      expect(r.status(), await r.text()).toBe(200);
    }
  };
  try {
    for (const [i, code] of codes.entries()) {
      const item = inv.items.find((x) => x.code === code);
      if (!item) throw new Error(`inventory item ${code} not found`);
      const prior = item.prices.map(({ currency: c, price: p, minPrice, allowAbove }) => ({ currency: c, price: p, minPrice, allowAbove }));
      const others = prior.filter((p) => p.currency !== currency);
      const next = skip.includes(code) ? others : [...others, { currency, price: `${100 + i * 10}.00`, minPrice: `${80 + i * 10}.00`, allowAbove: i === 0 }];
      touched.push({ id: item.id, prior });
      if (!skip.includes(code)) price.set(code, `${100 + i * 10}.00`);
      const r = await admin.put(url(`/inventory/${item.id}/prices`), { data: next });
      expect(r.status(), await r.text()).toBe(200);
    }
  } catch (err) {
    await restore();
    throw err;
  }
  return { price, restore };
}

export async function materialCodes(g: Guarded, url: (p: string) => string, projectId: string): Promise<string[]> {
  const calc = await body<{ materialList: { code: string }[] }>(await g.get(url(`/projects/${projectId}/calculation`)), 200);
  return [...new Set(calc.materialList.map((l) => l.code))];
}

/** A submitted one-wall GLASS project owned by no company (internal roles only). */
export async function submittedWall(f: Factories, as: Record<string, Guarded>, url: (p: string) => string): Promise<string> {
  const cfg = await glassConfig(f);
  const w = await f.wall();
  const sel = await f.selection(w.projectId, "GLASS", cfg);
  const p = await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { heightMm: 2400, design: oneCellDesign(sel.id) } });
  expect(p.status(), await p.text()).toBe(200);
  await expectSubmitted(await as.admin.post(url(`/projects/${w.projectId}/submit-design`)));
  return w.projectId;
}

/** A submitted one-wall project created BY the Test-Org distributor (so it belongs to the distributor's company). */
export async function distributorWall(
  f: Factories, as: Record<string, Guarded>, url: (p: string) => string, run: RunState, ledger: Ledger,
): Promise<string> {
  // S31-7: the config codes must be Test-Org dropdown choices BEFORE the project (and its frozen snapshot) exists
  const cfg = await glassConfig(f);
  const { res, id, body: b } = await createLedgered(as.distributor, { run, ledger }, "project", {
    name: `${run.prefix}dq-${tag()}`, currency: "AED", projectLocation: "Dubai, UAE",
  });
  expect(res.status(), JSON.stringify(b)).toBe(201);
  const projectId = id!;
  const fl = await as.admin.post(url("/floors"), { data: { projectId, label: `${run.prefix}F` } });
  const floorId = (await body<{ floor: { id: string } }>(fl, 201)).floor.id;
  const rm = await as.admin.post(url("/rooms"), { data: { floorId, label: `${run.prefix}R` } });
  const roomId = (await body<{ room: { id: string } }>(rm, 201)).room.id;
  const sides = await as.admin.patch(url(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `${run.prefix}Wall D`, heightMm: 2400, widthMm: 2000 },
        { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 }, { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  const partitionId = (await body<{ room: { sides: { partitionId?: string }[] } }>(sides, 200)).room.sides[0].partitionId!;
  const sel = await f.selection(projectId, "GLASS", cfg);
  const p = await as.admin.patch(url(`/partitions/${partitionId}`), { data: { heightMm: 2400, design: oneCellDesign(sel.id) } });
  expect(p.status(), await p.text()).toBe(200);
  await expectSubmitted(await as.admin.post(url(`/projects/${projectId}/submit-design`)));
  return projectId;
}
