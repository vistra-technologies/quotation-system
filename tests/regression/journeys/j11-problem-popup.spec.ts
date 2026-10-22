/**
 * J11 — the Submit Design problem popup (Stage 34 Batch 7, S34-7, D-33..D-37), in the browser as the Test Org admin.
 *
 * Project A: one floor, TWO rooms x TWO walls. Every wall is two sections: a glass one (assigned) and a door
 * section (transom assigned) whose door cell is left empty (a null DOOR cell: the server never fills a door), so
 * Submit Design answers 422 with DESIGN problems on 2 rooms x 2 walls (phase A refuses before any non-DESIGN
 * problem can exist, so the two kinds never share a popup live). Walk: popup groups by room,
 * collapsed by default, counts, Expand all / Collapse all, no floor label (one floor), no UUID anywhere, one Go per
 * wall opens Configure mode on that wall.
 * Project B: submitted, then its glass component is blanked: Recompute on the Summary page opens the same popup
 * with the non-DESIGN (SELECTION-scope) group rendered as before (flat rows, no regrouping).
 *
 * Mutates only the Test Org: two projects, ledgered by `f.project`; the blanked config rows belong to them.
 */
import { test, expect } from "../fixtures/test";
import { orgUrl } from "../../e2e/helpers";
import { glassConfig, expectSubmitted, oneCellDesign, orgApi } from "../api/project-helpers";
import { rgrSetSelectionConfig } from "../../e2e/db-helpers";
import { T, withPage } from "./journey-helpers";
import { isHydrated } from "../pages/collect";

test.use({ trace: "off" });

/** Optional: set J11_SHOTS to a folder to keep screenshots of each popup state (review evidence). */
const shot = async (page: import("@playwright/test").Page, name: string) => {
  const dir = process.env.J11_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test("J11: problem popup — rooms x walls grouped, collapsed, Expand/Collapse all, one Go per wall, no UUIDs; Summary Recompute path", async ({ browser, as, f, run }) => {
  test.setTimeout(300_000);
  const c = { as, run };
  const slug = run.testOrg.slug;
  const cfg = await glassConfig(f);

  // ── Project A: 2 rooms x 2 walls, each wall: transom/glass section + a door section with an empty door cell ──
  const a = await f.project();
  const flr = await as.admin.post(orgApi(slug, "/floors"), { data: { projectId: a.id, label: `${run.prefix}F` } });
  expect(flr.status(), await flr.text()).toBe(201);
  const floorId = ((await flr.json()) as { floor: { id: string } }).floor.id;
  const glass = await f.selection(a.id, "GLASS", cfg);
  const walls: Array<{ room: string; wall: string; partitionId: string }> = [];
  for (const rn of ["A", "B"]) {
    const rm = await as.admin.post(orgApi(slug, "/rooms"), { data: { floorId, label: `${run.prefix}Room${rn}` } });
    expect(rm.status(), await rm.text()).toBe(201);
    const roomId = ((await rm.json()) as { room: { id: string } }).room.id;
    const sd = await as.admin.patch(orgApi(slug, `/rooms/${roomId}/sides`), {
      data: {
        sides: [
          { kind: "PARTITION", widthMm: 2000, heightMm: 2400, turnDegrees: 90, label: `${rn}-wall1` },
          { kind: "PARTITION", widthMm: 2000, heightMm: 2400, turnDegrees: 90, label: `${rn}-wall2` },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    });
    expect(sd.status(), await sd.text()).toBe(200);
    const sides = ((await sd.json()) as { room: { sides: Array<{ kind: string; partitionId: string | null; label: string | null }> } }).room.sides;
    for (const s of sides.filter((x) => x.kind === "PARTITION")) {
      const p = await as.admin.patch(orgApi(slug, `/partitions/${s.partitionId}`), {
        data: {
          design: {
            schemaVersion: 2,
            sections: [
              { id: "g", widthMm: 1000, cells: [{ id: "g0", heightMm: 2400, selectionId: glass.id }] },
              { id: "d", widthMm: 1000, cells: [{ id: "d0", heightMm: 400, selectionId: glass.id }, { id: "d1", heightMm: 2000, selectionId: null, hinging: "right" }] },
            ],
          },
        },
      });
      expect(p.status(), await p.text()).toBe(200);
      walls.push({ room: `${run.prefix}Room${rn}`, wall: s.label ?? "", partitionId: s.partitionId! });
    }
  }
  expect(walls).toHaveLength(4);

  await withPage(browser, run, "admin", async ({ page }) => {
    await page.goto(orgUrl(slug, `/projects/${a.id}/design`));
    const submit = page.getByRole("button", { name: /^Submit Design$/ });
    await expect.poll(() => isHydrated(submit)).toBe(true);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/projects/${a.id}/submit-design`)),
      submit.click(),
    ]);
    expect(resp.status(), await resp.text()).toBe(422);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await test.step("grouped by room, collapsed by default, counts, no floor label, no UUID", async () => {
      const rooms = dialog.getByTestId("problem-room");
      await expect(rooms).toHaveCount(2);
      for (let i = 0; i < 2; i++) await expect(rooms.nth(i)).toHaveAttribute("aria-expanded", "false");
      await expect(dialog.getByTestId("problem-wall")).toHaveCount(0);
      await expect(dialog.getByTestId("problem-floor")).toHaveCount(0); // one floor
      await expect(rooms.first()).toContainText("2 walls");
      await expect(dialog.getByText("Fix your design")).toBeVisible();
      await expect(dialog.getByTestId("problem-row")).toHaveCount(0); // phase A refuses first: DESIGN problems only
      expect(await dialog.innerText()).not.toMatch(UUID);
      await shot(page, "b7-1-collapsed");
    });

    await test.step("Expand all / Collapse all", async () => {
      const toggle = dialog.getByTestId("problem-toggle-all");
      await expect(toggle).toHaveText("Expand all");
      await toggle.click();
      await expect(dialog.getByTestId("problem-wall")).toHaveCount(4);
      await expect(dialog.getByTestId("problem-wall-go")).toHaveCount(4); // one Go per wall
      await expect(toggle).toHaveText("Collapse all");
      await expect(dialog.getByTestId("problem-wall").first()).toContainText("1 door without a component");
      expect(await dialog.innerText()).not.toMatch(UUID);
      await shot(page, "b7-2-expanded");
      await toggle.click();
      await expect(dialog.getByTestId("problem-wall")).toHaveCount(0);
      await expect(toggle).toHaveText("Expand all");
    });

    await test.step("one Go per wall opens Configure mode", async () => {
      await dialog.getByTestId("problem-room").nth(1).click();
      await expect(dialog.getByTestId("problem-wall")).toHaveCount(2);
      await dialog.getByTestId("problem-wall-go").nth(1).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('[aria-label="Back to Room Layout"]')).toBeVisible({ timeout: 15_000 });
      await shot(page, "b7-3-configure");
    });
  });

  // ── Project B: submitted, then blanked → Recompute popup on the Summary page ──
  const w = await f.wall();
  const sel = await f.selection(w.projectId, "GLASS", cfg);
  const pp = await as.admin.patch(orgApi(slug, `/partitions/${w.partitionId}`), { data: { heightMm: 2400, design: oneCellDesign(sel.id) } });
  expect(pp.status(), await pp.text()).toBe(200);
  await expectSubmitted(await as.admin.post(T(c, `/projects/${w.projectId}/submit-design`)));
  await rgrSetSelectionConfig(sel.id, {});
  await withPage(browser, run, "admin", async ({ page }) => {
    await page.goto(orgUrl(slug, `/projects/${w.projectId}/summary`));
    const recompute = page.getByRole("button", { name: /^Recompute$/ });
    await expect.poll(() => isHydrated(recompute)).toBe(true);
    // Explicitly wait for the recompute response before asserting the popup (BUG-2 fix: ensures
    // the browser has received the 422 body before polling for the dialog).
    await Promise.all([
      page.waitForResponse((r) =>
        r.request().method() === "POST" && r.url().includes(`/projects/${w.projectId}/recompute`)
      ),
      recompute.click(),
    ]);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByTestId("problem-row").first()).toBeVisible();
    await expect(dialog.getByText("Fill in these fields")).toBeVisible();
    expect(await dialog.innerText()).not.toMatch(UUID);
    await shot(page, "b7-4-summary-recompute");
  });
});
