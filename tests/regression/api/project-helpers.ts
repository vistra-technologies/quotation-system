/**
 * Shared helpers for the inquiries / projects specs (Task 8).
 *
 * Org-B rows (foreign-id probes) are created through the `orgB` client and NOT ledgered: they are
 * deleted with org B itself at teardown (same pattern as external-companies.spec.ts).
 */
import { randomBytes } from "node:crypto";
import { expect, type APIResponse } from "@playwright/test";
import type { Guarded } from "../fixtures/clients";
import type { Ledger } from "../fixtures/ledger";
import type { Factories } from "../fixtures/factories";
import type { RunState } from "../fixtures/run-state";
import { apiUrl } from "../../e2e/helpers";
import type { Ctx } from "./api-matrix";

export const orgApi = (slug: string, p: string) => apiUrl(slug, `/api/v1/orgs/${slug}${p}`);
export const tag = () => randomBytes(3).toString("hex");

/** GLASS config fields that the active formula set dereferences as inventory codes, with the formula unit. */
const GLASS_CODE_FIELDS: Record<string, "metres" | "pieces"> = {
  u_profile: "metres",
  i_profile: "metres",
  l_profile: "metres",
  acousticGasketCode: "metres",
  whiteSealCode: "metres",
  woodWedgeCode: "metres",
  lConnectorCode: "pieces",
  degreeConnectorCode: "pieces",
  doorConnectorCode: "pieces",
  straightConnectorCode: "pieces",
};

let glassCodes: Promise<Record<string, string>> | undefined;

/**
 * GLASS selection config that passes Submit Design in the Test Org.
 *
 * The 3-field config of tests/e2e/stage26-calculation-api.spec.ts T4 is no longer enough: the active
 * formula set dereferences ten profile/gasket/connector codes (→ 422 MISSING_PARAM), and the codes of
 * tests/e2e/hotfix-2026-10-01-h2-h5.spec.ts's GLASS_FULL_CONFIG do not exist in the Test Org's inventory
 * (→ 422 UNRESOLVED_CODE). So each worker creates its own run-prefixed InventoryItems (via the ledgering
 * factory, with the unit each formula declares) once and points the config at them.
 */
export async function glassConfig(f: Factories): Promise<Record<string, string>> {
  glassCodes ??= (async () => {
    const out: Record<string, string> = {};
    for (const [field, measurementUnit] of Object.entries(GLASS_CODE_FIELDS)) {
      out[field] = (await f.inventoryItem({ measurementUnit })).code;
    }
    return out;
  })();
  return { category: "Single", glassType: "ID1", thickness: "12", ...(await glassCodes) };
}

/** One-section, one-cell v2 design filling a 2000 x 2400 wall with `selectionId`. */
export function oneCellDesign(selectionId: string | null) {
  return {
    schemaVersion: 2,
    sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId }] }],
  };
}

/** One per worker: an org-B project / inquiry / company for foreign-id probes. */
const cache: Record<string, Promise<string> | undefined> = {};

async function orgBCreate(c: Pick<Ctx, "run" | "orgB">, key: "projects" | "inquiries"): Promise<string> {
  const slug = c.run.orgB.slug;
  const name = `${c.run.prefix}b-${key}-${tag()}`;
  const r = await c.orgB.post(orgApi(slug, `/${key}`), { data: { name, currency: "AED" } });
  expect(r.status(), await r.text()).toBe(201);
  const body = (await r.json()) as { project?: { id: string }; inquiry?: { id: string } };
  return (body.project ?? body.inquiry)!.id;
}

export function foreignProjectId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return (cache.project ??= orgBCreate(c, "projects"));
}

export function foreignInquiryId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return (cache.inquiry ??= orgBCreate(c, "inquiries"));
}

export function foreignCompanyId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return (cache.company ??= (async () => {
    const slug = c.run.orgB.slug;
    const name = `${c.run.prefix}b-co-${tag()}`;
    const r = await c.orgB.post(orgApi(slug, "/external-companies"), {
      data: { name, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" },
    });
    expect(r.status(), await r.text()).toBe(201);
    const l = await c.orgB.get(orgApi(slug, "/external-companies"));
    const id = ((await l.json()) as { companies: { id: string; name: string }[] }).companies.find((x) => x.name === name)?.id;
    if (!id) throw new Error(`org-B company ${name} was created but is not listed`);
    return id;
  })());
}

/** The Test-Org distributor's (and architect's) external company — created by global setup. */
export async function distributorCompanyId(c: { run: RunState; as: Ctx["as"] }): Promise<string> {
  const r = await c.as.distributor.get(orgApi(c.run.testOrg.slug, "/me"));
  expect(r.status()).toBe(200);
  const id = ((await r.json()) as { externalCompanyId: string | null }).externalCompanyId;
  if (!id) throw new Error("the run's distributor has no external company");
  return id;
}

/**
 * POST a project / inquiry with an arbitrary body as `g` and ledger the row the moment it exists
 * (any 201). Returns the raw response; the caller asserts on it.
 */
export async function createLedgered(
  g: Guarded,
  deps: { run: RunState; ledger: Ledger },
  kind: "project" | "inquiry",
  data: Record<string, unknown>,
): Promise<{ res: APIResponse; id: string | null; body: Record<string, unknown> }> {
  const slug = deps.run.testOrg.slug;
  const res = await g.post(orgApi(slug, kind === "project" ? "/projects" : "/inquiries"), { data });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  let id: string | null = null;
  if (res.status() === 201) {
    const row = body[kind] as { id: string; name: string };
    id = row.id;
    deps.ledger.add({ kind, id, orgSlug: slug, label: row.name });
  }
  return { res, id, body };
}

/** Item ids of a paginated project / inquiry list. */
export async function listIds(g: Guarded, url: string, key: "projects" | "inquiries"): Promise<string[]> {
  const r = await g.get(url);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as Record<string, { id: string }[]>)[key].map((x) => x.id);
}
