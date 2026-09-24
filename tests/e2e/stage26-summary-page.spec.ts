/**
 * Stage 26 Batch 2 — Summary page UI e2e.
 *
 * Builds a submitted `cloisons` project (a GLASS section + two DOOR sections in different
 * categories, matching the real catalog Stage 24/25's own specs use) and asserts on the rendered
 * page per stage-26.md Batch 2's checklist:
 *   - Both the KPI table and Material List table render.
 *   - Door rows are split by category (≥2 distinct category values present).
 *   - The rendered Material List row count equals a parallel GET .../calculation call's
 *     `materialList.length`.
 *   - No "null" and no "mm mm" text anywhere on the page.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
 *   npx playwright test stage26-summary-page --workers=1
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, orgUrl, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const CLOISONS = "cloisons";
const RUN = Date.now();
const PREFIX = `e2e-s26b2-${RUN}`;

let ctx: BrowserContext;
let page: Page;
const projectsToDelete: string[] = [];

const C = (p: string) => apiUrl(CLOISONS, `/api/v1/orgs/${CLOISONS}${p}`);

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await apiSignIn(page, CLOISONS, "admin");
});

test.afterAll(async () => {
  for (const id of projectsToDelete) {
    await page.request.delete(C(`/projects/${id}`)).catch(() => {});
  }
  await ctx.close();
});

/** All required fields for a cloisons GLASS selection (frame+leaf=Yes) — same catalog Stage 24/25 use. */
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

/** Full DOOR config (hasFrame=Yes, hasLeaf=Yes), category "Single". */
const DOOR_CFG_SINGLE: Record<string, string> = {
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

/** Same, but a different category ("Double") — the invariant this spec exists to check (S26-3). */
const DOOR_CFG_DOUBLE: Record<string, string> = {
  ...DOOR_CFG_SINGLE,
  category: "Double",
};

async function newCloisonsRoom(name: string) {
  const proj = await page.request.post(C("/projects"), {
    data: { name: `${PREFIX} ${name}`, currency: "AED" },
  });
  expect(proj.status(), `create project "${name}": ${await proj.text()}`).toBe(201);
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

  return { projectId, partitionId };
}

async function cloisonsTypeId(code: string): Promise<string> {
  const res = await page.request.get(C("/component-types"));
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { componentTypes: { id: string; code: string }[] };
  const ct = body.componentTypes.find((c) => c.code === code);
  expect(ct, `cloisons has a ${code} ComponentType`).toBeTruthy();
  return ct!.id;
}

async function cloisonsSelection(
  projectId: string,
  typeCode: string,
  config: Record<string, string>,
): Promise<string> {
  const typeId = await cloisonsTypeId(typeCode);
  const res = await page.request.post(C("/selections"), {
    data: { projectId, componentTypeId: typeId, label: `${PREFIX} ${typeCode}`, config, orderIndex: 0 },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { selection: { id: string } }).selection.id;
}

test("Summary page renders KPI + Material List tables with doors split by category", async () => {
  const { projectId, partitionId } = await newCloisonsRoom("main");

  const glassId = await cloisonsSelection(projectId, "GLASS", GLASS_CFG);
  const doorSingleId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_SINGLE);
  const doorDoubleId = await cloisonsSelection(projectId, "DOOR", DOOR_CFG_DOUBLE);

  const patch = await page.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "s1", widthMm: 1000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: glassId }] },
          {
            id: "s2",
            widthMm: 1000,
            cells: [{ id: "s2-c0", heightMm: 2400, selectionId: doorSingleId, hinging: "right" }],
          },
          {
            id: "s3",
            widthMm: 1000,
            cells: [{ id: "s3-c0", heightMm: 2400, selectionId: doorDoubleId, hinging: "left" }],
          },
        ],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);

  const submit = await page.request.post(C(`/projects/${projectId}/submit-design`));
  expect(submit.status(), await submit.text()).toBe(200);

  // Parallel GET .../calculation call to compare against the rendered row count.
  const calcRes = await page.request.get(C(`/projects/${projectId}/calculation`));
  expect(calcRes.status(), await calcRes.text()).toBe(200);
  const calc = (await calcRes.json()) as { materialList: unknown[] };
  expect(calc.materialList.length).toBeGreaterThan(0);

  await page.goto(orgUrl(CLOISONS, `/projects/${projectId}/summary`));

  // Both tables render.
  const kpiHeading = page.getByText("Project KPIs", { exact: true });
  const materialHeading = page.getByText("Material List", { exact: true });
  await expect(kpiHeading).toBeVisible();
  await expect(materialHeading).toBeVisible();

  const tables = page.locator("table");
  await expect(tables).toHaveCount(2);

  // Door rows are split by category — expect at least the two distinct categories we seeded.
  const bodyText = (await page.locator("body").innerText()).trim();
  expect(bodyText).toContain("Single");
  expect(bodyText).toContain("Double");

  // Material List row count (excluding header/Total rows) equals materialList.length.
  const materialTable = tables.nth(1);
  const materialRows = materialTable.locator("tbody tr td:first-child.text-center");
  // Header rows have no <td> (they're <th>), so counting first-column <td>s per row already excludes
  // header rows; the material table has no Total rows (per Batch 1's design — nothing summed).
  await expect(materialRows).toHaveCount(calc.materialList.length);

  // No "null" leaking through, and no doubled-unit "mm mm" text (Stage 23 F-9 regression guard).
  expect(bodyText).not.toMatch(/\bnull\b/);
  expect(bodyText).not.toContain("mm mm");
});
