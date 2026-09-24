/**
 * Stage 26 Batch 3 — Recompute button e2e.
 *
 * Two flows against a submitted `cloisons` project (same seed pattern as
 * stage26-summary-page.spec.ts / stage26-calculation-api.spec.ts):
 *   1. Clean DRAFT project — clicking Recompute updates `computedAt` (200 path,
 *      `router.refresh()` re-fetches the Batch 1 GET .../calculation route).
 *   2. Same project, dependency broken (the GLASS selection's frame profile
 *      InventoryItem deactivated) — clicking Recompute opens the ProblemPopup with an
 *      INVENTORY-scope problem, and the on-screen KPI/Material List figures (and the
 *      stored `computedAt`) are left unchanged (422 path, stored row untouched — G-3).
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
 *   npx playwright test stage26-recompute --workers=1
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, orgUrl, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const CLOISONS = "cloisons";
const RUN = Date.now();
const PREFIX = `e2e-s26b3-${RUN}`;

let ctx: BrowserContext;
let page: Page;
const projectsToDelete: string[] = [];
/** Restored in afterAll — an InventoryItem flipped inactive to exercise the 422 path. */
let deactivatedItemId: string | null = null;

const C = (p: string) => apiUrl(CLOISONS, `/api/v1/orgs/${CLOISONS}${p}`);

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await apiSignIn(page, CLOISONS, "admin");
});

test.afterAll(async () => {
  if (deactivatedItemId) {
    await page.request
      .patch(C(`/inventory/${deactivatedItemId}`), { data: { active: true } })
      .catch(() => {});
  }
  for (const id of projectsToDelete) {
    await page.request.delete(C(`/projects/${id}`)).catch(() => {});
  }
  await ctx.close();
});

/** Same required fields as stage26-summary-page.spec.ts's cloisons GLASS selection. */
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

async function cloisonsTypeId(code: string): Promise<string> {
  const res = await page.request.get(C("/component-types"));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { componentTypes: { id: string; code: string }[] };
  const ct = body.componentTypes.find((c) => c.code === code);
  expect(ct, `cloisons has a ${code} ComponentType`).toBeTruthy();
  return ct!.id;
}

async function inventoryItemIdByCode(code: string): Promise<string> {
  const res = await page.request.get(C("/inventory"));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: { id: string; code: string }[] };
  const item = body.items.find((i) => i.code === code);
  expect(item, `cloisons has an InventoryItem with code ${code}`).toBeTruthy();
  return item!.id;
}

async function newSubmittedProject(): Promise<{ projectId: string; partitionId: string }> {
  const proj = await page.request.post(C("/projects"), {
    data: { name: `${PREFIX} main`, currency: "AED" },
  });
  expect(proj.status(), `create project: ${await proj.text()}`).toBe(201);
  const projectId = ((await proj.json()) as { project: { id: string } }).project.id;
  projectsToDelete.push(projectId);

  const flr = await page.request.post(C("/floors"), { data: { projectId, label: `${PREFIX} F` } });
  expect(flr.status()).toBe(201);
  const floorId = ((await flr.json()) as { floor: { id: string } }).floor.id;

  const rm = await page.request.post(C("/rooms"), { data: { floorId, label: `${PREFIX} R` } });
  expect(rm.status()).toBe(201);
  const roomId = ((await rm.json()) as { room: { id: string } }).room.id;

  const sides = await page.request.patch(C(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        {
          kind: "PARTITION",
          turnDegrees: 90,
          label: `${PREFIX} Wall A`,
          heightMm: 2400,
          widthMm: 3000,
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

  const glassTypeId = await cloisonsTypeId("GLASS");
  const sel = await page.request.post(C("/selections"), {
    data: {
      projectId,
      componentTypeId: glassTypeId,
      label: `${PREFIX} GLASS`,
      config: GLASS_CFG,
      orderIndex: 0,
    },
  });
  expect(sel.status(), await sel.text()).toBe(201);
  const glassId = ((await sel.json()) as { selection: { id: string } }).selection.id;

  const patch = await page.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: glassId }] },
        ],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await page.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);

  return { projectId, partitionId };
}

test("Recompute on a clean DRAFT project updates computedAt", async () => {
  const { projectId } = await newSubmittedProject();

  const before = await page.request.get(C(`/projects/${projectId}/calculation`));
  expect(before.status(), await before.text()).toBe(200);
  const beforeCalc = (await before.json()) as { computedAt: string };

  await page.goto(orgUrl(CLOISONS, `/projects/${projectId}/summary`));

  const recomputeBtn = page.getByRole("button", { name: /^Recompute$/ });
  await expect(recomputeBtn).toBeEnabled();
  await recomputeBtn.click();

  // Briefly shows the loading label, then re-enables once router.refresh() lands.
  await expect(page.getByRole("button", { name: /Recomputing…/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Recompute$/ })).toBeEnabled({ timeout: 20_000 });

  const after = await page.request.get(C(`/projects/${projectId}/calculation`));
  expect(after.status(), await after.text()).toBe(200);
  const afterCalc = (await after.json()) as { computedAt: string };

  expect(new Date(afterCalc.computedAt).getTime()).toBeGreaterThan(
    new Date(beforeCalc.computedAt).getTime(),
  );
});

test("Recompute after breaking a dependency opens the problem popup and leaves stored figures unchanged", async () => {
  const { projectId } = await newSubmittedProject();

  const before = await page.request.get(C(`/projects/${projectId}/calculation`));
  expect(before.status(), await before.text()).toBe(200);
  const beforeCalc = (await before.json()) as {
    computedAt: string;
    materialList: unknown[];
  };

  // Break a dependency: deactivate an InventoryItem the GLASS selection's design depends on.
  const itemId = await inventoryItemIdByCode("GLASS-ACGSK-01");
  const deactivate = await page.request.patch(C(`/inventory/${itemId}`), {
    data: { active: false },
  });
  expect(deactivate.status(), await deactivate.text()).toBe(200);
  deactivatedItemId = itemId;

  await page.goto(orgUrl(CLOISONS, `/projects/${projectId}/summary`));

  const materialRowCountBefore = await page
    .locator("table")
    .nth(1)
    .locator("tbody tr td:first-child.text-center")
    .count();

  const recomputeBtn = page.getByRole("button", { name: /^Recompute$/ });
  await recomputeBtn.click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator('[data-testid="problem-row"]').first()).toBeVisible();
  await expect(dialog).toContainText(/Inventory|INVENTORY/i);

  // Stored row is untouched — no router.refresh() happened on the 422 path.
  const materialRowCountAfter = await page
    .locator("table")
    .nth(1)
    .locator("tbody tr td:first-child.text-center")
    .count();
  expect(materialRowCountAfter).toBe(materialRowCountBefore);

  const after = await page.request.get(C(`/projects/${projectId}/calculation`));
  expect(after.status(), await after.text()).toBe(200);
  const afterCalc = (await after.json()) as { computedAt: string; materialList: unknown[] };
  expect(afterCalc.computedAt).toBe(beforeCalc.computedAt);
  expect(afterCalc.materialList.length).toBe(beforeCalc.materialList.length);

  // Restore immediately (not just at afterAll) so a mid-run failure doesn't leave the
  // org's catalog broken for any concurrently-running spec against the same cloisons org.
  const reactivate = await page.request.patch(C(`/inventory/${itemId}`), {
    data: { active: true },
  });
  expect(reactivate.status(), await reactivate.text()).toBe(200);
  deactivatedItemId = null;
});
