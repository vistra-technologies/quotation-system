/**
 * Stage 23 Batch 3 — creation-time wiring + calculation invalidation (API + guarded-DB level).
 *
 * Covers: project create pins Project.formulaSetId (201); 409 on an incompatible set (naming the code)
 * and on an org with no active set; inquiry conversion pins too / 409s too; ProjectCalculation is deleted
 * (and designSubmittedAt cleared) by a geometry PATCH — including when designSubmittedAt is ALREADY null
 * (D-17) — but not by a label-only PATCH; same for rooms/sides add/remove wall, Floor delete, Room delete
 * and a Selection config PATCH (label-only Selection PATCH does nothing); deleting a project with a
 * calculation succeeds.
 *
 * NOT covered here (needs SuperAdmin credentials): a fresh org created via /controls has
 * activeFormulaSetId set, and SuperAdmin hard-delete of an org with projects + calculations.
 *
 * The 409 tests briefly repoint nordic-walls' activeFormulaSetId (restored in finally + afterAll); the
 * suite is serial and only nordic-walls is touched for that. Everything created is prefixed `e2e-s23-`.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, isSubdomain } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";
import {
  insertCalculation,
  setDesignSubmittedAt,
  readProjectState,
  readOrgActiveFormulaSet,
  setOrgActiveFormulaSet,
  createTempFormulaSet,
  deleteTempFormulaSet,
} from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();
const PREFIX = `e2e-s23-${RUN}`;

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
  const line = resp.headers()["set-cookie"]?.split("\n").find((l) => l.includes("session_token"));
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
let acme: Page;
let nordic: Page;
const projectsToDelete: { org: string; id: string }[] = [];
let nordicOriginalSet: string | null = null;
const tempSets: string[] = [];

test.beforeAll(async ({ browser }) => {
  acmeCtx = await browser.newContext();
  nordicCtx = await browser.newContext();
  acme = await acmeCtx.newPage();
  nordic = await nordicCtx.newPage();
  await apiSignIn(acme, ACME, "admin");
  await apiSignIn(nordic, NORDIC, "admin");
  nordicOriginalSet = await readOrgActiveFormulaSet(NORDIC);
});

test.afterAll(async () => {
  // Always restore nordic's pointer first, then drop temp sets.
  if (nordicOriginalSet) await setOrgActiveFormulaSet(NORDIC, nordicOriginalSet);
  for (const id of tempSets) await deleteTempFormulaSet(id);
  for (const p of projectsToDelete) {
    const page = p.org === NORDIC ? nordic : acme;
    await page.request.delete(apiUrl(p.org, `/api/v1/orgs/${p.org}/projects/${p.id}`)).catch(() => {});
  }
  await acmeCtx.close();
  await nordicCtx.close();
});

const A = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);
const N = (p: string) => apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}${p}`);

async function postProject(page: Page, org: string, name: string) {
  return page.request.post(apiUrl(org, `/api/v1/orgs/${org}/projects`), {
    data: { name: `${PREFIX} ${name}`, currency: "AED" },
  });
}

async function newProject(name: string): Promise<string> {
  const res = await postProject(acme, ACME, name);
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push({ org: ACME, id });
  return id;
}

/** Project + floor + room + one PARTITION wall. */
async function newWall(name: string) {
  const projectId = await newProject(name);
  const floor = await acme.request.post(A("/floors"), { data: { projectId, label: `${PREFIX} F` } });
  expect(floor.status()).toBe(201);
  const floorId = ((await floor.json()) as { floor: { id: string } }).floor.id;
  const room = await acme.request.post(A("/rooms"), { data: { floorId, label: `${PREFIX} R` } });
  expect(room.status()).toBe(201);
  const roomId = ((await room.json()) as { room: { id: string } }).room.id;
  const conv = await acme.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `${PREFIX} W`, heightMm: 2400, widthMm: 2400 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(conv.status(), await conv.text()).toBe(200);
  const partitionId = ((await conv.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0]
    .partitionId!;
  return { projectId, floorId, roomId, partitionId };
}

/** Put the project in the "calculated (+ submitted)" state. */
async function arm(projectId: string, opts: { submitted?: boolean } = {}) {
  const submitted = opts.submitted !== false;
  await insertCalculation(projectId);
  if (submitted) await setDesignSubmittedAt(projectId);
  const s = await readProjectState(projectId);
  expect(s.calcCount).toBe(1);
  expect(s.designSubmittedAt !== null).toBe(submitted);
}

const NO_CALC = { calcCount: 0, designSubmittedAt: null };

// ── creation ───────────────────────────────────────────────────────────────

test("POST projects -> 201 with formulaSetId pinned to the org's active set", async () => {
  const res = await postProject(acme, ACME, "pin");
  expect(res.status(), await res.text()).toBe(201);
  const project = ((await res.json()) as { project: { id: string; formulaSetId: string | null } }).project;
  projectsToDelete.push({ org: ACME, id: project.id });
  expect(project.formulaSetId).toBeTruthy();
  expect(project.formulaSetId).toBe(await readOrgActiveFormulaSet(ACME));
  expect((await readProjectState(project.id)).formulaSetId).toBe(project.formulaSetId);
});

test("create / inquiry convert -> 409 naming the missing code when incompatible; 409 when no active set; then converts and pins", async () => {
  const inq = await nordic.request.post(N("/inquiries"), { data: { name: `${PREFIX} inq409`, currency: "USD" } });
  expect(inq.status(), await inq.text()).toBe(201);
  const inquiryId = ((await inq.json()) as { inquiry: { id: string } }).inquiry.id;

  const tempId = await createTempFormulaSet(`e2e-s23-incompat-${RUN}`, {
    slots: { E2E_MISSING_CODE: { role: "glass", requiredParams: [], summaryParams: { glassType: "glassType" } } },
    formulas: [],
  });
  tempSets.push(tempId);
  try {
    await setOrgActiveFormulaSet(NORDIC, tempId);
    const res = await postProject(nordic, NORDIC, "incompat");
    expect(res.status()).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("E2E_MISSING_CODE");

    const conv = await nordic.request.post(N(`/inquiries/${inquiryId}/convert`));
    expect(conv.status()).toBe(409);
    expect(((await conv.json()) as { error: string }).error).toContain("E2E_MISSING_CODE");

    await setOrgActiveFormulaSet(NORDIC, null);
    const none = await postProject(nordic, NORDIC, "noset");
    expect(none.status()).toBe(409);
    expect(((await none.json()) as { error: string }).error).toMatch(/no active formula set/i);
    const noneConv = await nordic.request.post(N(`/inquiries/${inquiryId}/convert`));
    expect(noneConv.status()).toBe(409);
  } finally {
    await setOrgActiveFormulaSet(NORDIC, nordicOriginalSet);
  }
  // The failed converts rolled back: the inquiry is still convertible, and now pins.
  const ok = await nordic.request.post(N(`/inquiries/${inquiryId}/convert`));
  expect(ok.status(), await ok.text()).toBe(201);
  const project = ((await ok.json()) as { project: { id: string; formulaSetId: string | null } }).project;
  projectsToDelete.push({ org: NORDIC, id: project.id });
  expect(project.formulaSetId).toBe(nordicOriginalSet);
});

// ── invalidation ───────────────────────────────────────────────────────────

test("partition PATCH: geometry deletes calc + clears designSubmittedAt; label-only does neither; D-17 with flag already null", async () => {
  const { projectId, partitionId } = await newWall("part");
  await arm(projectId);

  const label = await acme.request.patch(A(`/partitions/${partitionId}`), { data: { label: `${PREFIX} renamed` } });
  expect(label.status(), await label.text()).toBe(200);
  const s = await readProjectState(projectId);
  expect(s.calcCount).toBe(1);
  expect(s.designSubmittedAt).not.toBeNull();

  const geo = await acme.request.patch(A(`/partitions/${partitionId}`), { data: { heightMm: 2500 } });
  expect(geo.status(), await geo.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);

  // D-17: a calculation with a NULL designSubmittedAt (post-Recompute state) is still deleted.
  await arm(projectId, { submitted: false });
  const geo2 = await acme.request.patch(A(`/partitions/${partitionId}`), { data: { heightMm: 2400 } });
  expect(geo2.status(), await geo2.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("rooms/[id]/sides: adding or removing a wall invalidates; keeping the same walls does not", async () => {
  const { projectId, roomId, partitionId } = await newWall("sides");
  await arm(projectId);

  const keep = await acme.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, partitionId },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(keep.status(), await keep.text()).toBe(200);
  expect((await readProjectState(projectId)).calcCount).toBe(1);

  const add = await acme.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, partitionId },
        { kind: "PARTITION", turnDegrees: 90, label: `${PREFIX} W2`, heightMm: 2400, widthMm: 1800 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(add.status(), await add.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);

  // Removing a wall (dropping the second PARTITION side) invalidates too.
  await arm(projectId);
  const remove = await acme.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, partitionId },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(remove.status(), await remove.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("Room delete and Floor delete invalidate", async () => {
  const w1 = await newWall("roomdel");
  await arm(w1.projectId);
  const r = await acme.request.delete(A(`/rooms/${w1.roomId}`));
  expect(r.status(), await r.text()).toBeLessThan(300);
  expect(await readProjectState(w1.projectId)).toMatchObject(NO_CALC);

  const w2 = await newWall("floordel");
  await arm(w2.projectId);
  const f = await acme.request.delete(A(`/floors/${w2.floorId}`));
  expect(f.status(), await f.text()).toBeLessThan(300);
  expect(await readProjectState(w2.projectId)).toMatchObject(NO_CALC);
});

test("Selection PATCH: config invalidates; label-only does not", async () => {
  const projectId = await newProject("sel");
  const types = await acme.request.get(A("/component-types"));
  const glass = ((await types.json()) as { componentTypes: { id: string; code: string }[] }).componentTypes.find(
    (c) => c.code === "GLASS",
  );
  expect(glass, "acme-glass has a GLASS ComponentType").toBeTruthy();
  const sel = await acme.request.post(A("/selections"), {
    data: { projectId, componentTypeId: glass!.id, label: `${PREFIX} g`, config: {}, orderIndex: 0 },
  });
  expect(sel.status(), await sel.text()).toBe(201);
  const selId = ((await sel.json()) as { selection: { id: string } }).selection.id;
  await arm(projectId);

  const label = await acme.request.patch(A(`/selections/${selId}`), { data: { label: `${PREFIX} g2` } });
  expect(label.status(), await label.text()).toBe(200);
  const s = await readProjectState(projectId);
  expect(s.calcCount).toBe(1);
  expect(s.designSubmittedAt).not.toBeNull();

  const cfg = await acme.request.patch(A(`/selections/${selId}`), { data: { config: { glassType: "x" } } });
  expect(cfg.status(), await cfg.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("deleting a project that has a calculation succeeds (no FK error)", async () => {
  const projectId = await newProject("del");
  await arm(projectId);
  const del = await acme.request.delete(A(`/projects/${projectId}`));
  expect(del.status(), await del.text()).toBe(200);
  const idx = projectsToDelete.findIndex((p) => p.id === projectId);
  if (idx >= 0) projectsToDelete.splice(idx, 1);
  const get = await acme.request.get(A(`/projects/${projectId}`));
  expect(get.status()).toBe(404);
});
