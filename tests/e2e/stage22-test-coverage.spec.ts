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

// ── 1. v2 invariants across an editor-like action chain ────────────────────

test("v2 invariants hold on the STORED row across add / split / unite / rescale / height-change", async () => {
  const { partitionId } = await newWall("chain", 2400, 2400);
  const patch = (design: unknown, extra: Record<string, unknown> = {}) =>
    acme.request.patch(A(`/partitions/${partitionId}`), { data: { design, ...extra } });

  // start: one section
  expect((await patch(v2([sec("s1", 2400, [2400])]))).status()).toBe(200);
  assertInvariants(await getPartition(partitionId));

  // add panel (redistribute), split, rescale x3 (widths change => partition width derived)
  for (const widths of [[1200, 1200], [800, 800, 800], [500, 700, 1200], [600, 600, 600, 600], [1000, 1400]]) {
    const r = await patch(v2(widths.map((w, i) => sec(`s${i}`, w, [2400]))));
    expect(r.status()).toBe(200);
    const p = await getPartition(partitionId);
    assertInvariants(p);
    expect(p.widthMm).toBe(widths.reduce((a, b) => a + b, 0));
  }

  // door + transom (two cells) alongside a glass section, saved unchanged twice => no drift
  const doorWall = v2([sec("g", 1000, [2400]), sec("d", 1000, [1300, 1100])]);
  for (let i = 0; i < 2; i++) {
    expect((await patch(doorWall)).status()).toBe(200);
    const p = await getPartition(partitionId);
    assertInvariants(p);
    expect(p.design!.sections![1].cells.map((c) => c.heightMm)).toEqual([1300, 1100]);
  }

  // height change with matching sections in the SAME patch
  const h = await patch(v2([sec("g", 1000, [2700]), sec("d", 1000, [1500, 1200])]), { heightMm: 2700 });
  expect(h.status()).toBe(200);
  const p2 = await getPartition(partitionId);
  expect(p2.heightMm).toBe(2700);
  assertInvariants(p2);
});

// ── 2. every violation is a 400 and leaves the stored row untouched ────────

test("invariant / shape violations are 400 and the stored row is unchanged", async () => {
  const { partitionId } = await newWall("reject", 2000, 2400);
  const ok = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { design: v2([sec("a", 1000, [2400]), sec("b", 1000, [2400])]) },
  });
  expect(ok.status()).toBe(200);
  const before = JSON.stringify(await getPartition(partitionId));

  const bad: [string, Record<string, unknown>][] = [
    ["cell heights short in one section", { design: v2([sec("a", 1000, [2400]), sec("b", 1000, [1200, 1000])]) }],
    ["cell heights over in first section", { design: v2([sec("a", 1000, [2400, 100]), sec("b", 1000, [2400])]) }],
    ["zero width", { design: v2([sec("a", 0, [2400])]) }],
    ["negative width", { design: v2([sec("a", -5, [2400])]) }],
    ["fractional width", { design: v2([sec("a", 1000.5, [2400])]) }],
    ["string width", { design: v2([{ ...sec("a", 1000, [2400]), widthMm: "1000" }]) }],
    ["zero cell height", { design: v2([sec("a", 1000, [0, 2400])]) }],
    ["fractional cell height", { design: v2([sec("a", 1000, [2400.5])]) }],
    ["empty cells", { design: v2([{ id: "a", widthMm: 1000, cells: [] }]) }],
    ["duplicate section ids", { design: v2([sec("a", 1000, [2400]), sec("a", 1000, [2400])]) }],
    ["schemaVersion 3", { design: { schemaVersion: 3, sections: [sec("a", 1000, [2400])] } }],
    ["sections without schemaVersion", { design: { sections: [sec("a", 1000, [2400])] } }],
    ["schemaVersion without sections", { design: { schemaVersion: 2 } }],
    ["legacy panels body", { design: { panels: [{ id: "p", type: "glass", widthMm: 1000, heightMm: 2400 }] } }],
    ["sections not an array", { design: { schemaVersion: 2, sections: {} } }],
    ["bad hinging", { design: v2([{ id: "a", widthMm: 1000, cells: [{ id: "c", heightMm: 2400, selectionId: null, hinging: "up" }] }]) }],
    ["unknown selectionId", { design: v2([{ id: "a", widthMm: 1000, cells: [{ id: "c", heightMm: 2400, selectionId: "not-a-real-id" }] }]) }],
    // D-9 documented behavior: heightMm-only on a v2 row cannot keep the invariant
    ["heightMm-only change on a v2 row", { heightMm: 2500 }],
    ["heightMm zero", { heightMm: 0 }],
    ["heightMm negative", { heightMm: -1 }],
    ["heightMm string", { heightMm: "2400" }],
    ["design not an object", { design: "x" }],
  ];
  for (const [name, body] of bad) {
    const r = await acme.request.patch(A(`/partitions/${partitionId}`), { data: body });
    expect(r.status(), `${name} should be 400 (got ${r.status()})`).toBe(400);
  }
  expect(JSON.stringify(await getPartition(partitionId))).toBe(before);
});

// ── 3. designSubmittedAt edge cases ────────────────────────────────────────

test("designSubmittedAt: a rejected (400) PATCH does not clear it; a heightMm+design edit does", async () => {
  const { projectId, partitionId } = await newWall("submit-edge", 1000, 2400);
  expect(
    (await acme.request.patch(A(`/partitions/${partitionId}`), { data: { design: v2([sec("a", 1000, [2400])]) } })).status(),
  ).toBe(200);
  expect((await acme.request.post(A(`/projects/${projectId}/submit-design`))).status()).toBe(200);
  const submittedAt = async () =>
    ((await (await acme.request.get(A(`/projects/${projectId}`))).json()) as {
      project: { designSubmittedAt: string | null };
    }).project.designSubmittedAt;
  const s0 = await submittedAt();
  expect(s0).not.toBeNull();

  // rejected edits must leave the submitted state alone
  const rej = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { design: v2([sec("a", 1000, [2000])]) },
  });
  expect(rej.status()).toBe(400);
  expect(await submittedAt()).toBe(s0);

  // a valid height+design edit clears it
  const ok = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2000, design: v2([sec("a", 1000, [2000])]) },
  });
  expect(ok.status()).toBe(200);
  expect(await submittedAt()).toBeNull();

  // unsubmitted project: edit keeps it null (no spurious value)
  const ok2 = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { design: v2([sec("a", 1000, [2000])]) },
  });
  expect(ok2.status()).toBe(200);
  expect(await submittedAt()).toBeNull();
});

// ── 4. configSnapshot freeze (options + new type) and payload hygiene ──────

test("freeze: editing an org type's option values after project creation does not change that project's snapshot; a later project sees them", async () => {
  const key = `k${RUN}`;
  const code = `E2E_S22_${RUN}`;
  const create = await acme.request.post(A("/component-types"), {
    data: {
      code,
      name: `${PREFIX} type`,
      categoryId,
      fieldsSchema: [{ key, label: "Opt", type: "dropdown", required: false, basic: true }],
    },
  });
  expect(create.status()).toBe(201);
  const typeId = ((await create.json()) as { componentType: { id: string } }).componentType.id;
  typesToDelete.push(typeId);

  const put = (options: string[]) =>
    acme.request.put(A(`/component-types/${typeId}/field-values`), {
      data: { fieldOptionsConfig: { [key]: { options } } },
    });
  expect((await put(["A", "B"])).status()).toBe(200);

  const p1 = await newProject(acme, ACME, "freeze-1");
  const snapOf = async (id: string) => {
    const r = await acme.request.get(A(`/projects/${id}`));
    const { project } = (await r.json()) as {
      project: { configSnapshot: { takenAt: string; componentTypes: { id: string; fieldOptionsConfig: Record<string, { options: string[] }> }[] } };
    };
    return project.configSnapshot;
  };
  const s1 = await snapOf(p1);
  const t1 = s1.componentTypes.find((c) => c.id === typeId)!;
  expect(t1.fieldOptionsConfig[key].options).toEqual(["A", "B"]);

  expect((await put(["A", "B", "C"])).status()).toBe(200);

  const s1b = await snapOf(p1);
  expect(s1b).toEqual(s1); // byte-for-byte unchanged, including takenAt
  const p2 = await newProject(acme, ACME, "freeze-2");
  const t2 = (await snapOf(p2)).componentTypes.find((c) => c.id === typeId)!;
  expect(t2.fieldOptionsConfig[key].options).toEqual(["A", "B", "C"]);
});

test("configSnapshot never appears in list-style payloads (projects list, floors, inquiries, stats)", async () => {
  const pid = await newProject(acme, ACME, "payload");
  for (const path of ["/projects", `/projects?limit=5`, "/inquiries", "/stats", `/floors?projectId=${pid}`]) {
    const r = await acme.request.get(A(path));
    if (r.status() !== 200) continue; // route shape not applicable in every env
    expect(await r.text(), `${path} leaked configSnapshot`).not.toContain("configSnapshot");
  }
  // PATCH / create responses too
  const patched = await acme.request.patch(A(`/projects/${pid}`), { data: { name: `${PREFIX} payload renamed` } });
  expect(patched.status()).toBe(200);
  expect(await patched.text()).not.toContain("configSnapshot");
  const created = await acme.request.post(A("/projects"), { data: { name: `${PREFIX} payload-2`, currency: "AED" } });
  expect(created.status()).toBe(201);
  const t = await created.text();
  expect(t).not.toContain("configSnapshot");
  projectsToDelete.push({ org: ACME, page: () => acme, id: (JSON.parse(t) as { project: { id: string } }).project.id });
});

// ── 5. Configuration page: notice + snapshot, not live ─────────────────────

test("Configuration page: snapshot project shows the notice and does NOT offer a type created after it; null-snapshot project offers it and has no notice", async () => {
  const projectId = await newProject(acme, ACME, "config-ui");
  const nullId = await newProject(acme, ACME, "config-ui-null");
  await nullOutConfigSnapshot(nullId);

  const name = `${PREFIX} LATE TYPE`;
  const create = await acme.request.post(A("/component-types"), {
    data: {
      code: `E2E_S22_LATE_${RUN}`,
      name,
      categoryId,
      fieldsSchema: [{ key: "note", label: "Note", type: "text", required: false, basic: true }],
    },
  });
  expect(create.status()).toBe(201);
  typesToDelete.push(((await create.json()) as { componentType: { id: string } }).componentType.id);

  const notice = /Component options were captured when this project was created/;

  await acme.goto(orgUrl(ACME, `/projects/${projectId}/configuration`));
  await expect(acme.getByText(notice)).toBeVisible({ timeout: 30_000 });
  await expect(acme.getByText(name, { exact: false })).toHaveCount(0);

  await acme.goto(orgUrl(ACME, `/projects/${nullId}/configuration`));
  // fallback path renders (palette present) with no notice, and offers the live type
  await expect(acme.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(acme.getByText(notice)).toHaveCount(0);
});

// ── 6. tenancy + auth ──────────────────────────────────────────────────────

test("tenancy/auth: cross-org and anonymous access to partitions and project snapshots is refused", async () => {
  const { projectId, partitionId } = await newWall("tenancy", 1000, 2400);
  const design = v2([sec("a", 1000, [2400])]);
  const before = JSON.stringify(await getPartition(partitionId));

  // nordic session, nordic slug, acme ids -> 404 (not found in own org)
  expect((await nordic.request.get(N(`/partitions/${partitionId}`))).status()).toBe(404);
  expect((await nordic.request.patch(N(`/partitions/${partitionId}`), { data: { design } })).status()).toBe(404);
  expect((await nordic.request.patch(N(`/partitions/${partitionId}`), { data: { label: "pwned" } })).status()).toBe(404);
  const cross = await nordic.request.get(N(`/projects/${projectId}`));
  expect(cross.status()).toBe(404);
  expect(await cross.text()).not.toContain("componentTypes");
  expect((await nordic.request.post(N(`/projects/${projectId}/submit-design`))).status()).toBe(404);

  // nordic session against acme's slug -> 403
  const viaAcmeSlug = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);
  expect((await nordic.request.get(viaAcmeSlug(`/partitions/${partitionId}`))).status()).toBe(403);
  expect((await nordic.request.patch(viaAcmeSlug(`/partitions/${partitionId}`), { data: { design } })).status()).toBe(403);
  expect((await nordic.request.get(viaAcmeSlug(`/projects/${projectId}`))).status()).toBe(403);

  // anonymous -> 401
  expect((await anon.request.get(A(`/partitions/${partitionId}`))).status()).toBe(401);
  expect((await anon.request.patch(A(`/partitions/${partitionId}`), { data: { design } })).status()).toBe(401);
  expect((await anon.request.get(A(`/projects/${projectId}`))).status()).toBe(401);

  // nothing changed
  expect(JSON.stringify(await getPartition(partitionId))).toBe(before);

  // Each org's snapshot only ever references its own ComponentTypes
  const nId = await newProject(nordic, NORDIC, "tenancy-n");
  const aSnap = ((await (await acme.request.get(A(`/projects/${projectId}`))).json()) as {
    project: { configSnapshot: { componentTypes: { id: string }[] } };
  }).project.configSnapshot.componentTypes.map((c) => c.id);
  const nSnap = ((await (await nordic.request.get(N(`/projects/${nId}`))).json()) as {
    project: { configSnapshot: { componentTypes: { id: string }[] } };
  }).project.configSnapshot.componentTypes.map((c) => c.id);
  const nLive = ((await (await nordic.request.get(N("/component-types"))).json()) as {
    componentTypes: { id: string }[];
  }).componentTypes.map((c) => c.id);
  for (const id of nSnap) expect(nLive).toContain(id); // nordic snapshot ⊆ nordic live types
  expect(aSnap.some((id) => nSnap.includes(id))).toBe(false);
});

// ── 7. backfilled / pre-Stage-22 projects still load ───────────────────────

test("a project whose configSnapshot is NULL still serves detail + Configuration page (backfill window)", async () => {
  const id = await newProject(acme, ACME, "nullguard-ui");
  await nullOutConfigSnapshot(id);
  const res = await acme.request.get(A(`/projects/${id}`));
  expect(res.status()).toBe(200);
  await acme.goto(orgUrl(ACME, `/projects/${id}/configuration`));
  await expect(acme.getByText("Components", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
});

// Kept LAST: serial mode skips everything after a failure, and this one documents a known defect (bugs-1.md #1).
test("integer-overflow / fractional inputs are rejected with 400, never 500", async () => {
  const { partitionId } = await newWall("overflow", 2000, 2400);
  const r1 = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { design: v2([sec("a", 2_000_000_000, [2400]), sec("b", 2_000_000_000, [2400])]) },
  });
  test.info().annotations.push({ type: "overflow-statuses", description: `${r1.status()}` });
  expect.soft(r1.status(), "sum of section widths exceeding Int4 must not surface as 500").toBeLessThan(500);
  const r2 = await acme.request.patch(A(`/partitions/${partitionId}`), { data: { heightMm: 2400.5 } });
  expect.soft(r2.status(), "fractional heightMm must not surface as 500").toBeLessThan(500);
  const r3 = await acme.request.patch(A(`/partitions/${partitionId}`), { data: { heightMm: 99_999_999_999 } });
  expect.soft(r3.status(), "heightMm beyond Int4 must not surface as 500").toBeLessThan(500);
});
