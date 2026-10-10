/**
 * Stage 31 item 19: Orders is hidden until the Order stage ships — the sidebar has no Orders link and the
 * dashboard has no Orders tile (two tiles: Projects, Inquiries). The /orders page itself still exists and is
 * covered by pages.spec.ts. Read-only, Test Org admin session only.
 */
import { test, expect } from "../api/sa-helpers";
import { openAs, orgTarget } from "./page-helpers";

test.use({ trace: "off" });

test("dashboard and sidebar show no Orders link or tile; Projects and Inquiries remain", async ({ browser, run }) => {
  const o = await openAs(browser, run, "admin");
  try {
    await o.page.goto(orgTarget(run, "/dashboard"));
    const main = o.page.getByRole("main");
    await expect(main.getByText("Projects", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(main.getByText("Inquiries", { exact: true })).toBeVisible();
    await expect(main.getByText("Orders", { exact: true })).toHaveCount(0);
    await expect(o.page.getByRole("link", { name: "Orders" })).toHaveCount(0);
    await expect(o.page.getByRole("link", { name: "Projects" }).first()).toBeVisible();
  } finally {
    await o.ctx.close();
  }
});
