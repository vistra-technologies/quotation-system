/**
 * Shared helpers for the design-tree / selections specs (Task 9).
 *
 * Org-B rows (foreign-id probes: a project → floor → room → PARTITION side → partition, plus one
 * selection) are created through the `orgB` client and NOT ledgered: they go with org B at teardown.
 * Test-Org rows hang off projects created by the ledgering factories (`f.wall` / `f.project`):
 * floors/rooms/partitions/selections cascade with their project.
 */
import { expect, type APIResponse } from "@playwright/test";
import type { Factories } from "../fixtures/factories";
import type { Guarded } from "../fixtures/clients";
import type { RunState } from "../fixtures/run-state";
import type { Ctx } from "./api-matrix";
import { foreignProjectId, orgApi, tag } from "./project-helpers";

/** Per-worker memo; a REJECTED promise is evicted so a transient failure is retried by the next caller. */
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

export const json = async <T>(r: APIResponse): Promise<T> => (await r.json()) as T;

/** Asserts a status with the body as the failure message, then returns the parsed body. */
export async function ok<T>(r: APIResponse, status = 200): Promise<T> {
  const text = await r.text();
  expect(r.status(), text).toBe(status);
  return JSON.parse(text) as T;
}

/** Asserts an exact `{ error }` rejection. */
export async function rejected(r: APIResponse, status: number, error: string | RegExp): Promise<void> {
  const text = await r.text();
  expect(r.status(), text).toBe(status);
  const body = JSON.parse(text) as { error: string };
  if (typeof error === "string") expect(body).toEqual({ error });
  else expect(body.error).toMatch(error);
}

export type Side = { id: string; kind: "PLAIN" | "PARTITION"; partitionId: string | null; turnDegrees: number; lengthMm: number | null; label: string | null };
export type Room = { id: string; floorId: string; label: string; orderIndex: number; isClosed: boolean; sides: Side[]; organizationId: string };
export type Floor = { id: string; projectId: string; label: string; orderIndex: number; organizationId: string };
export type Cell = { id: string; heightMm: number; selectionId: string | null; hinging?: string };
export type Section = { id: string; widthMm: number; cells: Cell[] };
export type Partition = {
  id: string;
  roomId: string;
  label: string;
  heightMm: number;
  widthMm: number;
  partitionNumber: number;
  status: string;
  organizationId: string;
  design: { schemaVersion?: number; sections?: Section[]; stops?: Record<string, string | null>; panels?: unknown; [k: string]: unknown } | null;
};
export type Selection = {
  id: string;
  projectId: string;
  componentTypeId: string;
  label: string;
  config: Record<string, unknown>;
  orderIndex: number;
  organizationId: string;
  componentType?: { id: string; name: string; code: string };
};

/** The three PLAIN sides that close a room around a first PARTITION side. */
export const PLAIN3 = [
  { kind: "PLAIN", turnDegrees: 90 },
  { kind: "PLAIN", turnDegrees: 90 },
  { kind: "PLAIN", turnDegrees: 90 },
] as const;

export const plain4 = () => [...PLAIN3, { kind: "PLAIN", turnDegrees: 90 }];

/** One-section v2 design of `widthMm` x `heightMm` with cell `selectionId`. */
export function design(sections: Array<{ w: number; cells: Array<[number, string | null]> }>, sid = "s") {
  return {
    schemaVersion: 2,
    sections: sections.map((s, i) => ({
      id: `${sid}${i}`,
      widthMm: s.w,
      cells: s.cells.map(([h, selectionId], j) => ({ id: `${sid}${i}-c${j}`, heightMm: h, selectionId })),
    })),
  };
}

/** Component type id by code in the Test Org (via the org-facing list). */
export async function typeId(admin: Guarded, run: RunState, code: string): Promise<string> {
  const r = await admin.get(orgApi(run.testOrg.slug, "/component-types"));
  const types = (await ok<{ componentTypes: { id: string; code: string }[] }>(r)).componentTypes;
  const id = types.find((t) => t.code === code)?.id;
  if (!id) throw new Error(`Test Org has no ComponentType ${code}`);
  return id;
}

/**
 * One per worker: a Test-Org wall (project → floor → room → PARTITION side) used as a VALID path by
 * matrix cases whose validation runs only after the row lookup (e.g. `{sides: []}` on rooms/:id/sides).
 * Every matrix case is rejected, so the wall is never modified; its project is ledgered by `f.wall`.
 */
export function sharedWall(f: Factories): ReturnType<Factories["wall"]> {
  return once("sharedWall", () => f.wall());
}

export interface ForeignTree {
  projectId: string;
  floorId: string;
  roomId: string;
  partitionId: string;
  selectionId: string;
  componentTypeId: string;
}

/**
 * One per worker: an org-B design tree for foreign-id probes. The selection uses the first org-B
 * component type that accepts a selection with an empty config (a freshly created org's starter
 * catalog may leave choice fields unconfigured — those types are 400 "not fully configured").
 */
export function foreignTree(c: Pick<Ctx, "run" | "orgB">): Promise<ForeignTree> {
  return once("orgB-tree", async () => {
    const slug = c.run.orgB.slug;
    const B = (p: string) => orgApi(slug, p);
    const projectId = await foreignProjectId(c);
    const fl = await ok<{ floor: Floor }>(await c.orgB.post(B("/floors"), { data: { projectId, label: `${c.run.prefix}bF-${tag()}` } }), 201);
    const rm = await ok<{ room: Room }>(await c.orgB.post(B("/rooms"), { data: { floorId: fl.floor.id, label: `${c.run.prefix}bR-${tag()}` } }), 201);
    const sd = await ok<{ room: Room }>(
      await c.orgB.patch(B(`/rooms/${rm.room.id}/sides`), {
        data: { sides: [{ kind: "PARTITION", turnDegrees: 90, label: `${c.run.prefix}bW`, heightMm: 2400, widthMm: 2000 }, ...PLAIN3] },
      }),
    );
    const partitionId = sd.room.sides[0].partitionId;
    if (!partitionId) throw new Error("org-B wall: sides PATCH returned no partitionId");
    const types = (await ok<{ componentTypes: { id: string; code: string }[] }>(await c.orgB.get(B("/component-types")))).componentTypes;
    const tried: string[] = [];
    for (const t of types) {
      const r = await c.orgB.post(B("/selections"), {
        data: { projectId, componentTypeId: t.id, label: `${c.run.prefix}bSel-${tag()}`, config: {}, orderIndex: 0 },
      });
      if (r.status() === 201) {
        const sel = (await r.json()) as { selection: { id: string } };
        return { projectId, floorId: fl.floor.id, roomId: rm.room.id, partitionId, selectionId: sel.selection.id, componentTypeId: t.id };
      }
      tried.push(`${t.code}: HTTP ${r.status()} ${await r.text()}`);
    }
    throw new Error(`org B has no component type that accepts a selection: ${tried.join("; ")}`);
  });
}
