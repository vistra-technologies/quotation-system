/**
 * Shared helpers for the inquiries / projects specs (Task 8).
 *
 * Org-B rows (foreign-id probes) are created through the `orgB` client and NOT ledgered: they are
 * deleted with org B itself at teardown (same pattern as external-companies.spec.ts).
 *
 * NOTE for other spec files: projects.spec.ts briefly renames the Test Org's GLASS ComponentType
 * (`rgr-<run>-GLASS-renamed`, withRecordedGlobalState). Specs running in parallel must not assert
 * ComponentType names, or `config-update` needsUpdate === false on Test-Org projects, without
 * tolerating that window.
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

/**
 * Per-worker memo of a creation promise. A REJECTED promise is evicted, so one failed create (a 429, a
 * transient 5xx) is retried by the next caller instead of failing every later test in the worker.
 */
const memo = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    memo.set(key, p);
    p.catch(() => {
      if (memo.get(key) === p) memo.delete(key);
    });
  }
  return p;
}

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
  const codes = await once("glassCodes", async () => {
    const out: Record<string, string> = {};
    for (const [field, measurementUnit] of Object.entries(GLASS_CODE_FIELDS)) {
      out[field] = (await f.inventoryItem({ measurementUnit })).code;
    }
    return out;
  });
  return { category: "Single", glassType: "ID1", thickness: "12", ...codes };
}

/** Set once per worker when Submit Design shows that GLASS_CODE_FIELDS is out of date (see below). */
let staleGlassConfig: Error | undefined;

/**
 * Asserts a Submit Design response for a `glassConfig()` wall is 200. A 422 whose problems are
 * MISSING_PARAM / UNIT_MISMATCH on GLASS means the active formula set changed under GLASS_CODE_FIELDS:
 * that is turned into ONE descriptive error (naming each param/formula/unit), remembered per worker and
 * rethrown immediately by later calls instead of cascading as dozens of opaque 422s.
 */
export async function expectSubmitted(res: APIResponse): Promise<void> {
  if (staleGlassConfig) throw staleGlassConfig;
  const text = await res.text();
  if (res.status() === 422) {
    type P = { kind: string; locus?: { fieldKey?: string; formulaId?: string; componentTypeCode?: string }; expectedUnit?: string; code?: string };
    const problems = ((JSON.parse(text) as { problems?: P[] }).problems ?? []).filter(
      (p) => p.kind === "MISSING_PARAM" || p.kind === "UNIT_MISMATCH",
    );
    if (problems.length) {
      staleGlassConfig = new Error(
        "tests/regression/api/project-helpers.ts GLASS_CODE_FIELDS is out of date with the Test Org's active formula set — " +
          problems
            .map((p) => p.kind === "MISSING_PARAM"
              ? `add param "${p.locus?.fieldKey}" (formula "${p.locus?.formulaId}", type ${p.locus?.componentTypeCode ?? "?"})`
              : `code ${p.code} needs unit "${p.expectedUnit}"`)
            .join("; "),
      );
      throw staleGlassConfig;
    }
  }
  expect(res.status(), text).toBe(200);
}

/** One-section, one-cell v2 design filling a 2000 x 2400 wall with `selectionId`. */
export function oneCellDesign(selectionId: string | null) {
  return {
    schemaVersion: 2,
    sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId }] }],
  };
}

/** One per worker (via `once`): an org-B project / inquiry / company for foreign-id probes. */

async function orgBCreate(c: Pick<Ctx, "run" | "orgB">, key: "projects" | "inquiries"): Promise<string> {
  const slug = c.run.orgB.slug;
  const name = `${c.run.prefix}b-${key}-${tag()}`;
  const r = await c.orgB.post(orgApi(slug, `/${key}`), { data: { name, currency: "AED" } });
  expect(r.status(), await r.text()).toBe(201);
  const body = (await r.json()) as { project?: { id: string }; inquiry?: { id: string } };
  return (body.project ?? body.inquiry)!.id;
}

export function foreignProjectId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return once("orgB-project", () => orgBCreate(c, "projects"));
}

export function foreignInquiryId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return once("orgB-inquiry", () => orgBCreate(c, "inquiries"));
}

export function foreignCompanyId(c: Pick<Ctx, "run" | "orgB">): Promise<string> {
  return once("orgB-company", async () => {
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
  });
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
  const post = () => g.post(orgApi(slug, kind === "project" ? "/projects" : "/inquiries"), { data });
  let res = await post();
  // Concurrent project creates race on the per-org projectNumber → transactional 409 (nothing written).
  for (let i = 0; i < 3 && res.status() === 409 && (await res.text()).includes("project number conflict"); i++) res = await post();
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
