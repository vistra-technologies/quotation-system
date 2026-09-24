/**
 * Stage 25 Batch 9 — Problem popup (Submit Design → 422 + CalculationProblemReport).
 *
 * Scenario: a project with a partition whose v2 design has a cell with selectionId: null.
 * When the user clicks "Submit Design", the API returns 422 with a CalculationProblemReport
 * containing at least one DESIGN-scope CELL_UNASSIGNED problem.  The popup must appear,
 * group by scope, and its "Go →" link must navigate to the Design page in Configure mode
 * (design?partition=<partitionId>).
 *
 * Why acme-glass: seeded org with a GLASS ComponentType and an active formula set —
 * the submit-design gate requires both to be present before it even runs Phase A.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, orgUrl, orgUrlPattern, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const RUN = Date.now();
const PREFIX = `e2e-s25b9-${RUN}`;

let ctx: BrowserContext;
let page: Page;
let projectId: string;
let partitionId: string;
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

  // The CELL_UNASSIGNED message should mention something about the cell.
  // We just confirm at least one problem row is rendered in the DESIGN group.
  const problemRows = dialog.locator(".flex.items-start");
  await expect(problemRows.first()).toBeVisible();
});

// ─── UI: Go link navigates to design?partition=<partitionId> ─────────────────

test("UI: Go link in DESIGN scope group navigates to design?partition=<partitionId>", async () => {
  // The dialog from the previous test should still be open (serial mode, same page).
  // If it was closed, re-trigger.
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  const isVisible = await dialog.isVisible();
  if (!isVisible) {
    const submitBtn = page.locator("button").filter({ hasText: "Submit Design" });
    await submitBtn.click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  }

  // Find the Go link — it navigates to design?partition=<partitionId>.
  const goLink = dialog.locator('a:has-text("Go")').first();
  await expect(goLink).toBeVisible();

  // Verify the href is correct before clicking.
  const href = await goLink.getAttribute("href");
  expect(href).toContain(`/projects/${projectId}/design`);
  expect(href).toContain(`partition=${partitionId}`);

  // Click the Go link — closes the popup and navigates.
  await goLink.click();

  // Assert the URL now contains the partition deep-link.
  await page.waitForURL(
    orgUrlPattern(ACME, `/projects/${projectId}/design`),
    { timeout: 15_000 },
  );
  const url = page.url();
  expect(url).toContain(`partition=${partitionId}`);

  // The popup must be closed after clicking the Go link.
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});
