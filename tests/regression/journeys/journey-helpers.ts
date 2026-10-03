/**
 * Shared helpers for the end-to-end journeys (Task 13).
 *
 * Journeys chain several features in ONE flow and assert the state that crosses the steps (what step N wrote
 * is what step N+1 reads), on top of the per-route (tests/regression/api) and per-page (tests/regression/pages)
 * checks. Browser sessions reuse global setup's storageState files (page-helpers `openAs`); every row is
 * `rgr-<runId>-…` and ledgered the moment it exists; nothing outside the Test Org and this run's own
 * throwaway orgs is written.
 */
import { expect, type Browser } from "@playwright/test";
import type { Guarded } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import type { RunState } from "../fixtures/run-state";
import { orgApi } from "../api/project-helpers";
import { openAs, type Opened, type Who } from "../pages/page-helpers";
import { makeItemSet, testOrgItems, type ItemSet } from "../engine/materials";

export type J = { as: Record<"admin", Guarded>; f: Factories; run: RunState };
export const T = (c: { run: RunState }, p: string): string => orgApi(c.run.testOrg.slug, p);

/** Open `who` in a fresh context, run `body`, always close it. */
export async function withPage<R>(browser: Browser, run: RunState, who: Who, body: (o: Opened) => Promise<R>, saToken?: string): Promise<R> {
  const o = await openAs(browser, run, who, saToken);
  try {
    return await body(o);
  } finally {
    await o.ctx.close();
  }
}

export const wizardNav = (o: Opened) => o.page.getByRole("navigation", { name: "Project wizard steps" });
export const STEPS = ["Project Details", "Configuration", "Design", "Summary", "Quotation"] as const;

/**
 * Open/locked state of each wizard pill (same probe as pages.spec.ts). While a router.refresh() re-renders the
 * breadcrumb a pill can momentarily be absent / doubled: inside a poll (`strict: false`) such a pill reads
 * "settling" (the poll simply retries); a strict read asserts exactly one pill per step.
 */
export async function pillState(o: Opened, strict = true): Promise<Record<string, "open" | "locked" | "settling">> {
  const nav = wizardNav(o);
  if (strict) await expect(nav).toBeVisible();
  const out: Record<string, "open" | "locked" | "settling"> = {};
  for (const s of STEPS) {
    const locked = await nav.locator('span[aria-disabled="true"]', { hasText: s }).count();
    const open = await nav.getByRole("link", { name: new RegExp(s) }).count();
    if (strict) expect(locked + open, `${s}: exactly one pill`).toBe(1);
    out[s] = locked + open !== 1 ? "settling" : locked ? "locked" : "open";
  }
  return out;
}

/** Per-worker Test-Org item sets (a rejected creation is retried by the next caller). */
const sets = new Map<string, Promise<ItemSet>>();
export function sharedItems(c: { f: Factories; run: RunState }, kind: "GLASS" | "DOOR"): Promise<ItemSet> {
  let p = sets.get(kind);
  if (!p) {
    p = makeItemSet(testOrgItems(c.f), c.run.prefix, kind, `j${kind[0]}`);
    sets.set(kind, p);
    p.catch(() => sets.delete(kind));
  }
  return p;
}

/** Component type id by code in the org `slug`. */
export async function typeIdIn(g: Guarded, slug: string, code: string): Promise<string> {
  const r = await g.get(orgApi(slug, "/component-types"));
  expect(r.status(), await r.text()).toBe(200);
  const id = ((await r.json()) as { componentTypes: { id: string; code: string }[] }).componentTypes.find((t) => t.code === code)?.id;
  if (!id) throw new Error(`org ${slug} has no ComponentType ${code}`);
  return id;
}

/** POST a selection in org `slug`; returns its id. */
export async function addSelection(g: Guarded, slug: string, projectId: string, code: "GLASS" | "DOOR", label: string, config: Record<string, string>): Promise<string> {
  const r = await g.post(orgApi(slug, "/selections"), {
    data: { projectId, componentTypeId: await typeIdIn(g, slug, code), label, config, orderIndex: 0 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { selection: { id: string } }).selection.id;
}

/** GET a JSON resource, asserting the status. */
export async function getJson<R>(g: Guarded, url: string, status = 200): Promise<R> {
  const r = await g.get(url);
  const text = await r.text();
  expect(r.status(), `${url}: ${text.slice(0, 300)}`).toBe(status);
  return JSON.parse(text) as R;
}

export type SideIn = { kind: "PLAIN" } | { kind: "PARTITION"; widthMm: number; heightMm: number };
export const PLAIN = { kind: "PLAIN" } as const;
export const wallOf = (widthMm: number, heightMm: number): SideIn => ({ kind: "PARTITION", widthMm, heightMm });

/** Floor + closed 4-sided room under `projectId` in org `slug`; returns ids (partition ids in side order). */
export async function buildRoom(g: Guarded, slug: string, prefix: string, projectId: string, sides: SideIn[]) {
  const fl = await g.post(orgApi(slug, "/floors"), { data: { projectId, label: `${prefix}F` } });
  expect(fl.status(), await fl.text()).toBe(201);
  const floorId = ((await fl.json()) as { floor: { id: string } }).floor.id;
  const rm = await g.post(orgApi(slug, "/rooms"), { data: { floorId, label: `${prefix}R` } });
  expect(rm.status(), await rm.text()).toBe(201);
  const roomId = ((await rm.json()) as { room: { id: string } }).room.id;
  const sd = await g.patch(orgApi(slug, `/rooms/${roomId}/sides`), {
    data: { sides: sides.map((s, i) => (s.kind === "PLAIN" ? { kind: "PLAIN", turnDegrees: 90 } : { ...s, turnDegrees: 90, label: `${prefix}W${i}` })) },
  });
  expect(sd.status(), await sd.text()).toBe(200);
  const room = ((await sd.json()) as { room: { sides: { kind: string; partitionId: string | null }[] } }).room;
  return { floorId, roomId, partitionIds: room.sides.filter((s) => s.kind === "PARTITION").map((s) => s.partitionId!) };
}

/** v2 design: one section per entry (width, cells top → bottom as [height, selectionId]). */
export const designOf = (sections: Array<[widthMm: number, cells: Array<[heightMm: number, selectionId: string | null]>]>) => ({
  schemaVersion: 2,
  sections: sections.map(([w, cells], i) => ({ id: `s${i}`, widthMm: w, cells: cells.map(([h, selectionId], j) => ({ id: `s${i}-c${j}`, heightMm: h, selectionId })) })),
});

export type ProjectRow = {
  id: string; name: string; projectNumber: number; status: string; inquiryId: string | null; formulaSetId: string | null;
  designSubmittedAt: string | null; endClientName: string | null; mainContractorName: string | null; currency: string;
};
export const getProject = (g: Guarded, c: { run: RunState }, id: string) => getJson<{ project: ProjectRow }>(g, T(c, `/projects/${id}`)).then((b) => b.project);
