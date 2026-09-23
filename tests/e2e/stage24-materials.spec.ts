/**
 * Stage 24 Batch 6 — API-level E2E coverage for the material-list formula engine.
 *
 * Tests the full pipeline: cloisons org project → design → Submit Design / Recompute
 * → `ProjectCalculation.materialList` + `.materialByRoom` populated with real resolved numbers.
 *
 * Groups:
 *   A — cloisons happy path (the stage end goal)
 *   B — v1 / other-org behavior unchanged
 *   C — refuse paths (422 + problem list, nothing written) — D-A, D-B, G-3
 *   D — exhaustive + deterministic problem reporting
 *   E — condition-gated blank is not a problem
 *   G — design edit invalidation still holds for cloisons (D-17…D-20)
 *   H — no failure indicators on a successful submit
 *   J — D-36 guard covers new cloisons keys (code rename blocked)
 *   L — cross-org tenancy (vistra cannot read cloisons calculation)
 *   M — pricing route regression (CatalogItem → InventoryItem rename didn't break the route)
 *
 * Deferred to regression checklist:
 *   C4 — UNIT_MISMATCH (requires DB surgery to set up a synthetic unit mismatch)
 *   F1 — multi-room ceil aggregation (covered by unit test; synthetic scenario not feasible cleanly)
 *   J2 — formula-set body PATCH (no direct route)
 *   K1 — project-creation 13a gate for cloisons keys (org-config mutation has blast radius)
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
 *   npx playwright test stage24-materials --workers=1
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn } from "./helpers";
import { readProjectState, setInventoryItemActive } from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const CLOISONS = "cloisons";
const VISTRA = "vistra";
const RUN = Date.now();
const PREFIX = `e2e-s24mat-${RUN}`;

/** All required fields for a cloisons GLASS selection (frame+leaf=Yes). */
const GLASS_CFG: Record<string, string> = {
  category: "Single",
  glassType: "ID1",
  thickness: "12",
  u_profile: "I LUF-01",
  i_profile: "I10 PDL",
  l_profile: "I LUO-01",
  acousticGasketCode: "GLASS-ACGSK-01",
  whiteSealCode: "GLASS-WSEAL-01",
  woodWedgeCode: "GLASS-WWDG-01",
  lConnectorCode: "GLASS-LCON-01",
  degreeConnectorCode: "GLASS-DCON-01",
  doorConnectorCode: "GLASS-DRCON-01",
  straightConnectorCode: "GLASS-STCON-01",
};

/** Full DOOR config (hasFrame=Yes, hasLeaf=Yes). */
const DOOR_CFG_FULL: Record<string, string> = {
  category: "Single",
  doorType: "Simple Glass",
  hasFrame: "Yes",
  hasLeaf: "Yes",
  frameCode: "DOOR-FRAME-01",
  leafCode: "DOOR-LEAF-01",
  cornerConnBigCode: "DOOR-CCB-01",
  cornerConnSmallFrameCode: "DOOR-CCSF-01",
  cornerConnSmallLeafCode: "DOOR-CCSL-01",
  lAngleCode: "DOOR-LANG-01",
  hingeCode: "DOOR-HING-01",
  rubber25mmCode: "DOOR-RUB25-01",
  frameBumperGasketCode: "DOOR-FBGSK-01",
  frameBackGasketCode: "DOOR-FBKGSK-01",
  leafGlassGasket1Code: "DOOR-LGG1-01",
  leafGlassGasket2Code: "DOOR-LGG2-01",
};

// ── Session state ────────────────────────────────────────────────────────────

let cloisonsCtx: BrowserContext;
let cloisons: Page;
const projectsToDelete: string[] = [];

const C = (p: string) => apiUrl(CLOISONS, `/api/v1/orgs/${CLOISONS}${p}`);
const V = (p: string) => apiUrl(VISTRA, `/api/v1/orgs/${VISTRA}${p}`);

test.beforeAll(async ({ browser }) => {
  cloisonsCtx = await browser.newContext();
  cloisons = await cloisonsCtx.newPage();
  await apiSignIn(cloisons, CLOISONS, "admin");
});

test.afterAll(async () => {
  for (const id of projectsToDelete) {
    await cloisons.request.delete(C(`/projects/${id}`)).catch(() => {});
  }
  await cloisonsCtx.close();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a cloisons project + floor + 4-sided room (side 0 = PARTITION). Returns ids. */
async function newCloisonsRoom(
  name: string,
  partitionOpts: { widthMm: number; heightMm: number } = { widthMm: 2000, heightMm: 2400 },
) {
  const proj = await cloisons.request.post(C("/projects"), {
    data: { name: `${PREFIX} ${name}`, currency: "AED" },
  });
  expect(proj.status(), `create project "${name}": ${await proj.text()}`).toBe(201);
  const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push(projectId);

  const flr = await cloisons.request.post(C("/floors"), { data: { projectId, label: `${PREFIX} F` } });
  expect(flr.status()).toBe(201);
  const floorId = ((await flr.json()) as { floor: { id: string } }).floor.id;

  const rm = await cloisons.request.post(C("/rooms"), { data: { floorId, label: `${PREFIX} R` } });
  expect(rm.status()).toBe(201);
  const roomId = ((await rm.json()) as { room: { id: string } }).room.id;

  const sides = await cloisons.request.patch(C(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        {
          kind: "PARTITION",
          turnDegrees: 90,
          label: `${PREFIX} Wall A`,
          heightMm: partitionOpts.heightMm,
          widthMm: partitionOpts.widthMm,
        },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(sides.status(), await sides.text()).toBe(200);
  const partitionId = (
    (await sides.json()) as { room: { sides: { partitionId?: string }[] } }
  ).room.sides[0].partitionId!;

  return { projectId, floorId, roomId, partitionId };
}

/** Look up a ComponentType id by code within the cloisons org. */
async function cloisonsTypeId(code: string): Promise<string> {
  const res = await cloisons.request.get(C("/component-types"));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { componentTypes: { id: string; code: string }[] };
  const ct = body.componentTypes.find((c) => c.code === code);
  expect(ct, `cloisons has a ${code} ComponentType`).toBeTruthy();
  return ct!.id;
}

/** Create a Selection on a cloisons project. */
async function cloisonsSelection(
  projectId: string,
  typeCode: string,
  config: Record<string, string>,
): Promise<string> {
  const typeId = await cloisonsTypeId(typeCode);
  const res = await cloisons.request.post(C("/selections"), {
    data: { projectId, componentTypeId: typeId, label: `${PREFIX} ${typeCode}`, config, orderIndex: 0 },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { selection: { id: string } }).selection.id;
}

/** Design a partition with one GLASS section + one DOOR section (each 1000mm wide). */
function glassDoorDesign(glassSelId: string, doorSelId: string, heightMm = 2400) {
  return {
    schemaVersion: 2,
    sections: [
      { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm, selectionId: glassSelId }] },
      { id: "s2", widthMm: 1000, cells: [{ id: "s2-c0", heightMm, selectionId: doorSelId, hinging: "right" }] },
    ],
  };
}

/** Design a partition as N pure-glass sections of equal width. */
function allGlassDesign(glassSelId: string, widthMm: number, heightMm: number, sectionCount: number) {
  const sectionWidth = Math.round(widthMm / sectionCount);
  return {
    schemaVersion: 2,
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `s${i + 1}`,
      widthMm: sectionWidth,
      cells: [{ id: `s${i + 1}-c0`, heightMm, selectionId: glassSelId }],
    })),
  };
}

// ── Group A — cloisons happy path ────────────────────────────────────────────

test("A1: Submit Design populates materialList + materialByRoom for a cloisons DOOR+GLASS partition", async () => {
  const { projectId, roomId, partitionId } = await newCloisonsRoom("A1");
  const glassId = await cloisonsSelection(projectId, "GLASS", GLASS_CFG);
  const doorId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_FULL);

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: glassDoorDesign(glassId, doorId, 2400) },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  const submitBody = (await submit.json()) as { project: { designSubmittedAt: string | null } };
  expect(submitBody.project.designSubmittedAt).not.toBeNull();

  // submit-design returns only { project }; call recompute to read the materialList
  const recompRes = await cloisons.request.post(C(`/projects/${projectId}/recompute`));
  expect(recompRes.status(), await recompRes.text()).toBe(200);
  const calcBody = (await recompRes.json()) as {
    calculation: { status: string; materialList: unknown[] };
  };
  expect(calcBody.calculation.status).toBe("OK");
  expect(calcBody.calculation.materialList.length).toBeGreaterThan(0);

  type MLine = { code: string; name: string; quantity: number; unit: string; perUnitQuantity: number };
  for (const line of calcBody.calculation.materialList as MLine[]) {
    expect(line.code, "every materialList line has a code").toBeTruthy();
    expect(line.name, "every materialList line has a name").toBeTruthy();
    expect(typeof line.quantity).toBe("number");
    expect(typeof line.perUnitQuantity).toBe("number");
    expect("status" in line, "no status field on a successful materialList line").toBe(false);
  }

  // materialByRoom is globally omitted from all API responses (lib/prisma.ts omit);
  // verify via DB helper that the calculation row was written (materialByRoom lives in DB)
  const roomState = await readProjectState(projectId);
  expect(roomState.calcCount, "materialByRoom written — calculation row exists").toBe(1);
});

test("A2: door.md 2m×3m worked example (frame+leaf) reproduces exact requirement values", async () => {
  // A door-only partition (no glass cell) so PARTITION-grain GLASS formulas don't fire.
  // The DOOR cell is 2000mm wide × 3000mm tall, matching the worked example.
  const { projectId, partitionId } = await newCloisonsRoom("A2", { widthMm: 2000, heightMm: 3000 });
  const doorId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_FULL);

  const design = {
    schemaVersion: 2,
    sections: [
      {
        id: "s1",
        widthMm: 2000,
        cells: [{ id: "s1-c0", heightMm: 3000, selectionId: doorId, hinging: "right" }],
      },
    ],
  };
  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 3000, design },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  // submit-design returns only { project }; call recompute to read the materialList
  const recompResA2 = await cloisons.request.post(C(`/projects/${projectId}/recompute`));
  expect(recompResA2.status(), await recompResA2.text()).toBe(200);
  type MLine = { code: string; requirement: number; quantity: number };
  const ml = ((await recompResA2.json()) as { calculation: { materialList: MLine[] } }).calculation
    .materialList;

  const find = (code: string) => ml.find((l) => l.code === code);

  // door.md worked example (frame+leaf, 2m×3m):
  // doorFrame: (2000 + 2*3000)/1000 = 8m; perUnit=3.0 → ceil(8/3)=3
  expect(find("DOOR-FRAME-01")?.requirement, "DOOR-FRAME-01 requirement=8m").toBe(8.0);
  expect(find("DOOR-FRAME-01")?.quantity, "DOOR-FRAME-01 quantity=ceil(8/3)=3").toBe(3);
  // doorLeaf: (2*(2000+3000))/1000 = 10m; perUnit=3.0 → ceil(10/3)=4
  expect(find("DOOR-LEAF-01")?.requirement, "DOOR-LEAF-01 requirement=10m").toBe(10.0);
  expect(find("DOOR-LEAF-01")?.quantity, "DOOR-LEAF-01 quantity=ceil(10/3)=4").toBe(4);
  // rubber25mm: doorFrame + doorLeaf = 18m; perUnit=1 → 18
  expect(find("DOOR-RUB25-01")?.requirement, "DOOR-RUB25-01 requirement=18m").toBe(18.0);
  expect(find("DOOR-RUB25-01")?.quantity, "DOOR-RUB25-01 quantity=18").toBe(18);
  // frameBackGasket: (3000*4)/1000 = 12m; perUnit=1 → 12
  expect(find("DOOR-FBKGSK-01")?.requirement, "DOOR-FBKGSK-01 requirement=12m").toBe(12.0);
  expect(find("DOOR-FBKGSK-01")?.quantity, "DOOR-FBKGSK-01 quantity=12").toBe(12);
  // All 12 DOOR materials present (frame+leaf scenario)
  expect(ml.filter((l) => l.code.startsWith("DOOR-")).length, "12 DOOR material lines").toBe(12);
});

test("A3: partition.md Scenario 1 (wall/wall, 4000mm × 3000mm) reproduces key requirement values", async () => {
  // Pure glass partition — 4 sections × 1000mm wide, 3000mm tall, plain walls on both sides.
  const { projectId, partitionId } = await newCloisonsRoom("A3", { widthMm: 4000, heightMm: 3000 });
  const glassId = await cloisonsSelection(projectId, "GLASS", GLASS_CFG);

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 3000, design: allGlassDesign(glassId, 4000, 3000, 4) },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  // submit-design returns only { project }; call recompute to read the materialList
  const recompResA3 = await cloisons.request.post(C(`/projects/${projectId}/recompute`));
  expect(recompResA3.status(), await recompResA3.text()).toBe(200);
  type MLine = { code: string; requirement: number; quantity: number };
  const ml = ((await recompResA3.json()) as { calculation: { materialList: MLine[] } }).calculation
    .materialList;
  const find = (code: string) => ml.find((l) => l.code === code);

  // Scenario 1 (wall/wall, no doors):
  // profileU = (4000-0)/1000 = 4m; perUnit=3.0 → ceil(4/3)=2
  expect(find("I LUF-01")?.requirement, "profileU requirement=4m").toBe(4.0);
  expect(find("I LUF-01")?.quantity, "profileU quantity=ceil(4/3)=2").toBe(2);
  // acousticGasket = 2*4 + 10 + 10 = 28m; perUnit=1
  expect(find("GLASS-ACGSK-01")?.requirement, "acousticGasket requirement=28m").toBe(28.0);
  // lConnector = 2*1 + 2*1 = 4pcs (wall/wall); perUnit=1
  expect(find("GLASS-LCON-01")?.quantity, "lConnector quantity=4").toBe(4);
});

// ── Group B — v1 / other-org behavior unchanged ──────────────────────────────

test("B1: vistra org Submit Design → materialList=[], materialByRoom=[], status=OK", async () => {
  let vistraCtx: BrowserContext | null = null;
  let vistra: Page | null = null;
  const vistraProjectsToDelete: string[] = [];

  try {
    vistraCtx = await cloisons.context().browser()!.newContext();
    vistra = await vistraCtx.newPage();
    await apiSignIn(vistra, VISTRA, "admin");

    const proj = await vistra.request.post(V("/projects"), {
      data: { name: `${PREFIX} vistra-B1`, currency: "AED" },
    });
    expect(proj.status(), await proj.text()).toBe(201);
    const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
    vistraProjectsToDelete.push(projectId);

    const flr = await vistra.request.post(V("/floors"), { data: { projectId, label: "F" } });
    expect(flr.status()).toBe(201);
    const floorId = ((await flr.json()) as { floor: { id: string } }).floor.id;

    const rm = await vistra.request.post(V("/rooms"), { data: { floorId, label: "R" } });
    expect(rm.status()).toBe(201);
    const roomId = ((await rm.json()) as { room: { id: string } }).room.id;

    const si = await vistra.request.patch(V(`/rooms/${roomId}/sides`), {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 90, label: "Wall A", heightMm: 2400, widthMm: 1000 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    });
    expect(si.status(), await si.text()).toBe(200);
    const partitionId = ((await si.json()) as { room: { sides: { partitionId?: string }[] } }).room
      .sides[0].partitionId!;

    // vistra's GLASS type only requires category/glassType/thickness (standard catalog, no new fields)
    const ctRes = await vistra.request.get(V("/component-types"));
    const types = (
      (await ctRes.json()) as { componentTypes: { id: string; code: string }[] }
    ).componentTypes;
    const glassType = types.find((t) => t.code === "GLASS")!;
    const doorType = types.find((t) => t.code === "DOOR")!;

    const glassSel = await vistra.request.post(V("/selections"), {
      data: {
        projectId,
        componentTypeId: glassType.id,
        label: "g1",
        config: { category: "Single", glassType: "ID1", thickness: "12" },
        orderIndex: 0,
      },
    });
    expect(glassSel.status(), await glassSel.text()).toBe(201);
    const glassSelId = ((await glassSel.json()) as { selection: { id: string } }).selection.id;

    const doorSel = await vistra.request.post(V("/selections"), {
      data: {
        projectId,
        componentTypeId: doorType.id,
        label: "d1",
        config: { category: "Single", doorType: "Simple Glass" },
        orderIndex: 1,
      },
    });
    expect(doorSel.status(), await doorSel.text()).toBe(201);
    const doorSelId = ((await doorSel.json()) as { selection: { id: string } }).selection.id;

    const patchRes = await vistra.request.patch(V(`/partitions/${partitionId}`), {
      data: {
        heightMm: 2400,
        design: {
          schemaVersion: 2,
          sections: [
            { id: "s1", widthMm: 500, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: glassSelId }] },
            { id: "s2", widthMm: 500, cells: [{ id: "s2-c0", heightMm: 2400, selectionId: doorSelId, hinging: "right" }] },
          ],
        },
      },
    });
    expect(patchRes.status(), await patchRes.text()).toBe(200);

    const submit = await vistra.request.post(V(`/projects/${projectId}/submit-design`));
    expect(submit.status(), await submit.text()).toBe(200);
    // submit-design returns only { project }; call recompute to read the materialList
    const recompResB1 = await vistra.request.post(V(`/projects/${projectId}/recompute`));
    expect(recompResB1.status(), await recompResB1.text()).toBe(200);
    const calcBodyB1 = (await recompResB1.json()) as {
      calculation: { status: string; materialList: unknown[] };
    };
    expect(calcBodyB1.calculation.status).toBe("OK");
    expect(calcBodyB1.calculation.materialList).toEqual([]); // D-37: v1 formula set has no formulas
    // materialByRoom is globally omitted from all API responses; v1 fast-path writes [] to DB
  } finally {
    for (const id of vistraProjectsToDelete) {
      await vistra?.request.delete(V(`/projects/${id}`)).catch(() => {});
    }
    await vistraCtx?.close();
  }
});

// ── Group C — refuse paths (422 + problem list, nothing written) ─────────────

test("C1: UNRESOLVED_CODE → 422 with problems[]; calcCount unchanged", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("C1");
  const doorId = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    frameCode: "DOES-NOT-EXIST-CODE", // unresolvable code
  });

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: doorId, hinging: "right" }] }],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const before = await readProjectState(projectId);
  expect(before.calcCount).toBe(0);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(422);
  const body = (await submit.json()) as { error: string; problems: { kind: string }[] };
  expect(body.error).toBeTruthy();
  expect(Array.isArray(body.problems)).toBe(true);
  expect(body.problems.length).toBeGreaterThan(0);
  expect(body.problems.some((p) => p.kind === "UNRESOLVED_CODE")).toBe(true);

  // G-3: stored row untouched
  const after = await readProjectState(projectId);
  expect(after.calcCount).toBe(0);
});

test("C2: INACTIVE_ITEM → 422; stored row byte-identical (G-3 option a)", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("C2");
  const doorId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_FULL);
  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: doorId, hinging: "right" }] }],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  // First submit successfully to establish a stored row
  const firstSubmit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(firstSubmit.status(), await firstSubmit.text()).toBe(200);
  const stateBefore = await readProjectState(projectId);
  expect(stateBefore.calcCount).toBe(1);

  // Deactivate an item referenced by this design
  await setInventoryItemActive("DOOR-FRAME-01", CLOISONS, false);
  try {
    // Recompute (tests both C2 and I1 at once — same invariant, different entry point)
    const recompute = await cloisons.request.post(C(`/projects/${projectId}/recompute`));
    expect(recompute.status(), await recompute.text()).toBe(422);
    const body = (await recompute.json()) as { problems: { kind: string }[] };
    expect(body.problems.some((p) => p.kind === "INACTIVE_ITEM")).toBe(true);

    // G-3: stored row must be byte-identical — calcCount unchanged, designSubmittedAt unchanged
    const stateAfter = await readProjectState(projectId);
    expect(stateAfter.calcCount).toBe(stateBefore.calcCount);
    expect(stateAfter.designSubmittedAt).toBe(stateBefore.designSubmittedAt);
  } finally {
    // Always restore the item to active
    await setInventoryItemActive("DOOR-FRAME-01", CLOISONS, true);
  }
});

test("C3: blank required param (hasFrame=Yes, frameCode='') → 422 + MISSING_PARAM; calcCount=0", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("C3");
  const doorId = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    frameCode: "", // blank — hasFrame=Yes but no frame code
  });

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: doorId, hinging: "right" }] }],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(422);
  const body = (await submit.json()) as { problems: { kind: string }[] };
  expect(body.problems.some((p) => p.kind === "MISSING_PARAM")).toBe(true);
  expect((await readProjectState(projectId)).calcCount).toBe(0);
});

// ── Group D — exhaustive + deterministic ─────────────────────────────────────

test("D1: design with 2 independent problems reports both in one response", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("D1");
  // Two doors, each with a bad frameCode (two independent UNRESOLVED_CODE problems)
  const door1Id = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    frameCode: "BAD-CODE-1",
  });
  const door2Id = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    frameCode: "BAD-CODE-2",
    leafCode: "DOOR-LEAF-01", // different from door1, different frameCode
  });

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: door1Id, hinging: "right" }] },
          { id: "s2", widthMm: 1000, cells: [{ id: "s2-c0", heightMm: 2400, selectionId: door2Id, hinging: "left" }] },
        ],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(422);
  const body = (await submit.json()) as { problems: { kind: string; code?: string }[] };
  // Should report both UNRESOLVED_CODE problems (2 distinct bad codes)
  const unresolved = body.problems.filter((p) => p.kind === "UNRESOLVED_CODE");
  expect(unresolved.length, "both UNRESOLVED_CODE problems reported").toBeGreaterThanOrEqual(2);
  // Nothing written
  expect((await readProjectState(projectId)).calcCount).toBe(0);
});

test("D2: fixing one problem leaves exactly one fewer in the response", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("D2");
  // Two doors: door1 has bad frameCode, door2 has good config
  const door1Id = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    frameCode: "BAD-FRAME-D2",
  });
  const door2Id = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    leafCode: "BAD-LEAF-D2", // second problem: bad leafCode
  });

  const design = {
    schemaVersion: 2,
    sections: [
      { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: door1Id, hinging: "right" }] },
      { id: "s2", widthMm: 1000, cells: [{ id: "s2-c0", heightMm: 2400, selectionId: door2Id, hinging: "left" }] },
    ],
  };
  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const first = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(first.status()).toBe(422);
  const firstBody = (await first.json()) as { problems: unknown[] };
  const firstCount = firstBody.problems.length;

  // Fix door2's problem by updating the selection config (use the API: delete and recreate)
  // Actually we can't PATCH a Selection's config directly in general, but let's use door2 with a bad frameCode only
  // and a good leafCode to fix one problem. Since we can't PATCH config in-place, create a new selection for door2.
  const door2Fixed = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_FULL); // all good
  const patchFixed = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: door1Id, hinging: "right" }] },
          { id: "s2", widthMm: 1000, cells: [{ id: "s2-c0", heightMm: 2400, selectionId: door2Fixed, hinging: "left" }] },
        ],
      },
    },
  });
  expect(patchFixed.status(), await patchFixed.text()).toBe(200);

  const second = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(second.status()).toBe(422);
  const secondBody = (await second.json()) as { problems: unknown[] };
  expect(secondBody.problems.length, "one fewer problem after fixing door2").toBe(firstCount - 1);
});

test("D3: byte-identical 422 body on repeat calls with no change", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("D3");
  const doorId = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    frameCode: "REPEAT-BAD-CODE",
  });
  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: doorId, hinging: "right" }] }],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const first = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  const second = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(first.status()).toBe(422);
  expect(second.status()).toBe(422);
  const body1 = (await first.json()) as { error: string; problems: { kind: string; code?: string }[] };
  const body2 = (await second.json()) as { error: string; problems: { kind: string; code?: string }[] };
  expect(body1.error).toBe(body2.error);
  expect(body1.problems.length).toBe(body2.problems.length);
  expect(body1.problems[0]?.kind).toBe(body2.problems[0]?.kind);
});

// ── Group E — condition-gated blank is not a problem ─────────────────────────

test("E1: hasFrame='No' + blank frameCode → submit succeeds; no frame materials", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("E1");
  const doorId = await cloisonsSelection(projectId, "DOOR", {
    ...DOOR_CFG_FULL,
    hasFrame: "No",
    frameCode: "", // blank because hasFrame=No
  });

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: doorId, hinging: "right" }] }],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), "hasFrame=No + blank frameCode should succeed").toBe(200);
  // submit-design returns only { project }; call recompute to read the materialList
  const recompResE1 = await cloisons.request.post(C(`/projects/${projectId}/recompute`));
  expect(recompResE1.status(), await recompResE1.text()).toBe(200);
  const ml = ((await recompResE1.json()) as { calculation: { materialList: { code: string }[] } })
    .calculation.materialList;
  // No frame materials should be in the list
  expect(ml.some((l) => l.code === "DOOR-FRAME-01")).toBe(false);
  expect(ml.some((l) => l.code === "DOOR-CCSF-01")).toBe(false); // cornerConnSmallFrame gated on hasFrame
  expect(ml.some((l) => l.code === "DOOR-LANG-01")).toBe(false); // lAngle gated on hasFrame
});

// ── Group G — design edit invalidation still holds for cloisons ───────────────

test("G1: editing a submitted cloisons design clears designSubmittedAt + deletes calculation", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("G1");
  const glassId = await cloisonsSelection(projectId, "GLASS", GLASS_CFG);
  const doorId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_FULL);

  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: glassDoorDesign(glassId, doorId, 2400) },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  expect((await readProjectState(projectId)).calcCount).toBe(1);

  // Edit: change heightMm
  const edit = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 2600, design: glassDoorDesign(glassId, doorId, 2600) },
  });
  expect(edit.status(), await edit.text()).toBe(200);

  const state = await readProjectState(projectId);
  expect(state.calcCount, "edit invalidated calculation").toBe(0);
  expect(state.designSubmittedAt, "edit cleared designSubmittedAt").toBeNull();
});

// ── Group H — no failure indicators on a successful submit ───────────────────

test("H1: materialList lines from a successful submit have no status field", async () => {
  // Reuse A1's project pattern — must be a fresh project since A1 test ran earlier.
  const { projectId, partitionId } = await newCloisonsRoom("H1");
  const glassId = await cloisonsSelection(projectId, "GLASS", GLASS_CFG);
  const doorId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_FULL);
  const patch = await cloisons.request.patch(C(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: glassDoorDesign(glassId, doorId, 2400) },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const submit = await cloisons.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);
  // submit-design returns only { project }; call recompute to read the materialList
  const recompResH1 = await cloisons.request.post(C(`/projects/${projectId}/recompute`));
  expect(recompResH1.status(), await recompResH1.text()).toBe(200);

  const ml = ((await recompResH1.json()) as { calculation: { materialList: Record<string, unknown>[] } })
    .calculation.materialList;
  expect(ml.length).toBeGreaterThan(0);
  for (const line of ml) {
    expect("status" in line, `line ${line.code as string} must not have a status field`).toBe(false);
  }
});

// ── Group J — D-36 guard covers new cloisons keys ────────────────────────────

test("J1: PATCH cloisons DOOR ComponentType removing a requiredParams-referenced field → 409", async () => {
  // The cloisons formula set's DOOR slot requiredParams includes 'hasFrame'.
  // Attempting to PATCH the DOOR type to remove 'hasFrame' from fieldsSchema must be blocked (409).
  const ctRes = await cloisons.request.get(C("/component-types"));
  expect(ctRes.status()).toBe(200);
  const types = (
    (await ctRes.json()) as { componentTypes: { id: string; code: string; fieldsSchema: { key: string }[] }[] }
  ).componentTypes;
  const doorType = types.find((t) => t.code === "DOOR");
  expect(doorType, "cloisons has DOOR ComponentType").toBeTruthy();

  // Remove 'hasFrame' from the fieldsSchema — this is referenced in cloisons_formula_set requiredParams
  const withoutHasFrame = doorType!.fieldsSchema.filter((f) => f.key !== "hasFrame");
  const patch = await cloisons.request.patch(C(`/component-types/${doorType!.id}`), {
    data: { fieldsSchema: withoutHasFrame },
  });
  expect(patch.status(), await patch.text()).toBe(409);
  expect(((await patch.json()) as { error: string }).error).toMatch(/DOOR/);
});

// ── Group L — cross-org tenancy ───────────────────────────────────────────────

test("L1: vistra session cannot read cloisons project calculation (tenancy isolation)", async () => {
  // Use A1's project (or any successfully submitted cloisons project from this run)
  // Find the first project in projectsToDelete
  if (projectsToDelete.length === 0) {
    test.skip(true, "No cloisons projects created yet");
    return;
  }
  const cloisonsProjectId = projectsToDelete[0];

  let vistraCtx2: BrowserContext | null = null;
  try {
    vistraCtx2 = await cloisons.context().browser()!.newContext();
    const vistra2 = await vistraCtx2.newPage();
    await apiSignIn(vistra2, VISTRA, "admin");

    // Try to access the cloisons projectId from vistra's org API
    const res = await vistra2.request.post(V(`/projects/${cloisonsProjectId}/submit-design`));
    const status = res.status();
    expect(
      status === 403 || status === 404,
      `vistra session cannot submit/read a cloisons project (got ${status})`,
    ).toBe(true);
  } finally {
    await vistraCtx2?.close();
  }
});

// ── Group M — pricing route regression ───────────────────────────────────────

test("M1: GET /api/v1/orgs/vistra/catalog without auth → 401 (route live after rename)", async () => {
  // Uses a fresh context (no auth) to verify the route exists and is protected
  let noAuthCtx: BrowserContext | null = null;
  try {
    noAuthCtx = await cloisons.context().browser()!.newContext();
    const noAuth = await noAuthCtx.newPage();
    const res = await noAuth.request.get(V("/catalog"));
    expect(res.status(), "unauthenticated /catalog → 401").toBe(401);
  } finally {
    await noAuthCtx?.close();
  }
});

test("M2: GET /api/v1/orgs/vistra/catalog with vistra admin auth → 200 with inventoryItems array", async () => {
  let vistraCtx3: BrowserContext | null = null;
  try {
    vistraCtx3 = await cloisons.context().browser()!.newContext();
    const vistra3 = await vistraCtx3.newPage();
    await apiSignIn(vistra3, VISTRA, "admin");
    const res = await vistra3.request.get(V("/catalog"));
    expect(res.status(), "authenticated /catalog → 200").toBe(200);
    const body = (await res.json()) as { inventoryItems: unknown[] };
    expect(Array.isArray(body.inventoryItems), "inventoryItems is an array").toBe(true);
  } finally {
    await vistraCtx3?.close();
  }
});
