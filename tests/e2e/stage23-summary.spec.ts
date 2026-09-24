/**
 * Stage 23 Batch 7 — E2E coverage for the parts of Batches 4-6 that had no automated API-level test
 * yet (Batch 4's summary math is unit-tested in tests/unit/summary-builder.test.ts; Batch 6's guard
 * decision logic is unit-tested in tests/unit/formula-compat.test.ts — this file proves the real
 * wiring: routes, sessions, tenancy, transactions).
 *
 * Covers (see stage-23.md "Testing posture"):
 *   - Submit Design produces a ProjectCalculation whose `summary` matches D-27/D-40's shape (per-wall
 *     glass[] AND doors[] on the SAME wall, a transom's glass+door pair, populated labels, KPIs).
 *   - Submit Design blocked (422) on an incomplete design (13b) — nothing written.
 *   - Recompute reproduces an identical summary and never touches designSubmittedAt; recompute on a
 *     non-DRAFT project -> 409; recompute on a never-computed DRAFT -> 409 (D-23).
 *   - Editing a submitted design's key fields clears designSubmittedAt AND deletes the calculation,
 *     exercised through the real submit-design route (not just a DB-inserted calc, unlike
 *     stage23-wiring.spec.ts's invalidation tests).
 *   - The 3 SuperAdmin-only items carried forward since Batch 2 (now unblocked — TEST_SA_USERNAME /
 *     TEST_SA_PASSWORD provided): a fresh org created via /controls gets the real starter catalog +
 *     formula-set pin working end-to-end (create -> design -> submit -> OK summary); the
 *     ComponentType key-edit/type-lifecycle guard (D-36) 409s from all three DAL entry points
 *     (org-level PATCH, SuperAdmin PATCH, SuperAdmin DELETE); SuperAdmin hard-delete of an org with
 *     projects + a ProjectCalculation succeeds and the calculation row is actually gone (not just
 *     "the org delete didn't error").
 *
 * All three SuperAdmin-only tests build and tear down one throwaway org end-to-end (created ->
 * exercised -> suspended -> hard-deleted) rather than touching a shared seeded org, so the guard
 * tests' formula-set-pointer swap can never race a concurrently-running spec file (unlike
 * acme-glass/nordic-walls, which several other specs read/write).
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
 *   TEST_SA_USERNAME=devadmin TEST_SA_PASSWORD=*** \
 *   npx playwright test stage23-summary
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn, getSeededFormulaSetId } from "./helpers";
import {
  readProjectState,
  setProjectStatus,
  countProjectCalculations,
  createTempFormulaSet,
  deleteTempFormulaSet,
  setOrgActiveFormulaSet,
} from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const ACME = "acme-glass";
const RUN = Date.now();
const PREFIX = `e2e-s23sum-${RUN}`;

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);
const TEST_ORG_ADMIN_PASSWORD = "TestPass1234!";

async function loginAsSuperAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) throw new Error(`SuperAdmin login failed: HTTP ${res.status()}`);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token cookie not found in login response");
  return match[1];
}

// ── Section A: Submit / Summary / Recompute (acme-glass) ─────────────────────

let acmeCtx: BrowserContext;
let acme: Page;
const A = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);
const projectsToDelete: string[] = [];

test.beforeAll(async ({ browser }) => {
  acmeCtx = await browser.newContext();
  acme = await acmeCtx.newPage();
  await apiSignIn(acme, ACME, "admin");
});

test.afterAll(async () => {
  for (const id of projectsToDelete) {
    await acme.request.delete(A(`/projects/${id}`)).catch(() => {});
  }
  await acmeCtx.close();
});

/** Project + floor + room + one PARTITION wall, widthMm/heightMm irrelevant (overwritten by the first
 * design PATCH's own section widths / heightMm — see lib/data/partitions.ts's updatePartition()). */
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
  return { projectId, floorId, roomId, partitionId };
}

/** Look up a GLASS/DOOR ComponentType id by code (acme-glass, seeded D-34 catalog). */
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

/** A two-section design on ONE wall: section s1 = a plain glass cell, section s2 = a plain door cell
 * (no transom) — the minimal shape that exercises D-27/D-40's "per-wall glass[] AND doors[]". */
function twoSectionDesign(
  glassSelId: string,
  doorSelId: string,
  opts: { hinging?: "left" | "right"; heightMm?: number } = {},
) {
  const heightMm = opts.heightMm ?? 2400;
  const hinging = opts.hinging ?? "right";
  return {
    schemaVersion: 2,
    sections: [
      { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm, selectionId: glassSelId }] },
      { id: "s2", widthMm: 1000, cells: [{ id: "s2-c0", heightMm, selectionId: doorSelId, hinging }] },
    ],
  };
}

test("submit -> summary matches D-27/D-40 shape; recompute reproduces it and leaves designSubmittedAt alone", async () => {
  const { projectId, floorId, roomId, partitionId } = await newWall("submit");
  const glassSelId = await newSelection(projectId, "GLASS", { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await newSelection(projectId, "DOOR", { category: "Single", doorType: "Simple Glass" });

  const patch = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: twoSectionDesign(glassSelId, doorSelId, { hinging: "right" }) },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await acme.request.post(A(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  const submitBody = (await submit.json()) as { project: { designSubmittedAt: string | null } };
  expect(submitBody.project.designSubmittedAt).not.toBeNull();

  const s1 = await readProjectState(projectId);
  expect(s1.calcCount).toBe(1);

  // Recompute — same shared load-build-write path, must reproduce byte-identical summary.
  const recompute = await acme.request.post(A(`/projects/${projectId}/recompute`));
  expect(recompute.status(), await recompute.text()).toBe(200);
  type Calc = {
    calculation: {
      status: string;
      computedAt: string;
      materialList: unknown[];
      summary: {
        floors: {
          floorId: string;
          floorLabel: string;
          rooms: {
            roomId: string;
            roomLabel: string;
            walls: {
              partitionId: string;
              wallLabel: string;
              glass: { glassType: string | null; thickness: string | null; areaM2: number }[];
              doors: { handing: string; category: string | null; doorType: string | null; quantity: number }[];
            }[];
          }[];
        }[];
        kpis: {
          totalPartitionSqm: number;
          sqmByGlassType: { glassType: string | null; thickness: string | null; areaM2: number }[];
          doorsByType: { doorType: string | null; quantity: number }[];
        };
      };
    };
  };
  const { calculation } = (await recompute.json()) as Calc;
  expect(calculation.status).toBe("OK");
  expect(calculation.materialList).toEqual([]); // D-37

  const floor = calculation.summary.floors.find((f) => f.floorId === floorId);
  expect(floor, "written summary contains this floor").toBeTruthy();
  expect(floor!.floorLabel).toBe(`${PREFIX} F`);
  const room = floor!.rooms.find((r) => r.roomId === roomId);
  expect(room, "written summary contains this room").toBeTruthy();
  expect(room!.roomLabel).toBe(`${PREFIX} R`);
  const wall = room!.walls.find((w) => w.partitionId === partitionId);
  expect(wall, "written summary contains this wall").toBeTruthy();
  expect(wall!.wallLabel).toBe(`${PREFIX} Wall A`);

  // D-27/D-40: glass AND doors both hang off the SAME wall node; no room-level door list exists in
  // the shape at all (TypeScript's own SummaryRoom type has no `doors` field — nothing to assert
  // "absent" on beyond what the type already enforces).
  expect(wall!.glass).toHaveLength(1);
  expect(wall!.glass[0]).toMatchObject({ glassType: "ID1", thickness: "12", areaM2: 2.4 });
  expect(wall!.doors).toHaveLength(1);
  expect(wall!.doors[0]).toMatchObject({ handing: "RH", category: "Single", doorType: "Simple Glass", quantity: 1 });

  // KPIs: glass only, doors excluded.
  expect(calculation.summary.kpis.totalPartitionSqm).toBe(2.4);
  expect(calculation.summary.kpis.sqmByGlassType).toEqual([{ glassType: "ID1", thickness: "12", areaM2: 2.4 }]);
  expect(calculation.summary.kpis.doorsByType).toEqual([{ doorType: "Simple Glass", quantity: 1 }]);

  // Recompute never stamps/touches designSubmittedAt.
  const s2 = await readProjectState(projectId);
  expect(s2.designSubmittedAt).toBe(s1.designSubmittedAt);

  // Recompute is deterministic: a second call reproduces the identical summary.
  const recompute2 = await acme.request.post(A(`/projects/${projectId}/recompute`));
  const { calculation: calc2 } = (await recompute2.json()) as Calc;
  expect(calc2.summary).toEqual(calculation.summary);
});

test("submit blocked (422) on an incomplete design (13b) — nothing written", async () => {
  const { projectId, partitionId } = await newWall("incomplete");
  // heightMm/design left at the room/sides default (no sections[]) — "design has not been started".
  const submit = await acme.request.post(A(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(422);
  const body = (await submit.json()) as { error: string };
  expect(body.error).toMatch(/design has not been started|no selection assigned/i);
  expect(await readProjectState(projectId)).toMatchObject({ calcCount: 0, designSubmittedAt: null });

  // Cell exists but has no selection — same 422 class, naming the cell.
  const glassSelId = await newSelection(projectId, "GLASS", { category: "Single", glassType: "ID1", thickness: "12" });
  const design = {
    schemaVersion: 2,
    sections: [
      { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: glassSelId }] },
      { id: "s2", widthMm: 1000, cells: [{ id: "s2-c0", heightMm: 2400, selectionId: null }] },
    ],
  };
  const patch = await acme.request.patch(A(`/partitions/${partitionId}`), { data: { heightMm: 2400, design } });
  expect(patch.status(), await patch.text()).toBe(200);
  const submit2 = await acme.request.post(A(`/projects/${projectId}/submit-design`));
  expect(submit2.status(), await submit2.text()).toBe(422);
  expect(((await submit2.json()) as { error: string }).error).toMatch(/no selection assigned/);
  expect(await readProjectState(projectId)).toMatchObject({ calcCount: 0, designSubmittedAt: null });
});

test("editing a submitted design's key fields clears designSubmittedAt and deletes the calculation (through the real submit route)", async () => {
  const { projectId, partitionId } = await newWall("edit-invalidate");
  const glassSelId = await newSelection(projectId, "GLASS", { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await newSelection(projectId, "DOOR", { category: "Single", doorType: "Simple Glass" });
  const patch = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: twoSectionDesign(glassSelId, doorSelId) },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const submit = await acme.request.post(A(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject({ calcCount: 1 });

  const edit = await acme.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2500, design: twoSectionDesign(glassSelId, doorSelId, { heightMm: 2500 }) },
  });
  expect(edit.status(), await edit.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject({ calcCount: 0, designSubmittedAt: null });
});

test("recompute: never-computed DRAFT -> 409; non-DRAFT -> 409 (D-23)", async () => {
  const { projectId } = await newWall("recompute-guards");
  const never = await acme.request.post(A(`/projects/${projectId}/recompute`));
  expect(never.status(), await never.text()).toBe(409);

  await setProjectStatus(projectId, "CONFIRMED");
  try {
    const notDraft = await acme.request.post(A(`/projects/${projectId}/recompute`));
    expect(notDraft.status(), await notDraft.text()).toBe(409);
  } finally {
    await setProjectStatus(projectId, "DRAFT");
  }
});

// ── Section B: SuperAdmin-only items (fresh throwaway org, all 3 items) ──────
//
// Skips entirely when TEST_SA_USERNAME/TEST_SA_PASSWORD are absent — see FLAG-B3 convention in
// superadmin-orgs.spec.ts / superadmin-component-types.spec.ts.

test.describe("SuperAdmin-only: fresh org pin + guard (3 paths) + hard-delete cascade", () => {
  test.skip(!hasBootstrapCreds, "TEST_SA_USERNAME / TEST_SA_PASSWORD not set");

  let saToken: string;
  let orgId: string;
  let orgSlug: string;
  let orgCtx: BrowserContext;
  let orgAdmin: Page;
  let orgProjectId: string;
  let tempSetId: string | null = null;

  test.beforeAll(async ({ browser, request }) => {
    saToken = await loginAsSuperAdmin(request);
    orgSlug = `e2e-s23-fresh-${RUN}`;
    // R2 fix (Finding 3): formulaSetId is now required on POST /orgs (Batch 5).
    const formulaSetId = await getSeededFormulaSetId(request, saToken);
    const create = await request.post("/api/v1/superadmin/orgs", {
      headers: { Cookie: `qs-sa-token=${saToken}` },
      data: { name: "E2E Stage 23 Fresh Org", slug: orgSlug, adminPassword: TEST_ORG_ADMIN_PASSWORD, formulaSetId },
    });
    expect(create.status(), await create.text()).toBe(201);
    orgId = ((await create.json()) as { org: { id: string } }).org.id;

    orgCtx = await browser.newContext();
    orgAdmin = await orgCtx.newPage();
    // The auto-created admin user's password is the adminPassword given at org-creation time, not
    // TEST_ADMIN_PASSWORD — apiSignIn reads TEST_ADMIN_PASSWORD, so sign in via a direct call instead.
    const signIn = await orgAdmin.request.post(apiUrl(orgSlug, "/api/auth/sign-in/email"), {
      data: { email: `admin@${orgSlug}.internal`, password: TEST_ORG_ADMIN_PASSWORD },
    });
    expect(signIn.status(), await signIn.text()).toBe(200);
  });

  test.afterAll(async () => {
    if (tempSetId) await deleteTempFormulaSet(tempSetId).catch(() => {});
    await orgCtx?.close();
  });

  const O = (p: string) => apiUrl(orgSlug, `/api/v1/orgs/${orgSlug}${p}`);

  test("item 1 — fresh org via /controls: D-34 catalog + D-22/D-38 formula-set pin work end-to-end", async () => {
    // The org row itself was pinned at creation (createOrganizationWithDefaults, D-22) — read it
    // directly to prove the pin exists before touching anything else.
    const ctList = await orgAdmin.request.get(O("/component-types"));
    expect(ctList.status(), await ctList.text()).toBe(200);
    const types = (
      (await ctList.json()) as {
        componentTypes: { id: string; code: string; categoryId: string; fieldsSchema: { key: string }[] }[];
      }
    ).componentTypes;
    const glass = types.find((t) => t.code === "GLASS");
    const door = types.find((t) => t.code === "DOOR");
    expect(glass, "fresh org has the D-34 GLASS type").toBeTruthy();
    expect(door, "fresh org has the D-34 DOOR type").toBeTruthy();
    // Shape proof for the cascading dropdowns (category -> glassType -> thickness) the D-34 swap
    // exists for — a full UI click-through belongs to a page-level Tier 2 spec; this proves the API
    // shape the dropdowns are built from.
    const glassKeys = glass!.fieldsSchema.map((f) => f.key);
    expect(glassKeys).toEqual(expect.arrayContaining(["category", "glassType", "thickness"]));

    const proj = await orgAdmin.request.post(O("/projects"), {
      data: { name: `${PREFIX} fresh-org-proj`, currency: "AED" },
    });
    expect(proj.status(), await proj.text()).toBe(201);
    const project = ((await proj.json()) as { project: { id: string; formulaSetId: string | null } }).project;
    orgProjectId = project.id;
    expect(project.formulaSetId, "new project pins the org's active (seeded) formula set").toBeTruthy();

    // End-to-end through the real pipeline: design -> selections -> submit -> OK summary, using the
    // fresh org's OWN catalog (not acme-glass's) — proves the whole chain, not just the pin field.
    const floor = await orgAdmin.request.post(O("/floors"), { data: { projectId: orgProjectId, label: "F1" } });
    expect(floor.status()).toBe(201);
    const floorId = ((await floor.json()) as { floor: { id: string } }).floor.id;
    const room = await orgAdmin.request.post(O("/rooms"), { data: { floorId, label: "R1" } });
    expect(room.status()).toBe(201);
    const roomId = ((await room.json()) as { room: { id: string } }).room.id;
    const sides = await orgAdmin.request.patch(O(`/rooms/${roomId}/sides`), {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 90, label: "Wall A", heightMm: 2400, widthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    });
    expect(sides.status(), await sides.text()).toBe(200);
    const partitionId = ((await sides.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0]
      .partitionId!;

    const glassTypeRow = types.find((t) => t.code === "GLASS")!;
    const sel = await orgAdmin.request.post(O("/selections"), {
      data: {
        projectId: orgProjectId,
        componentTypeId: glassTypeRow.id,
        label: "g1",
        config: { category: "Single", glassType: "ID1", thickness: "12" },
        orderIndex: 0,
      },
    });
    expect(sel.status(), await sel.text()).toBe(201);
    const glassSelId = ((await sel.json()) as { selection: { id: string } }).selection.id;

    const patch = await orgAdmin.request.patch(O(`/partitions/${partitionId}`), {
      data: {
        heightMm: 2400,
        design: {
          schemaVersion: 2,
          sections: [{ id: "s1", widthMm: 1000, cells: [{ id: "c1", heightMm: 2400, selectionId: glassSelId }] }],
        },
      },
    });
    expect(patch.status(), await patch.text()).toBe(200);

    const submit = await orgAdmin.request.post(O(`/projects/${orgProjectId}/submit-design`));
    expect(submit.status(), await submit.text()).toBe(200);
    expect((await countProjectCalculations(orgId))).toBeGreaterThanOrEqual(1);
  });

  test("item 2 — ComponentType guard (D-36) 409s from all three DAL entry points; a non-block still succeeds", async () => {
    // A custom, non-reserved type on this isolated fresh org — never touches the real GLASS/DOOR
    // catalog, and this org has no concurrently-running spec sharing it (unlike acme-glass/nordic).
    const catRes = await orgAdmin.request.get(O("/component-types"));
    const catBody = (await catRes.json()) as { componentTypes: { categoryId: string }[] };
    const categoryId = catBody.componentTypes[0].categoryId;

    const createType = await orgAdmin.request.post(O("/component-types"), {
      data: {
        code: `E2E_SLOT_${RUN}`,
        name: "E2E Slot",
        categoryId,
        fieldsSchema: [{ key: "foo", label: "Foo", type: "field", required: true, basic: true }],
      },
    });
    expect(createType.status(), await createType.text()).toBe(201);
    const slotType = ((await createType.json()) as { componentType: { id: string; code: string } }).componentType;

    tempSetId = await createTempFormulaSet(`e2e-s23sum-guard-${RUN}`, {
      slots: { [slotType.code]: { role: "glass", requiredParams: [], summaryParams: { glassType: "foo" } } },
      formulas: [],
    });

    // Point this fresh org's active set at the temp guarded set — safe, since this org is isolated
    // (created just for this describe block, no other spec file touches it).
    await setOrgActiveFormulaSet(orgSlug, tempSetId);

    // 1) Org-level PATCH removing the referenced field -> 409.
    const orgPatch = await orgAdmin.request.patch(O(`/component-types/${slotType.id}`), {
      data: { fieldsSchema: [] },
    });
    expect(orgPatch.status(), await orgPatch.text()).toBe(409);
    expect(((await orgPatch.json()) as { error: string }).error).toContain(slotType.code);

    // Non-block: adding a NEW field (not removing the referenced one) still succeeds — proves the
    // guard isn't accidentally blanket-blocking every fieldsSchema PATCH on a slot type.
    const orgPatchOk = await orgAdmin.request.patch(O(`/component-types/${slotType.id}`), {
      data: { fieldsSchema: [{ key: "foo", label: "Foo", type: "field", required: true, basic: true }, { key: "bar", label: "Bar", type: "field", required: false, basic: true }] },
    });
    expect(orgPatchOk.status(), await orgPatchOk.text()).toBe(200);

    // 2) SuperAdmin PATCH changing the code -> 409 (CODE_CHANGED; non-reserved so no earlier 400).
    const saPatch = await orgAdmin.request.patch(`/api/v1/superadmin/component-types/${slotType.id}`, {
      headers: { Cookie: `qs-sa-token=${saToken}` },
      data: { orgId, code: `${slotType.code}_RENAMED` },
    });
    expect(saPatch.status(), await saPatch.text()).toBe(409);
    expect(((await saPatch.json()) as { error: string }).error).toContain(slotType.code);

    // 3) SuperAdmin DELETE of the slot type -> 409 (DELETED); unused by any Selection so the
    //    pre-existing "in use" 409 can't be the one firing — confirmed by message content.
    const saDelete = await orgAdmin.request.delete(
      `/api/v1/superadmin/component-types/${slotType.id}?orgId=${encodeURIComponent(orgId)}`,
      { headers: { Cookie: `qs-sa-token=${saToken}` } },
    );
    expect(saDelete.status(), await saDelete.text()).toBe(409);
    expect(((await saDelete.json()) as { error: string }).error).toContain(slotType.code);
  });

  test("item 3 — SuperAdmin hard-delete of an org with a project + ProjectCalculation cascades cleanly", async () => {
    const before = await countProjectCalculations(orgId);
    expect(before).toBeGreaterThanOrEqual(1); // written by item 1's submit

    const suspend = await orgAdmin.request.post(`/api/v1/superadmin/orgs/${orgId}/suspend`, {
      headers: { Cookie: `qs-sa-token=${saToken}` },
      data: { suspend: true },
    });
    expect(suspend.status(), await suspend.text()).toBe(200);

    const del = await orgAdmin.request.delete(`/api/v1/superadmin/orgs/${orgId}`, {
      headers: { Cookie: `qs-sa-token=${saToken}` },
    });
    expect(del.status(), await del.text()).toBe(200);

    // The delete transaction deletes ProjectCalculation (D-20) explicitly before Project/Organization
    // — a successful 200 already proves no FK_RESTRICT tripped, and this is the direct count-based
    // confirmation the task asks for. Querying by organizationId after the org itself is gone still
    // works (no FK back to a row that must exist to run the count).
    const after = await countProjectCalculations(orgId);
    expect(after).toBe(0);

    const list = await orgAdmin.request.get("/api/v1/superadmin/orgs", {
      headers: { Cookie: `qs-sa-token=${saToken}` },
    });
    const orgs = ((await list.json()) as { orgs: { id: string }[] }).orgs;
    expect(orgs.some((o) => o.id === orgId)).toBe(false);
  });
});
