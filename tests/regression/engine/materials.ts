/**
 * Shared material-list helpers for the calculation-engine spec and the journeys (Task 13).
 *
 * Inventory items. Every formula of the cloisons formula set dereferences a GLASS / DOOR config field as an
 * InventoryItem code (`materialCode: "{param.<field>}"`). Each item set below creates ONE run-prefixed item
 * per field, with the unit the formula declares and the perUnitQuantity the cloisons seed
 * (prisma/inventory/cloisons-inventory.ts) gives the same item: 3.0 for the structural profiles
 * (u/i/l profile, door frame, door leaf — one 3000 mm stock length), 1 for everything else. Those are the
 * perUnit values tests/e2e/stage24-materials.spec.ts's quantity expectations were computed against
 * (e.g. "doorFrame 8 m; perUnit 3.0 → ceil(8/3) = 3").
 *
 * Test-Org items are created through the ledgering factory (`f.inventoryItem`); items in a throwaway org
 * are created through that org's admin client and go with the org.
 */
import { randomBytes } from "node:crypto";
import { expect, type APIResponse } from "@playwright/test";
import type { Guarded } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import { apiUrl } from "../../e2e/helpers";

export type Unit = "metres" | "pieces";
type FieldDef = { field: string; formula: string; unit: Unit; perUnit: number };

/** GLASS config field → the cloisons formula that bills it. */
export const GLASS_FIELDS: FieldDef[] = [
  { field: "u_profile", formula: "profileU", unit: "metres", perUnit: 3 },
  { field: "i_profile", formula: "profileI", unit: "metres", perUnit: 3 },
  { field: "l_profile", formula: "profileL", unit: "metres", perUnit: 3 },
  { field: "acousticGasketCode", formula: "acousticGasket", unit: "metres", perUnit: 1 },
  { field: "whiteSealCode", formula: "whiteSeal", unit: "metres", perUnit: 1 },
  { field: "woodWedgeCode", formula: "woodWedge", unit: "metres", perUnit: 1 },
  { field: "lConnectorCode", formula: "lConnector", unit: "pieces", perUnit: 1 },
  { field: "degreeConnectorCode", formula: "degreeConnector", unit: "pieces", perUnit: 1 },
  { field: "doorConnectorCode", formula: "doorConnector", unit: "pieces", perUnit: 1 },
  { field: "straightConnectorCode", formula: "straightConnector", unit: "pieces", perUnit: 1 },
];

/** DOOR config field → the cloisons formula that bills it. */
export const DOOR_FIELDS: FieldDef[] = [
  { field: "frameCode", formula: "doorFrame", unit: "metres", perUnit: 3 },
  { field: "leafCode", formula: "doorLeaf", unit: "metres", perUnit: 3 },
  { field: "cornerConnBigCode", formula: "cornerConnBig", unit: "pieces", perUnit: 1 },
  { field: "cornerConnSmallFrameCode", formula: "cornerConnSmallFrame", unit: "pieces", perUnit: 1 },
  { field: "cornerConnSmallLeafCode", formula: "cornerConnSmallLeaf", unit: "pieces", perUnit: 1 },
  { field: "lAngleCode", formula: "lAngle", unit: "pieces", perUnit: 1 },
  { field: "hingeCode", formula: "hinges", unit: "pieces", perUnit: 1 },
  { field: "rubber25mmCode", formula: "rubber25mm", unit: "metres", perUnit: 1 },
  { field: "frameBumperGasketCode", formula: "frameBumperGasket", unit: "metres", perUnit: 1 },
  { field: "frameBackGasketCode", formula: "frameBackGasket", unit: "metres", perUnit: 1 },
  { field: "leafGlassGasket1Code", formula: "leafGlassGasket1", unit: "metres", perUnit: 1 },
  { field: "leafGlassGasket2Code", formula: "leafGlassGasket2", unit: "metres", perUnit: 1 },
];

export interface ItemSet {
  kind: "GLASS" | "DOOR";
  /** config field → item code */
  codes: Record<string, string>;
  /** config field → item id */
  ids: Record<string, string>;
  /** formula id → { code, unit, perUnit } */
  byFormula: Record<string, { code: string; unit: Unit; perUnit: number }>;
}

/** A creator of one inventory item in some org; returns its id and code. */
export type ItemMaker = (o: { code: string; measurementUnit: Unit; perUnitQuantity: number }) => Promise<{ id: string; code: string }>;

/** Test-Org items through the ledgering factory. */
export const testOrgItems = (f: Factories): ItemMaker => (o) => f.inventoryItem(o);

/** Items in a throwaway org (cascade with the org; never ledgered on their own). */
export function orgItems(admin: Guarded, slug: string): ItemMaker {
  return async (o) => {
    const r = await admin.post(apiUrl(slug, `/api/v1/orgs/${slug}/inventory`), { data: { name: `${o.code} name`, active: true, ...o } });
    expect(r.status(), await r.text()).toBe(201);
    return { id: ((await r.json()) as { item: { id: string } }).item.id, code: o.code };
  };
}

/** One item per field of `kind`, codes `<prefix><label><rand>-<field index>`. */
export async function makeItemSet(make: ItemMaker, prefix: string, kind: "GLASS" | "DOOR", label: string): Promise<ItemSet> {
  const rand = randomBytes(2).toString("hex");
  const defs = kind === "GLASS" ? GLASS_FIELDS : DOOR_FIELDS;
  const set: ItemSet = { kind, codes: {}, ids: {}, byFormula: {} };
  for (const [i, d] of defs.entries()) {
    // short codes (<= ~24 chars): the Summary PDF wraps long codes inside its table cells
    const { id, code } = await make({ code: `${prefix}${label}${rand}-${i}`, measurementUnit: d.unit, perUnitQuantity: d.perUnit });
    set.codes[d.field] = code;
    set.ids[d.field] = id;
    set.byFormula[d.formula] = { code, unit: d.unit, perUnit: d.perUnit };
  }
  return set;
}

/** GLASS selection config: the basic choice fields of tests/e2e/stage24-materials.spec.ts GLASS_CFG + the set's codes. */
export const glassCfg = (s: ItemSet): Record<string, string> => ({ category: "Single", glassType: "ID1", thickness: "12", ...s.codes });

/** DOOR selection config: stage24-materials.spec.ts DOOR_CFG_FULL's choice fields (frame + leaf) + the set's codes. */
export const doorCfg = (s: ItemSet, over: Record<string, string> = {}): Record<string, string> => ({
  category: "Single",
  doorType: "Simple Glass",
  hasFrame: "Yes",
  hasLeaf: "Yes",
  ...s.codes,
  ...over,
});

// ── material list / calculation reads ─────────────────────────────────────────

export type MaterialLine = { code: string; name: string; slot: string | string[]; unit: string; requirement: number; perUnitQuantity: number; quantity: number };
export type Calculation = {
  computedAt: string;
  status: string;
  errorDetail: string | null;
  summary: {
    floors: Array<{ rooms: Array<{ walls: Array<{ partitionId: string; glass: unknown[]; doors: Array<{ handing: string; quantity: number; doorType: string | null; category: string | null }> }> }> }>;
    kpis: { totalPartitionSqm: number; sqmByGlassType: unknown[]; doorsByType: Array<{ doorType: string | null; quantity: number }> };
  };
  materialList: MaterialLine[];
  formulaSet: { name: string; version: number };
};

export type Problem = { kind: string; scope: string; message: string; code?: string; expectedUnit?: string; actualUnit?: string; locus?: Record<string, unknown> };

export async function readCalc(admin: Guarded, slug: string, projectId: string): Promise<Calculation> {
  const r = await admin.get(apiUrl(slug, `/api/v1/orgs/${slug}/projects/${projectId}/calculation`));
  const text = await r.text();
  expect(r.status(), text).toBe(200);
  return JSON.parse(text) as Calculation;
}

/** 422 body of a refused submit/recompute. */
export async function refused(r: APIResponse): Promise<{ problems: Problem[]; problemCount: number; error: string; ok: boolean }> {
  const text = await r.text();
  expect(r.status(), text).toBe(422);
  return JSON.parse(text) as { problems: Problem[]; problemCount: number; error: string; ok: boolean };
}

export type Expect = Record<string, number | { requirement: number; quantity?: number }>;

/**
 * Assert the material list holds, for each formula id in `exp`, exactly one line with the set's code, the
 * formula's unit and perUnitQuantity, the expected requirement, and quantity = the explicit value when given
 * (copied from stage24-materials.spec.ts), otherwise the engine's own rule ceil(requirement / perUnit).
 */
export function expectLines(list: MaterialLine[], set: ItemSet, exp: Expect, what = ""): void {
  for (const [formula, e] of Object.entries(exp)) {
    const def = set.byFormula[formula];
    if (!def) throw new Error(`expectLines: ${set.kind} set has no formula ${formula}`);
    const lines = list.filter((l) => l.code === def.code);
    expect(lines, `${what} ${formula} (${def.code}): exactly one line — list: ${JSON.stringify(list.map((l) => [l.code, l.requirement]))}`).toHaveLength(1);
    const want = typeof e === "number" ? { requirement: e } : e;
    const l = lines[0];
    expect(l.requirement, `${what} ${formula} requirement`).toBe(want.requirement);
    expect(l.unit, `${what} ${formula} unit`).toBe(def.unit);
    expect(l.perUnitQuantity, `${what} ${formula} perUnitQuantity`).toBe(def.perUnit);
    expect(l.quantity, `${what} ${formula} quantity`).toBe(want.quantity ?? Math.ceil(want.requirement / def.perUnit));
    expect(l.name).toBe(`${def.code} name`);
  }
}

/** Codes of the set that appear in the list. */
export const codesOf = (list: MaterialLine[], set: ItemSet): string[] =>
  list.map((l) => l.code).filter((c) => Object.values(set.codes).includes(c)).sort();
