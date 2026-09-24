/**
 * Stage 26 Batch 1 — GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation API spec.
 *
 * Verification strategy — Tier 1 (API-only, same pattern as inventory-api.spec.ts and
 * superadmin-formula-sets.spec.ts): all tests hit the route directly via Playwright's request fixture.
 * No browser navigation required beyond apiSignIn(); PLAYWRIGHT_BASE_URL is the only env var needed
 * (beyond seeded credentials).
 *
 * Covers:
 *   T1 — Unauthenticated GET -> 401
 *   T2 — Cross-org GET (nordic-walls session addressing an acme-glass project) -> 404
 *   T3 — A project with no ProjectCalculation row -> 404
 *   T4 — A real, submitted acme-glass project with a calculation -> 200; response body does NOT
 *        contain "materialByRoom" and does contain summary/materialList/computedAt/status/formulaSet
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
 *   npx playwright test stage26-calculation-api
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";
const RUN = Date.now();
const PREFIX = `e2e-s26calc-${RUN}`;

let acmeCtx: BrowserContext;
let nordicCtx: BrowserContext;
let anonCtx: BrowserContext;
let acme: Page;
let nordic: Page;
let anon: Page;

const A = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);
const N = (p: string) => apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}${p}`);

const projectsToDelete: string[] = [];

test.beforeAll(async ({ browser }) => {
  acmeCtx = await browser.newContext();
  acme = await acmeCtx.newPage();
  await apiSignIn(acme, ACME, "admin");

  nordicCtx = await browser.newContext();
  nordic = await nordicCtx.newPage();
  await apiSignIn(nordic, NORDIC, "admin");

  anonCtx = await browser.newContext();
  anon = await anonCtx.newPage();
});

test.afterAll(async () => {
  for (const id of projectsToDelete) {
    await acme.request.delete(A(`/projects/${id}`)).catch(() => {});
  }
  await acmeCtx.close();
  await nordicCtx.close();
  await anonCtx.close();
});

/** Project + floor + room + one PARTITION wall — same helper shape as stage23-summary.spec.ts's newWall(). */
async function newWall(name: string) {
  const proj = await acme.request.post(A("/projects"), {
    data: { name: `${PREFIX} ${name}`, currency: "AED" },
  });
  expect(proj.status(), await proj.text()).toBe(201);
  const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push(projectId);

  const floor = await acme.request.post(A("/floors"), { data: { projectId, label: `${PREFIX} F` } });
  expect(floor.status()).toBe(201);
  const floorId = ((await floor.json()) as { floor: { id: string } }).floor.id;
  const room = await acme.request.post(A("/rooms"), { data: { floorId, label: `${PREFIX} R` } });
  expect(room.status()).toBe(201);
  const roomId = ((await room.json()) as { room: { id: string } }).room.id;
  const conv = await acme.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `${PREFIX} Wall A`, heightMm: 2400, widthMm: 2000 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(conv.status(), await conv.text()).toBe(200);
  const partitionId = ((await conv.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0]
    .partitionId!;
  return { projectId, partitionId };
}

async function componentTypeId(code: string): Promise<string> {
  const res = await acme.request.get(A("/component-types"));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { componentTypes: { id: string; code: string }[] };
  const ct = body.componentTypes.find((c) => c.code === code);
  expect(ct, `acme-glass has a ${code} ComponentType`).toBeTruthy();
  return ct!.id;
}

async function newSelection(projectId: string, code: string, config: Record<string, string>): Promise<string> {
  const typeId = await componentTypeId(code);
  const res = await acme.request.post(A("/selections"), {
    data: { projectId, componentTypeId: typeId, label: `${PREFIX} ${code}`, config, orderIndex: 0 },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { selection: { id: string } }).selection.id;
}

function oneGlassCellDesign(glassSelId: string) {
  return {
    schemaVersion: 2,
    sections: [
      { id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: glassSelId }] },
    ],
  };
}

// ─── T1: Unauthenticated GET -> 401 ───────────────────────────────────────────

test("T1: GET .../calculation without session -> 401", async () => {
  const res = await anon.request.get(A("/projects/00000000-0000-0000-0000-000000000000/calculation"));
  expect(res.status()).toBe(401);
});

// ─── T2: Cross-org GET -> 404 ─────────────────────────────────────────────────

test("T2: nordic-walls session GETs an acme-glass project's calculation -> 404", async () => {
  const { projectId } = await newWall("crossorg");
  const res = await nordic.request.get(N(`/projects/${projectId}/calculation`));
  expect(res.status()).toBe(404);
});

// ─── T3: Project with no ProjectCalculation row -> 404 ────────────────────────

test("T3: GET .../calculation on a project never submitted/computed -> 404", async () => {
  const { projectId } = await newWall("nocalc");
  const res = await acme.request.get(A(`/projects/${projectId}/calculation`));
  expect(res.status()).toBe(404);
});

// ─── T4: Real submitted project with a calculation -> 200, no materialByRoom ─

test("T4: GET .../calculation on a submitted project -> 200, correct shape, no materialByRoom", async () => {
  const { projectId, partitionId } = await newWall("submitted");
  const glassSelId = await newSelection(projectId, "GLASS", { category: "Single", glassType: "ID1", thickness: "12" });

  const patch = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: oneGlassCellDesign(glassSelId) },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await acme.request.post(A(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);

  const res = await acme.request.get(A(`/projects/${projectId}/calculation`));
  expect(res.status(), await res.text()).toBe(200);

  const raw = await res.text();
  expect(raw).not.toContain("materialByRoom");

  const body = JSON.parse(raw) as {
    summary: unknown;
    materialList: unknown[];
    computedAt: string;
    status: string;
    formulaSet: { name: string; version: number };
  };
  expect(body.summary).toBeTruthy();
  expect(Array.isArray(body.materialList)).toBe(true);
  expect(body.computedAt).toBeTruthy();
  expect(body.status).toBe("OK");
  expect(body.formulaSet).toBeTruthy();
  expect(typeof body.formulaSet.name).toBe("string");
  expect(typeof body.formulaSet.version).toBe("number");
});
