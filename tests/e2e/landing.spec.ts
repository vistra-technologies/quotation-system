/**
 * Apex landing page spec (Stage 28 Batch 2, S28-16).
 *
 * The apex `/` serves the signed-off standalone mockup as-is (content/landing/home.html via
 * app/route.ts): no org list, no Log in / Register, no Privacy / Terms links, no network request
 * of its own beyond the document. Anonymous, read-only — no org data is touched.
 *
 *   PLAYWRIGHT_BASE_URL=<branch preview or test.easeetool.com> npx playwright test landing
 */

import { test, expect, type Page } from "@playwright/test";

/** Record every request the page makes after the document itself. */
function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    // Inlined fonts/images are data: URLs — never a request. Anything else is a network call.
    if (r.resourceType() !== "document") urls.push(`${r.method()} ${r.url()}`);
  });
  return urls;
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "Sections" });

test.describe("apex landing", () => {
  test("serves the landing as HTML with no org names and makes no API/network call", async ({ page }) => {
    const requests = trackRequests(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    await expect(page).toHaveTitle(/EaseeTool/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Glass estimates");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("made easy");

    // Let the hero animation run, then scroll the whole page so every IntersectionObserver fires.
    await page.waitForTimeout(1_000);
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
    });

    expect(requests, "landing must make no request beyond the document (esp. no /api/*)").toEqual([]);
    expect(pageErrors).toEqual([]);

    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("select your organization");
    expect(text).not.toContain("dev tools");
    for (const org of ["cloisons", "acme glass", "nordic"]) {
      expect(text, `org name "${org}" must not appear on the apex`).not.toContain(org);
    }
  });

  test("is show-only: no Log in / Register / Privacy / Terms controls; only in-page anchors", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    for (const name of [/log ?in/i, /sign ?in/i, /register/i, /privacy/i, /terms/i]) {
      await expect(page.getByRole("link", { name })).toHaveCount(0);
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    // The commented-out Register drawer / form must not be in the DOM.
    await expect(page.locator('input[type="password"], form, #drawer')).toHaveCount(0);

    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^#/);
  });

  test("nav: four tabs; anchors scroll to #about / #products / #join", async ({ page }) => {
    await page.goto("/");
    await expect(tabs(page).getByRole("link")).toHaveText(["Home", "About us", "Products", "Join us"]);

    for (const [label, id] of [
      ["About us", "about"],
      ["Products", "products"],
      ["Join us", "join"],
    ] as const) {
      await tabs(page).getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(page.locator(`section#${id}`)).toBeInViewport({ timeout: 8_000 });
      await expect(tabs(page).getByRole("link", { name: label })).toHaveClass(/active/, { timeout: 8_000 });
    }
  });

  test("Products ring: only Estimation is live; four phases read 'Coming soon'", async ({ page }) => {
    await page.goto("/");
    await page.locator("#products").scrollIntoViewIfNeeded();
    const pills = page.getByRole("tablist", { name: "Platform phases" }).getByRole("tab");
    await expect(pills).toHaveCount(5);
    await expect(pills.filter({ hasText: /coming soon/i })).toHaveCount(4);
    await expect(pills.first()).not.toContainText(/coming soon/i);
    // Four "Coming soon" tags on the module cards as well.
    await expect(page.locator("#products .mod .soon")).toHaveCount(4);
  });

  test("Get started: static workspace-address chip, no CTA row", async ({ page }) => {
    await page.goto("/");
    const start = page.locator("#start");
    await start.scrollIntoViewIfNeeded();
    await expect(start.getByLabel("Workspace address")).toContainText("{your-company}.easeetool.com");
    await expect(start.getByRole("link")).toHaveCount(0);
    await expect(start.getByRole("button")).toHaveCount(0);
  });

  test("footer: About us / Products / Join us + copyright, nothing else", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.locator("nav a")).toHaveText(["About us", "Products", "Join us"]);
    await expect(footer).toContainText("2026 EaseeTool");
  });

  test("Join-us Design demo works with no network request", async ({ page }) => {
    await page.goto("/");
    await page.locator("#join").scrollIntoViewIfNeeded();
    const requests = trackRequests(page);

    const panels = page.locator("#apWall .ap-panel");
    const add = page.locator("#apAdd");
    const remove = page.locator("#apRemove");
    const split = page.locator("#apSplit");
    await expect(panels).toHaveCount(3);
    await expect(remove).toBeDisabled();
    await expect(split).toBeDisabled();

    // Select a panel → remove/split enable; clicking the same panel again deselects.
    await panels.nth(0).click();
    await expect(panels.nth(0)).toHaveClass(/sel/);
    await expect(remove).toBeEnabled();
    await expect(split).toBeEnabled();

    // Split → 4 panels; add → 5; remove the selection → back to 4.
    await split.click();
    await expect(panels).toHaveCount(4);
    await expect(page.locator("#apTag")).toHaveText("4 panels");
    await add.click();
    await expect(panels).toHaveCount(5);
    await panels.nth(1).click();
    await remove.click();
    await expect(panels).toHaveCount(4);
    await expect(page.locator("#apSave")).toHaveText("Save"); // dirty

    // Glass pick re-labels every panel.
    await page.locator('[data-glass="frosted"]').click();
    await expect(page.locator('[data-glass="frosted"]')).toHaveClass(/\bon\b/);
    await expect(panels.first().locator(".ap-pm")).toHaveText("Frosted Glass");

    // Door pick: disabled until a panel is selected, then adds a door to the selected panel.
    const door = page.locator('[data-door="d1"]');
    await expect(door).toBeDisabled();
    await panels.nth(2).click();
    await expect(door).toBeEnabled();
    await door.click();
    await expect(panels.nth(2).locator(".ap-door")).toHaveCount(1);

    // Width / height inputs: width re-scales the panels, both clamp.
    await page.locator("#apW").fill("6000");
    await page.locator("#apW").press("Enter");
    await expect(page.locator("#apW")).toHaveValue("6000");
    await expect(panels.first().locator(".ap-pl")).toContainText("1500 mm"); // 6000 / 4 panels
    await page.locator("#apH").fill("99999");
    await page.locator("#apH").press("Enter");
    await expect(page.locator("#apH")).toHaveValue("4200");

    expect(requests, "the Design demo must not make any network request").toEqual([]);
  });

  test("apex still 404s non-root paths", async ({ request, baseURL }) => {
    // Only the *.easeetool.com hosts carry the apex guard (path mode on previews/localhost).
    test.skip(!baseURL || !new URL(baseURL).hostname.endsWith("easeetool.com"), "apex guard only on easeetool.com hosts");
    const res = await request.get("/definitely-not-a-page/login");
    expect(res.status()).toBe(404);
  });

  test("/controls still serves on the apex", async ({ page }) => {
    const res = await page.goto("/controls/login");
    expect(res?.status()).toBe(200);
    await expect(page.getByText(/Sign in with your SuperAdmin credentials/)).toBeVisible();
  });
});

test.describe("apex landing — mobile", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("menu button opens the tabs and picking one closes them; no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const menu = page.locator("#navMenu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(tabs(page).getByRole("link", { name: "Products" })).toBeVisible();

    await tabs(page).getByRole("link", { name: "Products" }).click();
    await expect(page).toHaveURL(/#products$/);
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
