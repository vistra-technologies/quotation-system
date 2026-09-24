/**
 * Stage 25 Batch 2 — Summary/Quotation pill re-lock after partition edit.
 *
 * Two concerns:
 *
 * A) API regression: the six clearing paths wired in Stage 23 Batch 3 are still
 *    intact (partition geometry PATCH, replaceSides add/remove, Room delete, Floor
 *    delete, Selection config PATCH). These API tests are duplicated here so Batch 2
 *    owns its own coverage artifact; stage23-wiring.spec.ts remains the canonical
 *    record of that wiring's introduction.
 *
 * B) UI fix: after calling handleSave() (or any of the other client-side callbacks
 *    that trigger invalidation), design-workspace.tsx must call router.refresh() so
 *    the server-rendered layout re-fetches Project.designSubmittedAt and the
 *    Summary/Quotation pills lock immediately — without a manual page reload.
 *    This is the primary deliverable of Batch 2.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, orgUrl, apiSignIn } from "./helpers";
import {
  insertCalculation,
  setDesignSubmittedAt,
  readProjectState,
} from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const RUN = Date.now();
const PREFIX = `e2e-s25b2-${RUN}`;

let ctx: BrowserContext;
let page: Page;
const projectsToDelete: string[] = [];

const NO_CALC = { calcCount: 0, designSubmittedAt: null };

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await apiSignIn(page, ACME, "admin");
});

test.afterAll(async () => {
  for (const id of projectsToDelete) {
    await page.request
      .delete(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${id}`))
      .catch(() => {});
  }
  await ctx.close();
});

const A = (p: string) => apiUrl(ACME, `/api/v1/orgs/${ACME}${p}`);

async function newProject(name: string): Promise<string> {
  const res = await page.request.post(A("/projects"), {
    data: { name: `${PREFIX} ${name}`, currency: "AED" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id = ((await res.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push(id);
  return id;
}

/** Project + floor + room + one PARTITION wall. */
async function newWall(name: string) {
  const projectId = await newProject(name);
  const floor = await page.request.post(A("/floors"), {
    data: { projectId, label: `${PREFIX} F` },
  });
  expect(floor.status()).toBe(201);
  const floorId = ((await floor.json()) as { floor: { id: string } }).floor.id;
  const room = await page.request.post(A("/rooms"), {
    data: { floorId, label: `${PREFIX} R` },
  });
  expect(room.status()).toBe(201);
  const roomId = ((await room.json()) as { room: { id: string } }).room.id;
  const conv = await page.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        {
          kind: "PARTITION",
          turnDegrees: 90,
          label: `${PREFIX} W`,
          heightMm: 2400,
          widthMm: 2400,
        },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(conv.status(), await conv.text()).toBe(200);
  const partitionId = (
    (await conv.json()) as { room: { sides: { partitionId?: string }[] } }
  ).room.sides[0].partitionId!;
  return { projectId, floorId, roomId, partitionId };
}

/** Put the project in the "calculated + submitted" state. */
async function arm(projectId: string) {
  await insertCalculation(projectId);
  await setDesignSubmittedAt(projectId);
  const s = await readProjectState(projectId);
  expect(s.calcCount).toBe(1);
  expect(s.designSubmittedAt).not.toBeNull();
}

/** A one-section v2 design (2400mm wide) whose single cell is `h` tall. */
const v2 = (h: number) => ({
  schemaVersion: 2,
  sections: [
    { id: "s1", widthMm: 2400, cells: [{ id: "s1-c0", heightMm: h, selectionId: null }] },
  ],
});

// ── A) API regression tests ─────────────────────────────────────────────────

test("API: partition geometry PATCH deletes calc + clears designSubmittedAt", async () => {
  const { projectId, partitionId } = await newWall("api-part");
  await arm(projectId);

  const res = await page.request.patch(A(`/partitions/${partitionId}`), {
    data: { heightMm: 2500, design: v2(2500) },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("API: rooms/[id]/sides adding a partition invalidates", async () => {
  const { projectId, roomId, partitionId } = await newWall("api-sides-add");
  await arm(projectId);

  const res = await page.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, partitionId },
        {
          kind: "PARTITION",
          turnDegrees: 90,
          label: `${PREFIX} W2`,
          heightMm: 2400,
          widthMm: 1800,
        },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("API: rooms/[id]/sides removing a partition invalidates", async () => {
  const { projectId, roomId, partitionId } = await newWall("api-sides-rm");
  await arm(projectId);

  // Convert to PLAIN (remove the partition)
  const res = await page.request.patch(A(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  // The partition was removed — partitionId is gone; the calc must be cleared.
  void partitionId; // referenced only to satisfy TS
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("API: Room delete invalidates", async () => {
  const { projectId, roomId } = await newWall("api-roomdel");
  await arm(projectId);

  const res = await page.request.delete(A(`/rooms/${roomId}`));
  expect(res.status(), await res.text()).toBeLessThan(300);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("API: Floor delete invalidates", async () => {
  const { projectId, floorId } = await newWall("api-floordel");
  await arm(projectId);

  const res = await page.request.delete(A(`/floors/${floorId}`));
  expect(res.status(), await res.text()).toBeLessThan(300);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

test("API: Selection config PATCH invalidates", async () => {
  const projectId = await newProject("api-sel");
  const types = await page.request.get(A("/component-types"));
  const glass = (
    (await types.json()) as { componentTypes: { id: string; code: string }[] }
  ).componentTypes.find((c) => c.code === "GLASS");
  expect(glass, "acme-glass has a GLASS ComponentType").toBeTruthy();

  const sel = await page.request.post(A("/selections"), {
    data: {
      projectId,
      componentTypeId: glass!.id,
      label: `${PREFIX} g`,
      config: {},
      orderIndex: 0,
    },
  });
  expect(sel.status(), await sel.text()).toBe(201);
  const selId = ((await sel.json()) as { selection: { id: string } }).selection.id;
  await arm(projectId);

  const res = await page.request.patch(A(`/selections/${selId}`), {
    data: { config: { glassType: "x" } },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect(await readProjectState(projectId)).toMatchObject(NO_CALC);
});

// ── B) UI fix: pills lock immediately after handleSave(), without a page reload ─

test("UI: submit design → edit partition height → Summary/Quotation pills lock without reload", async () => {
  const { projectId, partitionId } = await newWall("ui-relock");

  // The Design page redirects to Project Details when selectionCount === 0 (Stage 19 Batch 4 gate).
  // Add a glass Selection so the page renders rather than redirecting.
  const types = await page.request.get(A("/component-types"));
  const glass = (
    (await types.json()) as { componentTypes: { id: string; code: string }[] }
  ).componentTypes.find((c) => c.code === "GLASS");
  expect(glass, "acme-glass has a GLASS ComponentType for the UI test").toBeTruthy();
  const selRes = await page.request.post(A("/selections"), {
    data: {
      projectId,
      componentTypeId: glass!.id,
      label: `${PREFIX} g-ui`,
      config: {},
      orderIndex: 0,
    },
  });
  expect(selRes.status(), await selRes.text()).toBe(201);

  await arm(projectId);

  // Navigate to the Design page.
  await page.goto(orgUrl(ACME, `/projects/${projectId}/design`));
  // Wait for the wizard breadcrumb nav to be visible.
  const nav = page.locator('nav[aria-label="Project wizard steps"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });

  // Pills should be enabled (links, not aria-disabled spans) because the project
  // is armed with designSubmittedAt set.
  const summaryLi = nav.locator("li").filter({ hasText: "Summary" });
  const quotationLi = nav.locator("li").filter({ hasText: "Quotation" });
  await expect(summaryLi.locator('span[aria-disabled="true"]')).toHaveCount(0);
  await expect(quotationLi.locator('span[aria-disabled="true"]')).toHaveCount(0);

  // Expand the room in the left rail — this also selects it and triggers a lazy
  // fetch of its partition rows.
  const roomBtn = page.locator("button").filter({ hasText: `${PREFIX} R` });
  await expect(roomBtn).toBeVisible({ timeout: 10_000 });
  await roomBtn.click();

  // Wait for the partition row to appear (lazy fetch after expand).
  const partitionRow = page.locator('[role="button"]').filter({ hasText: `${PREFIX} W` });
  await expect(partitionRow).toBeVisible({ timeout: 15_000 });

  // Click the partition row — enters Configure mode.
  await partitionRow.click();

  // In Configure mode: click the "Edit height" pencil button, change the value,
  // commit it. This dispatches SET_PARTITION_HEIGHT and marks isDirty = true.
  const editHeightBtn = page.locator('button[title="Edit height"]');
  await expect(editHeightBtn).toBeVisible({ timeout: 10_000 });
  await editHeightBtn.click();

  const heightInput = page.locator('input[aria-label="Partition height"]');
  await expect(heightInput).toBeVisible();
  await heightInput.fill("2500");
  await heightInput.press("Enter");

  // The Save button becomes active once isDirty is true.
  const saveBtn = page.locator("button").filter({ hasText: "Save changes" });
  await expect(saveBtn).toBeEnabled({ timeout: 5_000 });

  // Click Save — triggers handleSave() → updatePartition PATCH → clears
  // designSubmittedAt in DB → router.refresh() re-fetches the server layout.
  await saveBtn.click();

  // Wait for the PATCH to complete (the save button returns to "Saved" state
  // when isDirty goes back to false after a successful save).
  const savedBtn = page.locator("button").filter({ hasText: "Saved" });
  await expect(savedBtn).toBeVisible({ timeout: 15_000 });

  // The pills must now be locked — WITHOUT any manual page reload.
  // The fix: handleSave() now calls router.refresh() which causes the RSC layout
  // to re-render with the newly-null designSubmittedAt.
  await expect(summaryLi.locator('span[aria-disabled="true"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(quotationLi.locator('span[aria-disabled="true"]')).toHaveCount(1);

  void partitionId; // used implicitly via arm() and the PATCH performed by handleSave
});
