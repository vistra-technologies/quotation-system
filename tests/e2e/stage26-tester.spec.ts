/**
 * Stage 26 tester pass — behavior-level coverage beyond the batch specs:
 * data correctness (door KPI / glass total / row counts), page states (no-row, FAILED, non-DRAFT,
 * step-gating), PDF content (text extracted with pdftotext), RBAC/tenancy on page + API.
 *
 *   PLAYWRIGHT_BASE_URL=https://test.easeetool.com npx playwright test stage26-tester --workers=1
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { apiUrl, orgUrl, apiSignIn } from "./helpers";
import { setProjectStatus, setDesignSubmittedAt, markCalculationFailed } from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const ORG = "cloisons";
const PREFIX = `e2e-s26t-${Date.now()}`;
let ctx: BrowserContext;
let page: Page;
const toDelete: string[] = [];
const C = (p: string) => apiUrl(ORG, `/api/v1/orgs/${ORG}${p}`);

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await apiSignIn(page, ORG, "admin");
});
test.afterAll(async () => {
  for (const id of toDelete) {
    await setProjectStatus(id, "DRAFT").catch(() => {});
    await page.request.delete(C(`/projects/${id}`)).catch(() => {});
  }
  await ctx.close();
});

const GLASS: Record<string, string> = {
  category: "Single", glassType: "ID1", thickness: "12", u_profile: "I LUF-01", i_profile: "I10 PDL",
  l_profile: "I LUO-01", acousticGasketCode: "GLASS-ACGSK-01", whiteSealCode: "GLASS-WSEAL-01",
  woodWedgeCode: "GLASS-WWDG-01", lConnectorCode: "GLASS-LCON-01", degreeConnectorCode: "GLASS-DCON-01",
  doorConnectorCode: "GLASS-DRCON-01", straightConnectorCode: "GLASS-STCON-01",
};
const DOOR: Record<string, string> = {
  category: "Single", doorType: "Simple Glass", hasFrame: "Yes", hasLeaf: "Yes", frameCode: "DOOR-FRAME-01",
  leafCode: "DOOR-LEAF-01", cornerConnBigCode: "DOOR-CCB-01", cornerConnSmallFrameCode: "DOOR-CCSF-01",
  cornerConnSmallLeafCode: "DOOR-CCSL-01", lAngleCode: "DOOR-LANG-01", hingeCode: "DOOR-HING-01",
  rubber25mmCode: "DOOR-RUB25-01", frameBumperGasketCode: "DOOR-FBGSK-01", frameBackGasketCode: "DOOR-FBKGSK-01",
  leafGlassGasket1Code: "DOOR-LGG1-01", leafGlassGasket2Code: "DOOR-LGG2-01",
};

async function newProject(name: string) {
  const proj = await page.request.post(C("/projects"), { data: { name: `${PREFIX} ${name}`, currency: "AED" } });
  expect(proj.status(), await proj.text()).toBe(201);
  const pj = ((await proj.json()) as { project: { id: string; projectNumber: number } }).project;
  toDelete.push(pj.id);
  return pj;
}
async function newRoom(projectId: string) {
  const f = await page.request.post(C("/floors"), { data: { projectId, label: `${PREFIX} F` } });
  const floorId = ((await f.json()) as { floor: { id: string } }).floor.id;
  const r = await page.request.post(C("/rooms"), { data: { floorId, label: `${PREFIX} R` } });
  const roomId = ((await r.json()) as { room: { id: string } }).room.id;
  const s = await page.request.patch(C(`/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `${PREFIX} W`, heightMm: 2400, widthMm: 4000 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(s.status(), await s.text()).toBe(200);
  return ((await s.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0].partitionId!;
}
async function sel(projectId: string, code: string, config: Record<string, string>) {
  const cts = (await (await page.request.get(C("/component-types"))).json()) as {
    componentTypes: { id: string; code: string }[];
  };
  const ct = cts.componentTypes.find((c) => c.code === code)!;
  const r = await page.request.post(C("/selections"), {
    data: { projectId, componentTypeId: ct.id, label: `${PREFIX} ${code}`, config, orderIndex: 0 },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { selection: { id: string } }).selection.id;
}
async function submittedProject(name: string) {
  const pj = await newProject(name);
  const partitionId = await newRoom(pj.id);
  const g = await sel(pj.id, "GLASS", GLASS);
  const d1 = await sel(pj.id, "DOOR", DOOR);
  const d2 = await sel(pj.id, "DOOR", { ...DOOR, category: "Double" });
  const cell = (id: string, selectionId: string, hinging?: string) => ({
    id: `${id}-c0`, heightMm: 2400, selectionId, ...(hinging ? { hinging } : {}),
  });
  const patch = await page.request.patch(C(`/partitions/${partitionId}`), {
    data: {
      heightMm: 2400,
      design: {
        schemaVersion: 2,
        sections: [
          { id: "s1", widthMm: 1000, cells: [cell("s1", g)] },
          { id: "s2", widthMm: 1000, cells: [cell("s2", d1, "right")] },
          { id: "s3", widthMm: 1000, cells: [cell("s3", d2, "left")] },
          { id: "s4", widthMm: 1000, cells: [cell("s4", d1, "left")] },
        ],
      },
    },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const sub = await page.request.post(C(`/projects/${pj.id}/submit-design`));
  expect(sub.status(), await sub.text()).toBe(200);
  return pj;
}

let main: { id: string; projectNumber: number };

test("T1 data correctness: door KPI rebuild, glass total, row count", async () => {
  main = await submittedProject("main");
  const res = await page.request.get(C(`/projects/${main.id}/calculation`));
  expect(res.status()).toBe(200);
  const raw = await res.text();
  expect(raw).not.toContain("materialByRoom");
  const calc = JSON.parse(raw);
  const doors = new Map<string, number>();
  for (const f of calc.summary.floors)
    for (const r of f.rooms)
      for (const w of r.walls)
        for (const d of w.doors) {
          const k = `${d.category}|${d.doorType}`;
          doors.set(k, (doors.get(k) ?? 0) + d.quantity);
        }
  const rebuilt = [...doors.values()].reduce((a, b) => a + b, 0);
  const stored = calc.summary.kpis.doorsByType.reduce((a: number, b: { quantity: number }) => a + b.quantity, 0);
  expect(rebuilt).toBe(stored);
  expect(doors.size).toBe(2);
  expect(rebuilt).toBe(3);

  await page.goto(orgUrl(ORG, `/projects/${main.id}/summary`));
  await expect(page.locator("table")).toHaveCount(2);
  const kpiText = await page.locator("table").first().innerText();
  expect(kpiText).toContain((calc.summary.kpis.totalPartitionSqm as number).toFixed(2));
  const rows = page.locator("table").nth(1).locator("tbody tr td:first-child.text-center");
  await expect(rows).toHaveCount(calc.materialList.length);
  const body = await page.locator("body").innerText();
  for (const bad of ["NaN", "undefined", "mm mm", "[object"]) expect(body).not.toContain(bad);
  expect(body).not.toMatch(/\bnull\b/);
  expect(body).toContain(calc.formulaSet.name);
});

test("T2 PDF content: header fields, no formula set, rows present", async () => {
  let have = true;
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
  } catch (e) {
    // poppler's -v exits non-zero; only a spawn failure (ENOENT) means the tool is missing.
    have = (e as { code?: string }).code !== "ENOENT";
  }
  test.skip(!have, "pdftotext missing");
  const calc = await (await page.request.get(C(`/projects/${main.id}/calculation`))).json();
  await page.goto(orgUrl(ORG, `/projects/${main.id}/summary`));
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export PDF" }).click(),
  ]);
  const t = new Date();
  const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  expect(dl.suggestedFilename()).toBe(`summary-${main.projectNumber}-${ymd}.pdf`);
  const path = (await dl.path())!;
  expect(fs.statSync(path).size).toBeGreaterThan(1000);
  const txt = execFileSync("pdftotext", ["-layout", path, "-"]).toString();
  console.log("PDF TEXT >>>\n" + txt.slice(0, 2500));
  expect(txt).toContain(`${PREFIX} main`);
  expect(txt).toContain(String(main.projectNumber));
  expect(txt).toMatch(/computed/i);
  expect(txt).toMatch(/cloisons/i);
  expect(txt).not.toContain(calc.formulaSet.name);
  expect(txt).not.toMatch(/formula set/i);
  for (const bad of ["NaN", "undefined", "mm mm"]) expect(txt).not.toContain(bad);
  expect(txt).not.toMatch(/\bnull\b/);
  for (const line of calc.materialList as { code: string }[]) expect(txt).toContain(line.code);
  expect(txt).toMatch(/page 1 of \d+/i);
});

test("T3 non-DRAFT: Recompute disabled with tooltip; API 409", async () => {
  await setProjectStatus(main.id, "SUBMITTED");
  try {
    await page.goto(orgUrl(ORG, `/projects/${main.id}/summary`));
    await expect(page.getByRole("button", { name: /Recompute/ })).toBeDisabled();
    await expect(page.getByText("Recompute is only available while the project is in Draft")).toHaveCount(1);
    const r = await page.request.post(C(`/projects/${main.id}/recompute`));
    expect(r.status()).toBe(409);
  } finally {
    await setProjectStatus(main.id, "DRAFT");
  }
});

test("T4 FAILED row: banner + Recompute, no tables, no Export", async () => {
  const pj = await submittedProject("failed");
  await markCalculationFailed(pj.id, "boom-detail-xyz");
  await page.goto(orgUrl(ORG, `/projects/${pj.id}/summary`));
  await expect(page.getByText("Calculation failed")).toBeVisible();
  await expect(page.getByText("boom-detail-xyz")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Recompute/ })).toBeEnabled();
  await page.getByRole("button", { name: /Recompute/ }).click();
  await expect(page.locator("table")).toHaveCount(2, { timeout: 30_000 });
});

test("T5 no-row empty state + step-gating redirect", async () => {
  const pj = await newProject("norow");
  await page.goto(orgUrl(ORG, `/projects/${pj.id}/summary`));
  await expect(page).not.toHaveURL(/\/summary/);
  await newRoom(pj.id);
  await setDesignSubmittedAt(pj.id);
  await page.goto(orgUrl(ORG, `/projects/${pj.id}/summary`));
  await expect(page.getByText("No calculation yet")).toBeVisible();
  await expect(page.getByRole("link", { name: /Back to Design/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recompute/ })).toHaveCount(0);
});

test("T6 RBAC/tenancy: anon and other-org sessions cannot see the page or API", async ({ browser }) => {
  const anon = await browser.newContext();
  const ap = await anon.newPage();
  await ap.goto(orgUrl(ORG, `/projects/${main.id}/summary`));
  expect(ap.url()).toMatch(/login/);
  const api = await ap.request.get(C(`/projects/${main.id}/calculation`));
  expect(api.status()).toBe(401);
  await anon.close();

  const other = await browser.newContext();
  const op = await other.newPage();
  await apiSignIn(op, "nordic-walls", "admin");
  const oa = await op.request.get(C(`/projects/${main.id}/calculation`));
  expect([401, 403, 404]).toContain(oa.status());
  await op.goto(orgUrl(ORG, `/projects/${main.id}/summary`));
  expect(await op.locator("body").innerText()).not.toContain("Material List");
  await other.close();
});
