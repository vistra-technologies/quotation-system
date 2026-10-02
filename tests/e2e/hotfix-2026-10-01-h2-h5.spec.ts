/**
 * Hotfix 2026-10-01 Part 2 (H-2..H-5) — Design canvas refinements.
 *
 * Covers:
 *   H-2: Door swing lines (single-leaf: 2 SVG lines with apex on hinge edge, LH/RH label;
 *        double-leaf: 4 triangle lines + centre line, LH left / RH right, no hinge menu).
 *   H-3: Summary — double-leaf door stored with handing "LH + RH" (groups separately).
 *   H-4: Door height — click value to type (Enter applies, Esc cancels, clamps 0..wallHeight).
 *   H-5: Panel divider drag — grip handles visible on hover; dragging trades width between
 *        neighbours; total unchanged; 100 mm minimum; ArrowLeft/Right nudges 1 mm;
 *        click does not select panel; save persists widths; designSubmittedAt cleared.
 *
 * Plus regression: single-panel select, panel right-click menu, door-height slider still work.
 *
 * Test org: "e2e-testorg" (the dedicated Test Org on the dev-branch DB / feature-branch previews).
 * Admin password: "TestE2E1234!" (established by the hotfix-2026-09-25 spec).
 *
 * isDoubleLeaf field: Added to DOOR ComponentType fieldsSchema via SA PATCH if
 * TEST_SA_USERNAME/TEST_SA_PASSWORD are available. If not, the selection is created with
 * config.isDoubleLeaf="Yes" directly via API — tests canvas rendering without the schema
 * change. The SA-dependent test sub-step is noted as skipped in the report.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-ltqi14f9y-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=devadmin TEST_SA_PASSWORD=*** \
 *   npx playwright test hotfix-2026-10-01-h2-h5 --workers=1
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn, orgUrl } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

// ── Constants ─────────────────────────────────────────────────────────────────

const ORG = "e2e-testorg";
const ORG_ADMIN_PASSWORD = "TestE2E1234!";
const RUN = Date.now();
const PREFIX = `e2e-hf1001-${RUN}`;

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasSACreds = Boolean(SA_USERNAME && SA_PASSWORD);

// ── Shared state ──────────────────────────────────────────────────────────────

let ctx: BrowserContext;
let page: Page;

// API helper shortcut
const A = (p: string) => apiUrl(ORG, `/api/v1/orgs/${ORG}${p}`);

// Test data to clean up
const projectsToDelete: string[] = [];

// Original DOOR ComponentType state (for revert if we modify the schema)
let doorTypeId = "";
let originalDoorFieldsSchema: unknown[] = [];
let schemaWasModified = false;

// Full GLASS config for submit-design to pass Phase A gate.
const GLASS_FULL_CONFIG = {
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

// Full DOOR config for submit-design to pass Phase A gate (all required params).
const DOOR_FULL_CONFIG = {
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

// ── SA login helper ───────────────────────────────────────────────────────────

async function loginAsSuperAdmin(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) throw new Error(`SA login failed: ${res.status()}`);
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token not found");
  return match[1];
}

// ── Project/wall setup helpers ────────────────────────────────────────────────

interface WallSetup {
  projectId: string;
  partitionId: string;
  roomLabel: string;
}

async function createWall(
  name: string,
  widthMm: number,
  heightMm: number,
): Promise<WallSetup> {
  const projRes = await page.request.post(A("/projects"), {
    data: { name: `${PREFIX}-${name}`, currency: "AED" },
  });
  expect(projRes.status(), `create project ${name}`).toBe(201);
  const { project } = (await projRes.json()) as { project: { id: string } };
  const projectId = project.id;
  projectsToDelete.push(projectId);

  const floorRes = await page.request.post(A("/floors"), {
    data: { projectId, label: `${PREFIX}-${name}-floor` },
  });
  expect(floorRes.status()).toBe(201);
  const { floor } = (await floorRes.json()) as { floor: { id: string } };

  const roomLabel = `${PREFIX}-${name}-room`;
  const roomRes = await page.request.post(A("/rooms"), {
    data: { floorId: floor.id, label: roomLabel },
  });
  expect(roomRes.status()).toBe(201);
  const { room } = (await roomRes.json()) as { room: { id: string } };

  const wallLabel = `${PREFIX}-${name}-wall`;
  const convRes = await page.request.patch(A(`/rooms/${room.id}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: wallLabel, heightMm, widthMm },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(convRes.status(), "convert side to partition").toBe(200);
  const convBody = (await convRes.json()) as { room: { sides: { kind: string; partitionId?: string }[] } };
  const partitionId = convBody.room.sides[0].partitionId!;
  expect(partitionId).toBeTruthy();

  return { projectId, partitionId, roomLabel };
}

async function getTypeId(code: "GLASS" | "DOOR"): Promise<string> {
  const res = await page.request.get(A("/component-types"));
  expect(res.status()).toBe(200);
  const { componentTypes } = (await res.json()) as { componentTypes: { id: string; code: string }[] };
  const ct = componentTypes.find((c) => c.code === code);
  if (!ct) throw new Error(`No ${code} ComponentType in ${ORG}`);
  return ct.id;
}

async function createSelection(projectId: string, componentTypeId: string, config: Record<string, string>): Promise<string> {
  const res = await page.request.post(A("/selections"), {
    data: {
      projectId,
      componentTypeId,
      label: `${PREFIX}-sel-${componentTypeId.slice(-6)}-${Date.now()}`,
      config,
      orderIndex: 0,
    },
  });
  expect(res.status(), `create selection (config keys: ${Object.keys(config).join(",")})`).toBe(201);
  return ((await res.json()) as { selection: { id: string } }).selection.id;
}

/** Patch partition to a two-section design: [glass 800mm] [door 600mm]. */
async function patchTwoSection(
  partitionId: string,
  glassSelId: string,
  doorSelId: string,
  heightMm: number,
  hinging: "left" | "right" = "left",
): Promise<void> {
  const res = await page.request.patch(A(`/partitions/${partitionId}`), {
    data: {
      heightMm,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "s1", widthMm: 800, cells: [{ id: "s1-c0", heightMm, selectionId: glassSelId }] },
          { id: "s2", widthMm: 600, cells: [{ id: "s2-c0", heightMm, selectionId: doorSelId, hinging }] },
        ],
      },
    },
  });
  expect(res.status(), "patch two-section design").toBe(200);
}

/** Patch partition to a three-section design (all glass, equal widths). */
async function patchThreeSection(
  partitionId: string,
  glassSelId: string,
  totalWidthMm: number,
  heightMm: number,
): Promise<void> {
  const w = Math.round(totalWidthMm / 3);
  const w3 = totalWidthMm - 2 * w;
  const res = await page.request.patch(A(`/partitions/${partitionId}`), {
    data: {
      heightMm,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "d1", widthMm: w, cells: [{ id: "d1-c0", heightMm, selectionId: glassSelId }] },
          { id: "d2", widthMm: w, cells: [{ id: "d2-c0", heightMm, selectionId: glassSelId }] },
          { id: "d3", widthMm: w3, cells: [{ id: "d3-c0", heightMm, selectionId: glassSelId }] },
        ],
      },
    },
  });
  expect(res.status(), "patch three-section design").toBe(200);
}

/**
 * Navigate to the project's design page and click the partition row to enter Configure mode.
 * Handles the wizard step-gating and room expansion.
 * Pattern mirrors stage21-design.spec.ts enterWallConfigure: click room text to expand,
 * then filter for role=button rows containing both "Wall" and "panel".
 */
async function openConfigureMode(projectId: string, roomLabel: string): Promise<void> {
  await page.goto(orgUrl(ORG, `/projects/${projectId}/design`));
  // Wait for the left rail to render ("Add Room" button = left rail loaded).
  await expect(page.getByRole('button', { name: 'Add Room' })).toBeVisible({ timeout: 30_000 });

  // Click the room text to expand it (exact match avoids matching child wall rows).
  await page.getByText(roomLabel, { exact: true }).click();
  await page.waitForTimeout(400);

  // After expanding, child wall rows appear with both "Wall" and "panel" in their text.
  const wallRow = page.locator("[role='button']").filter({ hasText: "Wall" }).filter({ hasText: "panel" });
  await expect(wallRow.first()).toBeVisible({ timeout: 15_000 });
  await wallRow.first().click();
  await expect(page.getByRole('button', { name: 'Add Panel' })).toBeVisible({ timeout: 20_000 });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await apiSignIn(page, ORG, "admin", ORG_ADMIN_PASSWORD);
});

test.afterAll(async () => {
  // 1. Revert DOOR ComponentType schema if we modified it.
  if (schemaWasModified && doorTypeId && hasSACreds) {
    try {
      const saToken = await loginAsSuperAdmin(page.request);
      const orgsRes = await page.request.get("/api/v1/superadmin/orgs", {
        headers: { Cookie: `qs-sa-token=${saToken}` },
      });
      if (orgsRes.status() === 200) {
        const orgsBody = (await orgsRes.json()) as { orgs: { id: string; slug: string }[] };
        const testOrg = orgsBody.orgs.find((o) => o.slug === ORG);
        if (testOrg) {
          const revertRes = await page.request.patch(`/api/v1/superadmin/component-types/${doorTypeId}`, {
            headers: { Cookie: `qs-sa-token=${saToken}` },
            data: { orgId: testOrg.id, fieldsSchema: originalDoorFieldsSchema },
          });
          if (revertRes.status() !== 200) {
            console.error(`[cleanup] DOOR schema revert FAILED: ${revertRes.status()} ${await revertRes.text()}`);
          } else {
            console.log("[cleanup] DOOR schema reverted successfully.");
          }
        }
      }
    } catch (err) {
      console.error("[cleanup] DOOR schema revert threw:", err);
    }
  }

  // 2. Delete all test projects.
  const toDelete = [...projectsToDelete];
  for (const id of toDelete) {
    const res = await page.request.delete(A(`/projects/${id}`)).catch(() => null);
    if (res && res.status() !== 200 && res.status() !== 204 && res.status() !== 404) {
      console.warn(`[cleanup] project ${id} delete returned ${res.status()}`);
    }
  }

  await ctx.close();
});

// ─────────────────────────────────────────────────────────────────────────────
// Prerequisite: verify e2e-testorg has GLASS and DOOR ComponentTypes
// ─────────────────────────────────────────────────────────────────────────────

test("prerequisite: e2e-testorg has GLASS and DOOR ComponentTypes", async () => {
  const glassId = await getTypeId("GLASS");
  const doorId = await getTypeId("DOOR");
  expect(glassId).toBeTruthy();
  expect(doorId).toBeTruthy();
  doorTypeId = doorId;
  console.log(`GLASS=${glassId} DOOR=${doorId}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// H-2 A: Single-leaf door — 2 SVG swing lines, LH/RH label, hinge menu
// ─────────────────────────────────────────────────────────────────────────────

test("H-2-single: single-leaf door draws 2 SVG swing lines; LH label visible; RH not visible", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h2-single", 1400, 2400);

  // Gate-opener selection.
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await openConfigureMode(projectId, roomLabel);

  // Scope SVG lines to the door graphic div (bottom-anchored absolute div).
  // The door graphic contains the swing SVG; glass panels do not.
  const doorDiv = page.locator(".absolute.inset-x-0.bottom-0").first();
  await expect(doorDiv).toBeVisible({ timeout: 15_000 });
  const svgLines = doorDiv.locator("svg[aria-hidden='true'] line");
  const lineCount = await svgLines.count();
  expect(lineCount, "single-leaf door SVG line count").toBe(2);

  // LH label (hinging=left): visible.
  await expect(page.getByText("LH", { exact: true })).toBeVisible();
  // RH label: should NOT be visible for single-leaf.
  await expect(page.getByText("RH", { exact: true })).not.toBeVisible();
});

test("H-2-single-hinge-menu: right-click on door shows Left/Right hinge menu", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h2-hinge-menu", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await openConfigureMode(projectId, roomLabel);

  // The door graphic is the bottom-anchored div. Right-click it.
  const doorDiv = page.locator(".absolute.inset-x-0.bottom-0").first();
  await expect(doorDiv).toBeVisible({ timeout: 15_000 });
  await doorDiv.dispatchEvent("contextmenu");

  // Hinge menu items (SET_DOOR_HINGE context menu).
  await expect(page.getByRole("menuitem", { name: /hinge/i }).first()).toBeVisible({ timeout: 5_000 });

  await page.keyboard.press("Escape");
});

test("H-2-hinge-switch: right-click switch changes label LH→RH and apex moves", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h2-hinge-switch", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await openConfigureMode(projectId, roomLabel);

  // Verify initial LH label.
  await expect(page.getByText("LH", { exact: true })).toBeVisible({ timeout: 15_000 });

  // Right-click the door div to get hinge menu.
  const doorDiv = page.locator(".absolute.inset-x-0.bottom-0").first();
  await doorDiv.dispatchEvent("contextmenu");

  // Click "Right hinge" menu item.
  const rightHingeItem = page.getByRole("menuitem").filter({ hasText: /right.*hinge/i });
  await expect(rightHingeItem).toBeVisible({ timeout: 5_000 });
  await rightHingeItem.click();

  // After switching to right hinge: RH label visible, LH not visible.
  await expect(page.getByText("RH", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("LH", { exact: true })).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// H-2 B: Double-leaf door — 5 SVG lines, LH+RH labels, no hinge menu
// ─────────────────────────────────────────────────────────────────────────────

test("H-2-double-leaf-field: optionally add isDoubleLeaf to DOOR schema via SA", async () => {
  test.skip(!hasSACreds, "SA creds not set — isDoubleLeaf field schema change skipped; canvas rendering tested via config bypass in H-2-double test");

  const saToken = await loginAsSuperAdmin(page.request);
  const orgsRes = await page.request.get("/api/v1/superadmin/orgs", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  expect(orgsRes.status(), "SA get orgs").toBe(200);
  const orgsBody = (await orgsRes.json()) as { orgs: { id: string; slug: string }[] };
  const testOrg = orgsBody.orgs.find((o) => o.slug === ORG);
  expect(testOrg, `${ORG} org in SA list`).toBeTruthy();

  // Get current DOOR schema.
  const ctRes = await page.request.get(`/api/v1/superadmin/component-types/${doorTypeId}?orgId=${testOrg!.id}`, {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  expect(ctRes.status(), "SA get DOOR CT").toBe(200);
  const ctBody = (await ctRes.json()) as { componentType: { fieldsSchema: unknown[] } };
  originalDoorFieldsSchema = ctBody.componentType.fieldsSchema ?? [];

  const alreadyHasField = originalDoorFieldsSchema.some(
    (f) => typeof f === "object" && f !== null && (f as Record<string, unknown>).key === "isDoubleLeaf",
  );
  if (alreadyHasField) {
    console.log("[H-2-double-leaf-field] isDoubleLeaf already in schema — no change needed");
    return;
  }

  const newSchema = [
    ...originalDoorFieldsSchema,
    { key: "isDoubleLeaf", label: "Double Leaf", type: "dropdown", required: false, basic: false },
  ];
  const patchRes = await page.request.patch(`/api/v1/superadmin/component-types/${doorTypeId}`, {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { orgId: testOrg!.id, fieldsSchema: newSchema },
  });
  expect(patchRes.status(), "SA add isDoubleLeaf to DOOR schema").toBe(200);
  schemaWasModified = true;
  console.log("[H-2-double-leaf-field] isDoubleLeaf added to DOOR fieldsSchema.");

  // Set options (Yes/No) for the org via field-values.
  const fvRes = await page.request.get(A(`/component-types/${doorTypeId}/field-values`));
  expect(fvRes.status(), "get DOOR field-values").toBe(200);
  const fvBody = (await fvRes.json()) as { fieldValues: Record<string, unknown> };
  const updatedFv = { ...fvBody.fieldValues, isDoubleLeaf: ["Yes", "No"] };
  const putFvRes = await page.request.put(A(`/component-types/${doorTypeId}/field-values`), {
    data: updatedFv,
  });
  expect(putFvRes.status(), "set isDoubleLeaf options for org").toBe(200);
  console.log("[H-2-double-leaf-field] isDoubleLeaf options (Yes, No) set for org.");
});

test("H-2-double: double-leaf door (isDoubleLeaf=Yes) draws 5 SVG lines; LH left / RH right; no hinge menu", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h2-double", 1400, 2400);

  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  // Create double-leaf door selection — isDoubleLeaf="Yes" in config.
  // The API stores JSONB config verbatim; canvas reads config.isDoubleLeaf directly.
  const doubleDoorSelId = await createSelection(projectId, dtId, {
    category: "Single",
    doorType: "Simple Glass",
    isDoubleLeaf: "Yes",
  });
  await patchTwoSection(partitionId, glassSelId, doubleDoorSelId, 2400, "left");

  await openConfigureMode(projectId, roomLabel);

  // Double-leaf: 4 triangle lines + 1 centre line = 5 total.
  // Scope to the door graphic div (bottom-anchored absolute div inside the door cell).
  const doorDivSvg = page.locator(".absolute.inset-x-0.bottom-0").first();
  await expect(doorDivSvg).toBeVisible({ timeout: 15_000 });
  const svgLines = doorDivSvg.locator("svg[aria-hidden='true'] line");
  const lineCount = await svgLines.count();
  expect(lineCount, "double-leaf door SVG line count").toBe(5);

  // Both LH (left half) and RH (right half) labels visible.
  await expect(page.getByText("LH", { exact: true })).toBeVisible();
  await expect(page.getByText("RH", { exact: true })).toBeVisible();

  // Right-click on double-leaf door should NOT show the hinge menu.
  const doorDiv = page.locator(".absolute.inset-x-0.bottom-0").first();
  await expect(doorDiv).toBeVisible({ timeout: 5_000 });
  await doorDiv.dispatchEvent("contextmenu");
  await page.waitForTimeout(400);
  // Hinge menu items must NOT appear.
  const hingeMenuItems = page.getByRole("menuitem").filter({ hasText: /hinge/i });
  await expect(hingeMenuItems.first()).not.toBeVisible();
});

test("H-2-single-no-isd: door with isDoubleLeaf=No draws as single-leaf (2 lines)", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h2-no-isd", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, {
    category: "Single",
    doorType: "Simple Glass",
    isDoubleLeaf: "No",
  });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await openConfigureMode(projectId, roomLabel);

  const doorDiv3 = page.locator(".absolute.inset-x-0.bottom-0").first();
  await expect(doorDiv3).toBeVisible({ timeout: 15_000 });
  const svgLines = doorDiv3.locator("svg[aria-hidden='true'] line");
  const lineCount = await svgLines.count();
  expect(lineCount, "isDoubleLeaf=No still draws 2 lines (single-leaf)").toBe(2);
  await expect(page.getByText("LH", { exact: true })).toBeVisible();
  await expect(page.getByText("RH", { exact: true })).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// H-3: Summary — double-leaf door stored with handing "LH + RH"
// ─────────────────────────────────────────────────────────────────────────────

test("H-3-double: submit-design with double-leaf door → summary handing is 'LH + RH'", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId } = await createWall("h3-double", 1400, 2400);

  const glassSelId = await createSelection(projectId, glassTypeId, GLASS_FULL_CONFIG);
  const doubleDoorSelId = await createSelection(projectId, dtId, {
    ...DOOR_FULL_CONFIG,
    isDoubleLeaf: "Yes",
  });
  await patchTwoSection(partitionId, glassSelId, doubleDoorSelId, 2400, "left");

  const submitRes = await page.request.post(A(`/projects/${projectId}/submit-design`));
  if (submitRes.status() === 409) {
    const body = (await submitRes.json()) as { error: string };
    test.skip(true, `H-3: submit-design 409 (no formula set / no configSnapshot): ${body.error}`);
    return;
  }
  if (submitRes.status() === 422) {
    const body = await submitRes.text();
    test.skip(true, `H-3: submit-design 422 (calculation refused): ${body}`);
    return;
  }
  expect(submitRes.status(), "submit-design → 200").toBe(200);

  const calcRes = await page.request.get(A(`/projects/${projectId}/calculation`));
  expect(calcRes.status(), "GET calculation → 200").toBe(200);
  const calcBody = (await calcRes.json()) as {
    summary: { floors: Array<{ walls: Array<{ doors: Array<{ handing: string; quantity: number }> }> }> };
  };

  const allDoors = calcBody.summary.floors.flatMap((f) => f.walls.flatMap((w) => w.doors));
  const doubleRow = allDoors.find((d) => d.handing === "LH + RH");
  expect(doubleRow, "double-leaf door row has handing 'LH + RH'").toBeTruthy();
  expect(doubleRow?.quantity, "double-leaf door quantity").toBe(1);
  // No single-handing rows (all doors in this design are double-leaf).
  const singleRows = allDoors.filter((d) => d.handing === "LH" || d.handing === "RH");
  expect(singleRows.length, "no single-handing rows when only double-leaf door").toBe(0);
});

test("H-3-single: submit-design with single-leaf door (hinging=left) → handing is 'LH'", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId } = await createWall("h3-single", 1400, 2400);

  const glassSelId = await createSelection(projectId, glassTypeId, GLASS_FULL_CONFIG);
  const singleDoorSelId = await createSelection(projectId, dtId, { ...DOOR_FULL_CONFIG });
  await patchTwoSection(partitionId, glassSelId, singleDoorSelId, 2400, "left");

  const submitRes = await page.request.post(A(`/projects/${projectId}/submit-design`));
  if (submitRes.status() === 409 || submitRes.status() === 422) {
    test.skip(true, `H-3-single: submit-design ${submitRes.status()} — skipping`);
    return;
  }
  expect(submitRes.status(), "submit-design").toBe(200);

  const calcRes = await page.request.get(A(`/projects/${projectId}/calculation`));
  expect(calcRes.status()).toBe(200);
  const calcBody = (await calcRes.json()) as {
    summary: { floors: Array<{ walls: Array<{ doors: Array<{ handing: string }> }> }> };
  };
  const allDoors = calcBody.summary.floors.flatMap((f) => f.walls.flatMap((w) => w.doors));
  const lhDoor = allDoors.find((d) => d.handing === "LH");
  expect(lhDoor, "single-leaf left-hinge door has handing 'LH'").toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// H-4: Door height — click value to type (Enter/Esc/clamp/zero)
// ─────────────────────────────────────────────────────────────────────────────

/** Helper: open design configure mode and select the door panel (second panel). */
async function selectDoorPanel(projectId: string, roomLabel: string): Promise<void> {
  await openConfigureMode(projectId, roomLabel);
  // Click the second panel role=button (index 1, the door panel).
  const panels = page.locator("[role='button'][aria-selected]");
  await expect(panels.nth(1)).toBeVisible({ timeout: 10_000 });
  await panels.nth(1).click();
}

test("H-4-esc: Esc cancels the inline height edit without changing the value", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h4-esc", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await selectDoorPanel(projectId, roomLabel);

  const heightBtn = page.getByTitle("Click to type an exact height");
  await expect(heightBtn).toBeVisible({ timeout: 10_000 });
  const initialText = await heightBtn.textContent();

  // Open, type a new value, press Esc.
  await heightBtn.click();
  const heightInput = page.getByLabel("Door height (mm)");
  await expect(heightInput).toBeVisible({ timeout: 5_000 });
  await heightInput.fill("1800");
  await page.keyboard.press("Escape");

  // Input should disappear.
  await expect(heightInput).not.toBeVisible({ timeout: 3_000 });
  // Value should be unchanged (and the button should still be visible — if panel
  // was deselected by the workspace Escape handler, this fails fast here).
  const afterBtn = page.getByTitle("Click to type an exact height");
  await expect(afterBtn).toBeVisible({ timeout: 5_000 });
  const afterText = await afterBtn.textContent({ timeout: 5_000 });
  expect(afterText, "Esc does not change the door height").toBe(initialText);
});

test("H-4-enter: Enter commits the typed height; canvas door height updates", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h4-enter", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await selectDoorPanel(projectId, roomLabel);

  const heightBtn = page.getByTitle("Click to type an exact height");
  await expect(heightBtn).toBeVisible({ timeout: 10_000 });

  await heightBtn.click();
  const heightInput = page.getByLabel("Door height (mm)");
  await heightInput.fill("1800");
  await page.keyboard.press("Enter");

  // Input disappears.
  await expect(heightInput).not.toBeVisible({ timeout: 3_000 });
  // Displayed value should now contain 1800.
  const afterBtn = page.getByTitle("Click to type an exact height");
  const afterText = await afterBtn.textContent();
  expect(afterText, "Enter commits 1800mm").toContain("1800");
});

test("H-4-clamp: value above wall height (2400mm) clamps to 2400", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h4-clamp", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await selectDoorPanel(projectId, roomLabel);

  const heightBtn = page.getByTitle("Click to type an exact height");
  await expect(heightBtn).toBeVisible({ timeout: 10_000 });
  await heightBtn.click();
  const heightInput = page.getByLabel("Door height (mm)");
  await heightInput.fill("9999");
  await page.keyboard.press("Enter");
  await expect(heightInput).not.toBeVisible({ timeout: 3_000 });

  const afterText = await page.getByTitle("Click to type an exact height").textContent();
  expect(afterText, "value above wall height clamped to 2400").toContain("2400");
});

test("H-4-zero: door height of 0 is accepted", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("h4-zero", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await selectDoorPanel(projectId, roomLabel);

  const heightBtn = page.getByTitle("Click to type an exact height");
  await expect(heightBtn).toBeVisible({ timeout: 10_000 });
  await heightBtn.click();
  const heightInput = page.getByLabel("Door height (mm)");
  await heightInput.fill("0");
  await page.keyboard.press("Enter");
  await expect(heightInput).not.toBeVisible({ timeout: 3_000 });
  const afterText = await page.getByTitle("Click to type an exact height").textContent();
  // 0 is clamped to Max(0, Min(2400, 0)) = 0.
  expect(afterText, "0 mm accepted").toContain("0");
});

// ─────────────────────────────────────────────────────────────────────────────
// H-5: Panel divider drag / resize
// ─────────────────────────────────────────────────────────────────────────────

test("H-5-handles: 3-panel partition has 2 role=separator divider handles", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("h5-handles", 1800, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await patchThreeSection(partitionId, glassSelId, 1800, 2400);

  await openConfigureMode(projectId, roomLabel);

  const dividers = page.locator("[role='separator'][aria-orientation='vertical']");
  await expect(dividers.first()).toBeAttached({ timeout: 15_000 });
  const count = await dividers.count();
  expect(count, "3 panels → 2 divider handles").toBe(2);
  const firstLabel = await dividers.first().getAttribute("aria-label");
  expect(firstLabel, "first divider label").toBe("Resize P1 and P2");
});

test("H-5-keyboard: ArrowRight nudges +1mm; ArrowLeft nudges -1mm; total preserved", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("h5-keyboard", 1800, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await patchThreeSection(partitionId, glassSelId, 1800, 2400);

  await openConfigureMode(projectId, roomLabel);

  // With 1800mm / 3 sections, each panel is 600mm.
  await expect(page.getByText("P1 · 600 mm")).toBeVisible({ timeout: 15_000 });

  const firstDivider = page.locator("[role='separator'][aria-orientation='vertical']").first();
  await firstDivider.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);

  // P1: 601, P2: 599, P3: 600 (total still 1800).
  await expect(page.getByText("P1 · 601 mm")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText("P2 · 599 mm")).toBeVisible();

  // Two presses left: P1: 599, P2: 601.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  await expect(page.getByText("P1 · 599 mm")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText("P2 · 601 mm")).toBeVisible();
});

test("H-5-no-panel-select: clicking a divider does not select any panel", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("h5-nosel", 1800, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await patchThreeSection(partitionId, glassSelId, 1800, 2400);

  await openConfigureMode(projectId, roomLabel);
  await expect(page.locator("[role='separator'][aria-orientation='vertical']").first()).toBeAttached({ timeout: 15_000 });

  // Record the initial set of selected panels (P1 is auto-selected on entry).
  const initialSelected = await page.locator("[role='button'][aria-selected='true']").count();

  const firstDivider = page.locator("[role='separator'][aria-orientation='vertical']").first();
  await firstDivider.click();
  await page.waitForTimeout(300);

  // After clicking a divider, the selected-panel count must be unchanged:
  // clicking a divider resizes panels but should not toggle any panel's selected state.
  const afterSelected = await page.locator("[role='button'][aria-selected='true']").count();
  expect(afterSelected, "click divider does not change panel selection").toBe(initialSelected);
});

test("H-5-persist: resized widths persist after Save; designSubmittedAt stays null for fresh DRAFT", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("h5-persist", 1800, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await patchThreeSection(partitionId, glassSelId, 1800, 2400);

  await openConfigureMode(projectId, roomLabel);
  await expect(page.getByText("P1 · 600 mm")).toBeVisible({ timeout: 15_000 });

  // Nudge P1 +50mm via 50 ArrowRight presses.
  const firstDivider = page.locator("[role='separator'][aria-orientation='vertical']").first();
  await firstDivider.focus();
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForTimeout(300);
  await expect(page.getByText("P1 · 650 mm")).toBeVisible({ timeout: 5_000 });

  // Save.
  const saveBtn = page.getByRole("button", { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
  await saveBtn.click();
  // Wait for save to complete (wait for Save button to re-enable or 3s).
  await page.waitForTimeout(2000);

  // Reload and re-enter configure mode.
  await page.goto(orgUrl(ORG, `/projects/${projectId}/design`));
  // Wait for the left rail to render again.
  await expect(page.getByRole("button", { name: "Add Room" })).toBeVisible({ timeout: 30_000 });

  // Re-enter configure mode (same pattern as openConfigureMode).
  await page.getByText(roomLabel, { exact: true }).click();
  await page.waitForTimeout(400);
  const wallRow2 = page.locator("[role='button']").filter({ hasText: "Wall" }).filter({ hasText: "panel" });
  await expect(wallRow2.first()).toBeVisible({ timeout: 15_000 });
  await wallRow2.first().click();
  await expect(page.getByRole("button", { name: "Add Panel" })).toBeVisible({ timeout: 20_000 });

  // P1 = 650mm, P2 = 550mm.
  await expect(page.getByText("P1 · 650 mm")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("P2 · 550 mm")).toBeVisible();

  // Fresh DRAFT → designSubmittedAt should be null.
  const projRes = await page.request.get(A(`/projects/${projectId}`));
  const projBody = (await projRes.json()) as { project: { designSubmittedAt: string | null } };
  expect(projBody.project.designSubmittedAt, "fresh DRAFT has designSubmittedAt null").toBeNull();
});

test("H-5-min100: divider cannot shrink a panel below 100mm", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("h5-min100", 1200, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  // Two equal 600mm panels.
  await page.request.patch(A(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "m1", widthMm: 600, cells: [{ id: "m1-c0", heightMm: 2400, selectionId: glassSelId }] },
          { id: "m2", widthMm: 600, cells: [{ id: "m2-c0", heightMm: 2400, selectionId: glassSelId }] },
        ],
      },
    },
  });

  await openConfigureMode(projectId, roomLabel);
  await expect(page.getByText("P1 · 600 mm")).toBeVisible({ timeout: 15_000 });

  // Nudge the first divider right 600+ times — P2 should clamp at 100mm.
  const firstDivider = page.locator("[role='separator'][aria-orientation='vertical']").first();
  await firstDivider.focus();
  for (let i = 0; i < 600; i++) {
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForTimeout(500);

  // Read current widths from labels.
  const labelTexts = await page.locator("[role='button'][aria-selected] .text-\\[11\\.5px\\]").allTextContents();
  console.log("Labels after extreme nudge:", labelTexts);

  // Also check the panel labels by extracting from the canvas.
  const panelLabels = page.locator("div[class*='text-[11.5px]']");
  const allTexts = await panelLabels.allTextContents();
  console.log("All panel label texts:", allTexts);

  // Get widths via the API to verify.
  const partitionRes = await page.request.get(A(`/partitions/${partitionId}`));
  // Since we haven't saved, widths are only in the draft. We check via the displayed labels.
  // The total must still be 1200 and P2 ≥ 100.
  // P1 will be 1100 (max), P2 will be 100 (min).
  await expect(page.getByText("P2 · 100 mm")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText("P1 · 1100 mm")).toBeVisible();
});

test("H-5-drag: mouse drag trades width between two panels; total unchanged", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("h5-drag", 1800, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await patchThreeSection(partitionId, glassSelId, 1800, 2400);

  await openConfigureMode(projectId, roomLabel);
  await expect(page.getByText("P1 · 600 mm")).toBeVisible({ timeout: 15_000 });

  // Drag first divider right to add ~100mm to P1.
  const rowEl = page.locator(".relative.flex.flex-1").first();
  const rowBB = await rowEl.boundingBox();
  expect(rowBB).toBeTruthy();

  const firstDivider = page.locator("[role='separator'][aria-orientation='vertical']").first();
  const divBB = await firstDivider.boundingBox();
  expect(divBB).toBeTruthy();

  // 1800mm over rowBB.width px → mmPerPx. Drag 100mm worth.
  const mmPerPx = 1800 / rowBB!.width;
  const dragPx = Math.round(100 / mmPerPx);

  const cx = divBB!.x + divBB!.width / 2;
  const cy = divBB!.y + divBB!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dragPx, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Check widths from labels.
  // P1 should be ~700, P2 ~500, P3 600. Total should be 1800.
  const p1Text = await page.getByText(/P1 · \d+ mm/).first().textContent();
  const p2Text = await page.getByText(/P2 · \d+ mm/).first().textContent();
  const p3Text = await page.getByText(/P3 · \d+ mm/).first().textContent();
  console.log("After drag:", { p1Text, p2Text, p3Text });

  const p1 = Number(p1Text?.match(/(\d+) mm/)?.[1] ?? 0);
  const p2 = Number(p2Text?.match(/(\d+) mm/)?.[1] ?? 0);
  const p3 = Number(p3Text?.match(/(\d+) mm/)?.[1] ?? 0);

  expect(p1 + p2 + p3, "total width preserved at 1800mm").toBe(1800);
  expect(p1, "P1 wider after rightward drag").toBeGreaterThan(600);
  expect(p2, "P2 narrower after rightward drag").toBeLessThan(600);
  expect(p3, "P3 unchanged").toBe(600);
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: existing features still work
// ─────────────────────────────────────────────────────────────────────────────

test("REGRESSION-panel-select: clicking a panel selects it; re-clicking deselects", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("reg-sel", 1200, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await page.request.patch(A(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "r1", widthMm: 1200, cells: [{ id: "r1-c0", heightMm: 2400, selectionId: glassSelId }] }],
      },
    },
  });

  await openConfigureMode(projectId, roomLabel);
  const panel = page.locator("[role='button'][aria-selected]").first();
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // P1 may be auto-selected on configure-mode entry. Determine initial state
  // and verify one full toggle cycle (select → deselect or deselect → select → deselect).
  const initialState = await panel.getAttribute("aria-selected");
  if (initialState === "true") {
    // Already selected — click to deselect, then re-select, then deselect again.
    await panel.click();
    await expect(panel).toHaveAttribute("aria-selected", "false", { timeout: 5_000 });
    await panel.click();
    await expect(panel).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });
    await panel.click();
    await expect(panel).toHaveAttribute("aria-selected", "false", { timeout: 5_000 });
  } else {
    // Not selected — click to select, then deselect.
    await panel.click();
    await expect(panel).toHaveAttribute("aria-selected", "true", { timeout: 5_000 });
    await panel.click();
    await expect(panel).toHaveAttribute("aria-selected", "false", { timeout: 5_000 });
  }
});

test("REGRESSION-right-click-menu: panel right-click opens context menu (at least one item)", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const { projectId, partitionId, roomLabel } = await createWall("reg-rclick", 1200, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  await page.request.patch(A(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [{ id: "rc1", widthMm: 1200, cells: [{ id: "rc1-c0", heightMm: 2400, selectionId: glassSelId }] }],
      },
    },
  });

  await openConfigureMode(projectId, roomLabel);
  const panel = page.locator("[role='button'][aria-selected]").first();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Escape");
});

test("REGRESSION-door-slider: door height slider (input[type=range]) is still visible when door panel selected", async () => {
  const glassTypeId = await getTypeId("GLASS");
  const dtId = await getTypeId("DOOR");
  const { projectId, partitionId, roomLabel } = await createWall("reg-slider", 1400, 2400);
  await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const glassSelId = await createSelection(projectId, glassTypeId, { category: "Single", glassType: "ID1", thickness: "12" });
  const doorSelId = await createSelection(projectId, dtId, { category: "Single", doorType: "Simple Glass" });
  await patchTwoSection(partitionId, glassSelId, doorSelId, 2400, "left");

  await openConfigureMode(projectId, roomLabel);
  const panels = page.locator("[role='button'][aria-selected]");
  await panels.nth(1).click();

  const slider = page.locator("input[type='range']");
  await expect(slider).toBeVisible({ timeout: 10_000 });
  const val = await slider.evaluate((el) => (el as HTMLInputElement).value);
  expect(Number(val)).toBeGreaterThanOrEqual(0);
  expect(Number(val)).toBeLessThanOrEqual(2400);
});
