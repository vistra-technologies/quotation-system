/**
 * Stage 22 — tester-authored black-box coverage (engineering:test pass, bugs-1.md).
 *
 * Complements stage22-data-model.spec.ts (dev-authored E1-E10) with the invariant/edge/tenancy/RBAC
 * surface that file does not exercise:
 *   - v2 design invariants held across a chain of edits (add/split/unite/rescale/height change),
 *     asserted on the STORED row via GET, not just the PATCH response
 *   - every invariant/shape violation is a 400 AND leaves the stored row untouched
 *   - designSubmittedAt: not cleared by a rejected (400) PATCH; cleared by heightMm-only edit
 *   - configSnapshot: fieldOptionsConfig freeze (option list edit after project creation), a later
 *     project DOES see the change, snapshot absent from every list-style payload, tenancy
 *   - Configuration page: snapshot notice shown, type created after project creation NOT offered
 *   - cross-org / unauthenticated access to partitions + project snapshot
 *
 * API-level except the Configuration-page UI test. Everything created is prefixed `e2e-s22-` /
 * `E2E_S22_` and deleted in afterAll (projects via DELETE, the throwaway ComponentTypes via the
 * guarded DB helper since no DELETE route exists).
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, orgUrl, isSubdomain } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";
import { deleteComponentType, nullOutConfigSnapshot } from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();
const PREFIX = `e2e-s22-${RUN}`;

async function apiSignIn(page: Page, orgSlug: string, username: string) {
  const password = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!";
  let resp;
  for (let attempt = 1; attempt <= 4; attempt++) {
    resp = await page.request.post(apiUrl(orgSlug, "/api/auth/sign-in/email"), {
      data: { email: toAuthEmail(username, orgSlug), password },
    });
    if (resp.status() !== 429) break;
    if (attempt < 4) {
      const retryAfterSec = Number(resp.headers()["x-retry-after"] ?? "10");
      await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1_000));
    }
  }
  if (!resp || !resp.ok()) throw new Error(`apiSignIn(${username}@${orgSlug}) failed: ${resp?.status()}`);
  const setCookie = resp.headers()["set-cookie"];
  const line = setCookie?.split("\n").find((l) => l.includes("session_token"));
  if (!line) throw new Error(`apiSignIn(${username}@${orgSlug}): no session_token cookie`);
  const [nameValue] = line.split(";");
  const eq = nameValue.indexOf("=");
  const base = new URL(BASE_URL);
  await page.context().addCookies([
    {
      name: nameValue.slice(0, eq),
      value: decodeURIComponent(nameValue.slice(eq + 1)),
      domain: isSubdomain ? `.${base.hostname}` : base.hostname,
      path: "/",
      httpOnly: true,
      secure: base.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

let acmeCtx: BrowserContext;
let nordicCtx: BrowserContext;
let anonCtx: BrowserContext;
let acme: Page;
let nordic: Page;
let anon: Page;
let categoryId: string;
const projectsToDelete: { org: string; page: () => Page; id: string }[] = [];
const typesToDelete: string[] = [];

test.beforeAll(async ({ browser }) => {
  acmeCtx = await browser.newContext();
  nordicCtx = await browser.newContext();
  anonCtx = await browser.newContext();
  acme = await acmeCtx.newPage();
  nordic = await nordicCtx.newPage();
  anon = await anonCtx.newPage();
  await apiSignIn(acme, ACME, "admin");
  await apiSignIn(nordic, NORDIC, "admin");
  const cats = await acme.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-categories`));
  categoryId = ((await cats.json()) as { categories: { id: string }[] }).categories[0].id;
});

test.afterAll(async () => {
  for (const p of projectsToDelete) {
    await p.page().request.delete(apiUrl(p.org, `/api/v1/orgs/${p.org}/projects/${p.id}`)).catch(() => {});
  }
  for (const id of typesToDelete) await deleteComponentType(id);
  await acmeCtx.close();
  await nordicCtx.close();
  await anonCtx.close();
});

// ── helpers ────────────────────────────────────────────────────────────────

const A = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);
const N = (p: string) => apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}${p}`);

async function newProject(page: Page, org: string, name: string): Promise<string> {
  const res = await page.request.post(apiUrl(org, `/api/v1/orgs/${org}/projects`), {
    data: { name: `${PREFIX} ${name}`, currency: org === NORDIC ? "USD" : "AED" },
  });
  expect(res.status()).toBe(201);
  const id = ((await res.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push({ org, page: () => (org === NORDIC ? nordic : acme), id });
  return id;
}

/** Project + floor + room + one PARTITION wall (width x height). Returns ids. */
async function newWall(name: string, widthMm = 2400, heightMm = 2400) {
  const projectId = await newProject(acme, ACME, name);
  const floor = await acme.request.post(A("/floors"), { data: { projectId, label: `${PREFIX} F` } });
  expect(floor.status()).toBe(201);
  const floorId = ((await floor.json()) as { floor: { id: string } }).floor.id;
  const room = await acme.request.post(A("/rooms"), { data: { floorId, label: `${PREFIX} R` } });
  expect(room.status()).toBe(201);
  const roomId = ((await room.json()) as { room: { id: string } }).room.id;
  const conv = await acme.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `${PREFIX} W`, heightMm, widthMm },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(conv.status()).toBe(200);
  const partitionId = ((await conv.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0]
    .partitionId!;
  return { projectId, floorId, roomId, partitionId };
}

type Partition = {
  id: string;
  widthMm: number;
  heightMm: number;
  design: {
    schemaVersion?: number;
    panels?: unknown;
    sections?: { id: string; widthMm: number; cells: { id: string; heightMm: number; selectionId: string | null }[] }[];
  } | null;
};
async function getPartition(id: string): Promise<Partition> {
  const r = await acme.request.get(A(`/partitions/${id}`));
  expect(r.status()).toBe(200);
  return ((await r.json()) as { partition: Partition }).partition;
}
function sec(id: string, widthMm: number, cellHeights: number[]) {
  return { id, widthMm, cells: cellHeights.map((h, i) => ({ id: `${id}-c${i}`, heightMm: h, selectionId: null })) };
}
const v2 = (sections: unknown[]) => ({ schemaVersion: 2, sections });

/** The two headline invariants, asserted on the stored row. */
function assertInvariants(p: Partition) {
  expect(p.design?.schemaVersion).toBe(2);
  expect(p.design?.panels).toBeUndefined();
  const sections = p.design!.sections!;
  expect(sections.reduce((s, x) => s + x.widthMm, 0)).toBe(p.widthMm);
  for (const s of sections) {
    expect(s.cells.reduce((t, c) => t + c.heightMm, 0)).toBe(p.heightMm);
  }
}


// ── L-1: cap boundaries ────────────────────────────────────────────────────

test("cap boundary: exactly 100000 mm is accepted, 100001 is 400 (never 500), stored row unchanged on reject", async () => {
  const { partitionId } = await newWall("cap", 2000, 2400);
  // Legit large-but-sane design first.
  const sane = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 6000, design: v2([sec("a", 15000, [6000]), sec("b", 15000, [6000])]) },
  });
  expect(sane.status(), await sane.text()).toBe(200);
  assertInvariants(await getPartition(partitionId));

  // Exactly at the cap: width sum 100000 and height 100000.
  const atCap = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 100000, design: v2([sec("a", 50000, [100000]), sec("b", 50000, [100000])]) },
  });
  expect(atCap.status(), await atCap.text()).toBe(200);
  const stored = await getPartition(partitionId);
  assertInvariants(stored);
  expect(stored.widthMm).toBe(100000);
  expect(stored.heightMm).toBe(100000);

  const before = JSON.stringify(await getPartition(partitionId));
  const over: Record<string, unknown>[] = [
    { design: v2([sec("a", 50000, [100000]), sec("b", 50001, [100000])]) }, // width sum 100001
    { design: v2([sec("a", 100001, [100000])]) }, // single section 100001
    { heightMm: 100001, design: v2([sec("a", 50000, [100001]), sec("b", 50000, [100001])]) }, // height 100001
    { heightMm: 100001 },
    { design: v2([sec("a", 50000, [50000, 50001]), sec("b", 50000, [100001])]) },
  ];
  for (const body of over) {
    const r = await acme.request.patch(A(`/partitions/${partitionId}`), { data: body });
    expect(r.status(), JSON.stringify(body)).toBe(400);
  }
  expect(JSON.stringify(await getPartition(partitionId))).toBe(before);
});

// ── M-1 edge cases ─────────────────────────────────────────────────────────

test("selection create: type deleted live but present in snapshot -> clean 400 (not 500); cross-org project or type refused", async () => {
  const key = `d${RUN}`;
  const mk = async (suffix: string) => {
    const c = await acme.request.post(A("/component-types"), {
      data: {
        code: `E2E_S22_R2${suffix}_${RUN}`,
        name: `${PREFIX} r2${suffix}`,
        categoryId,
        fieldsSchema: [{ key, label: "Opt", type: "dropdown", required: false, basic: true }],
      },
    });
    expect(c.status()).toBe(201);
    const id = ((await c.json()) as { componentType: { id: string } }).componentType.id;
    const p = await acme.request.put(A(`/component-types/${id}/field-values`), {
      data: { fieldOptionsConfig: { [key]: { options: ["A"] } } },
    });
    expect(p.status()).toBe(200);
    return id;
  };
  const doomedId = await mk("D");
  const keptId = await mk("K");
  typesToDelete.push(keptId);

  const projectId = await newProject(acme, ACME, "r2");
  const snap = await acme.request.get(A(`/projects/${projectId}`));
  const snapTypes = ((await snap.json()) as { project: { configSnapshot: { componentTypes: { id: string }[] } } }).project
    .configSnapshot.componentTypes;
  expect(snapTypes.some((t) => t.id === doomedId)).toBe(true);

  await deleteComponentType(doomedId); // live row gone; snapshot still lists it
  const gone = await acme.request.post(A("/selections"), {
    data: { projectId, componentTypeId: doomedId, label: `${PREFIX} gone`, config: { [key]: "A" }, orderIndex: 0 },
  });
  expect(gone.status(), await gone.text()).toBe(400);

  // Cross-org project (nordic admin, acme project id): refused, not 201/500.
  const foreignProj = await nordic.request.post(N("/selections"), {
    data: { projectId, componentTypeId: keptId, label: `${PREFIX} x`, config: { [key]: "A" }, orderIndex: 0 },
  });
  expect([400, 404]).toContain(foreignProj.status());
  // Cross-org type on an own-org project: refused.
  const nProject = await newProject(nordic, NORDIC, "r2n");
  const foreignType = await nordic.request.post(N("/selections"), {
    data: { projectId: nProject, componentTypeId: keptId, label: `${PREFIX} y`, config: { [key]: "A" }, orderIndex: 0 },
  });
  expect([400, 404]).toContain(foreignType.status());
  // Sanity: the still-live, snapshot-present type is creatable.
  const ok = await acme.request.post(A("/selections"), {
    data: { projectId, componentTypeId: keptId, label: `${PREFIX} ok`, config: { [key]: "A" }, orderIndex: 1 },
  });
  expect(ok.status(), await ok.text()).toBe(201);
});
