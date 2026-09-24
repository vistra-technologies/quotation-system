/**
 * Stage 25 Batch 9 — Problem popup (Submit Design → 422 + CalculationProblemReport).
 *
 * Two scenarios:
 *
 * A) DESIGN-scope: a project with a partition whose v2 design has a cell with selectionId: null.
 *    When the user clicks "Submit Design", the API returns 422 with a CalculationProblemReport
 *    containing at least one DESIGN-scope CELL_UNASSIGNED problem.  The popup must appear,
 *    group by scope, and its "Go" button must actually open Configure mode on the Design page.
 *
 * B) SELECTION-scope: a project with a partition whose cell is assigned to a GLASS Selection that
 *    has an empty config ({}).  Phase A passes (cell is assigned), but Phase B (buildSummary)
 *    finds that "glassType" — a required field in the acme-glass GLASS ComponentType schema —
 *    is blank, and emits a MISSING_PARAM (SELECTION scope) problem.  The popup must show the
 *    "Fill in these fields" group.
 *
 * Why acme-glass: seeded org with a GLASS ComponentType and an active formula set —
 * the submit-design gate requires both to be present before it even runs Phase A.
 * The GLASS ComponentType has `required: true` on its "glassType" field (component-catalog-seed.ts),
 * so a Selection with config: {} triggers MISSING_PARAM on Phase B.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, orgUrl, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const RUN = Date.now();
const PREFIX = `e2e-s25b9-${RUN}`;

let ctx: BrowserContext;
let page: Page;
// Scenario A: unassigned cell → DESIGN-scope CELL_UNASSIGNED
let projectId: string;
let partitionId: string;
// Scenario B: assigned cell with blank required config → SELECTION-scope MISSING_PARAM
let projectIdB: string;
let partitionIdB: string;
let selectionIdB: string;
const projectsToDelete: string[] = [];

const A = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);

// ─── v2 design with a single unassigned cell (triggers CELL_UNASSIGNED in Phase A) ─

const unassignedDesign = {
  schemaVersion: 2,
  sections: [
    {
      id: "s1",
      widthMm: 2400,
      cells: [{ id: "s1-c0", heightMm: 2400, selectionId: null }],
    },
  ],
};

// ─── Setup ───────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await apiSignIn(page, ACME, "admin");

  // ── Scenario A: project with an unassigned cell ───────────────────────────

  // 1. Create project
  const projRes = await page.request.post(A("/projects"), {
    data: { name: `${PREFIX} proj`, currency: "AED" },
  });
  expect(projRes.status(), await projRes.text()).toBe(201);
  projectId = ((await projRes.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push(projectId);

  // 2. Floor → Room → Partition
  const floorRes = await page.request.post(A("/floors"), {
    data: { projectId, label: `${PREFIX} F1` },
  });
  expect(floorRes.status()).toBe(201);
  const floorId = ((await floorRes.json()) as { floor: { id: string } }).floor.id;

  const roomRes = await page.request.post(A("/rooms"), {
    data: { floorId, label: `${PREFIX} R1` },
  });
  expect(roomRes.status()).toBe(201);
  const roomId = ((await roomRes.json()) as { room: { id: string } }).room.id;

  const sidesRes = await page.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        {
          kind: "PARTITION",
          turnDegrees: 90,
          label: `${PREFIX} W1`,
          heightMm: 2400,
          widthMm: 2400,
        },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(sidesRes.status(), await sidesRes.text()).toBe(200);
  partitionId = (
    (await sidesRes.json()) as { room: { sides: { partitionId?: string }[] } }
  ).room.sides[0].partitionId!;
  expect(partitionId, "sides[0] must be a PARTITION with an id").toBeTruthy();

  // 3. Add a GLASS Selection so the Design page does not redirect (selectionCount > 0 gate).
  const typesRes = await page.request.get(A("/component-types"));
  const glass = (
    (await typesRes.json()) as { componentTypes: { id: string; code: string }[] }
  ).componentTypes.find((c) => c.code === "GLASS");
  expect(glass, "acme-glass org must have a GLASS ComponentType").toBeTruthy();

  const selRes = await page.request.post(A("/selections"), {
    data: {
      projectId,
      componentTypeId: glass!.id,
      label: `${PREFIX} g`,
      config: {},
      orderIndex: 0,
    },
  });
  expect(selRes.status(), await selRes.text()).toBe(201);

  // 4. PATCH the partition with a v2 design that has an unassigned cell → CELL_UNASSIGNED.
  const patchRes = await page.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2400, design: unassignedDesign },
  });
  expect(patchRes.status(), await patchRes.text()).toBe(200);

  // ── Scenario B: project with an assigned cell but blank required config ────

  // 1. Create project B
  const projResB = await page.request.post(A("/projects"), {
    data: { name: `${PREFIX} proj-b`, currency: "AED" },
  });
  expect(projResB.status(), await projResB.text()).toBe(201);
  projectIdB = ((await projResB.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push(projectIdB);

  // 2. Floor → Room → Partition for project B
  const floorResB = await page.request.post(A("/floors"), {
    data: { projectId: projectIdB, label: `${PREFIX} F1-B` },
  });
  expect(floorResB.status()).toBe(201);
  const floorIdB = ((await floorResB.json()) as { floor: { id: string } }).floor.id;

  const roomResB = await page.request.post(A("/rooms"), {
    data: { floorId: floorIdB, label: `${PREFIX} R1-B` },
  });
  expect(roomResB.status()).toBe(201);
  const roomIdB = ((await roomResB.json()) as { room: { id: string } }).room.id;

  const sidesResB = await page.request.patch(A(`/rooms/${roomIdB}/sides`), {
    data: {
      sides: [
        {
          kind: "PARTITION",
          turnDegrees: 90,
          label: `${PREFIX} W1-B`,
          heightMm: 2400,
          widthMm: 2400,
        },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(sidesResB.status(), await sidesResB.text()).toBe(200);
  partitionIdB = (
    (await sidesResB.json()) as { room: { sides: { partitionId?: string }[] } }
  ).room.sides[0].partitionId!;
  expect(partitionIdB).toBeTruthy();

  // 3. Create a GLASS Selection with config: {} (blank required fields — glassType is required).
  const selResB = await page.request.post(A("/selections"), {
    data: {
      projectId: projectIdB,
      componentTypeId: glass!.id,
      label: `${PREFIX} g-b`,
      config: {},
      orderIndex: 0,
    },
  });
  expect(selResB.status(), await selResB.text()).toBe(201);
  selectionIdB = ((await selResB.json()) as { selection: { id: string } }).selection.id;

  // 4. PATCH partition B with a v2 design whose cell points to the blank GLASS Selection.
  //    Phase A passes (cell IS assigned), Phase B fails (glassType is required but blank).
  const assignedDesign = {
    schemaVersion: 2,
    sections: [
      {
        id: "s1",
        widthMm: 2400,
        cells: [{ id: "s1-c0", heightMm: 2400, selectionId: selectionIdB }],
      },
    ],
  };
  const patchResB = await page.request.patch(A(`/partitions/${partitionIdB}`), {
    data: { heightMm: 2400, design: assignedDesign },
  });
  expect(patchResB.status(), await patchResB.text()).toBe(200);
});

test.afterAll(async () => {
  for (const id of projectsToDelete) {
    await page.request
      .delete(A(`/projects/${id}`))
      .catch(() => {});
  }
  await ctx.close();
});

// ─── API: submit-design returns 422 with a DESIGN-scope problem ───────────────

test("API: submit-design with unassigned cell returns 422 + CELL_UNASSIGNED", async () => {
  const res = await page.request.post(A(`/projects/${projectId}/submit-design`));
  expect(res.status()).toBe(422);
  const body = (await res.json()) as {
    ok: boolean;
    problems: { kind: string; scope: string; message: string; locus?: { partitionId?: string } }[];
    problemCount: number;
  };
  expect(body.ok).toBe(false);
  expect(body.problemCount).toBeGreaterThan(0);
  const designProblem = body.problems.find((p) => p.scope === "DESIGN");
  expect(designProblem, "must have at least one DESIGN-scope problem").toBeTruthy();
  expect(designProblem!.kind).toBe("CELL_UNASSIGNED");
  expect(designProblem!.locus?.partitionId).toBe(partitionId);
});

// ─── API: submit-design for project B returns 422 with SELECTION-scope problem ─

test("API: submit-design with blank required GLASS config returns 422 + MISSING_PARAM (SELECTION scope)", async () => {
  const res = await page.request.post(A(`/projects/${projectIdB}/submit-design`));
  expect(res.status()).toBe(422);
  const body = (await res.json()) as {
    ok: boolean;
    problems: { kind: string; scope: string }[];
    problemCount: number;
  };
  expect(body.ok).toBe(false);
  const selProblem = body.problems.find((p) => p.scope === "SELECTION");
  expect(selProblem, "must have at least one SELECTION-scope problem").toBeTruthy();
  expect(selProblem!.kind).toBe("MISSING_PARAM");
});

// ─── UI: popup appears and shows the DESIGN scope group ──────────────────────

test("UI: Submit Design button triggers problem popup with DESIGN scope group", async () => {
  await page.goto(orgUrl(ACME, `/projects/${projectId}/design`));

  // Wait for the Design page to render (wizard breadcrumb confirms RSC loaded).
  const nav = page.locator('nav[aria-label="Project wizard steps"]');
  await expect(nav).toBeVisible({ timeout: 20_000 });

  // Click Submit Design — triggers handleSubmitDesign() → 422 → popup.
  const submitBtn = page.locator("button").filter({ hasText: "Submit Design" });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  await submitBtn.click();

  // The problem popup dialog must appear.
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Title matches the t("designCannotBeSubmitted") key.
  await expect(dialog.locator("#problem-popup-title")).toHaveText(
    "Design cannot be submitted",
  );

  // The DESIGN scope group header must be visible ("Fix your design").
  await expect(dialog.locator("text=Fix your design")).toBeVisible();

  // At least one problem row must be rendered (data-testid="problem-row" avoids
  // matching the dialog header, which the previous ".flex.items-start" locator did).
  const problemRows = dialog.locator('[data-testid="problem-row"]');
  await expect(problemRows.first()).toBeVisible();
});

// ─── UI: Go button opens Configure mode (not just changes the URL) ────────────

test("UI: Go button in DESIGN scope group actually opens Configure mode", async () => {
  // The dialog from the previous test should still be open (serial mode, same page).
  // If it was closed, re-trigger.
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  const isVisible = await dialog.isVisible();
  if (!isVisible) {
    const submitBtn = page.locator("button").filter({ hasText: "Submit Design" });
    await submitBtn.click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  }

  // Find the Go button — rendered as a <button> (not a <Link>) on the Design page
  // so the workspace enters Configure mode via enterConfigureMode() instead of a
  // URL-only navigation that would leave the view in Layout mode.
  const goBtn = dialog.locator('button:has-text("Go")').first();
  await expect(goBtn).toBeVisible();

  // Click Go — closes the popup and calls enterConfigureMode(partitionId).
  await goBtn.click();

  // The popup must close.
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });

  // Configure mode must actually open: the "Back to Room Layout" button is rendered
  // exclusively by <ConfigureMode> (design/configure-mode.tsx), so its presence
  // proves the workspace entered Configure mode — not just that the URL changed.
  // This is the assertion that the previous test lacked (R4 finding #1).
  const backButton = page.locator('[aria-label="Back to Room Layout"]');
  await expect(backButton).toBeVisible({ timeout: 10_000 });
});

// ─── UI: SELECTION-scope popup group is shown for project B ──────────────────

test("UI: Submit Design for project with blank required GLASS config shows SELECTION scope group", async () => {
  await page.goto(orgUrl(ACME, `/projects/${projectIdB}/design`));

  const nav = page.locator('nav[aria-label="Project wizard steps"]');
  await expect(nav).toBeVisible({ timeout: 20_000 });

  const submitBtn = page.locator("button").filter({ hasText: "Submit Design" });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  await submitBtn.click();

  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // The SELECTION scope group header must be visible ("Fill in these fields").
  await expect(dialog.locator("text=Fill in these fields")).toBeVisible();

  // At least one problem row in the SELECTION group must be rendered.
  const problemRows = dialog.locator('[data-testid="problem-row"]');
  await expect(problemRows.first()).toBeVisible();

  // Close the popup for cleanup.
  const closeBtn = dialog.locator("button").filter({ hasText: "Close" });
  await closeBtn.click();
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});
