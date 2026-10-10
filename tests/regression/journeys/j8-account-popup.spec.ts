/**
 * J8 — the My Account popup (Hotfix 2026-10-10). One throwaway Test-Org member (`f.user`, ledgered), signed
 * in on its own browser context; no shared user is edited and no password is changed except the throwaway's
 * (it is the user the password path is about). Checked in the browser:
 *   - the profile dropdown's "My Profile" opens the popup on Details (view-only), "Change Password" on Password;
 *   - Edit shows inputs; Save changes is disabled until a value differs; Cancel reverts;
 *   - saving updates the popup's identity header, and the profile menu's avatar initial (R -> A, from the
 *     refreshed server props) without a reload;
 *   - a wrong existing password shows the inline error and keeps the popup open.
 */
import { test, expect } from "../fixtures/test";
import { orgUrl } from "../../e2e/helpers";
import { runPassword, signIn } from "../api/sign-in";
import { isHydrated } from "../pages/collect";

test.use({ trace: "off" });

test("J8: My Account popup — tabs from each menu entry, view/edit/cancel, dirty-gated save, header refresh, wrong password", async ({ browser, f, run }) => {
  test.setTimeout(180_000);
  const u = await f.user("member");
  const slug = run.testOrg.slug;
  const ctx = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {},
  });
  try {
    const login = await signIn(ctx.request, slug, u.username, runPassword());
    expect(login.status(), await login.text()).toBe(200);
    const page = await ctx.newPage();
    await page.goto(orgUrl(slug, "/dashboard"));
    const profileBtn = page.getByRole("button", { name: "Profile" });
    await expect.poll(() => isHydrated(profileBtn)).toBe(true);
    const dialog = page.getByRole("dialog", { name: "My Account" });

    await test.step("My Profile opens on Details, view-only, identity header shows username and chips", async () => {
      await profileBtn.click();
      await page.getByRole("button", { name: "My Profile" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByText(`@${u.username}`)).toBeVisible();
      await expect(dialog.getByText("RGR User")).toBeVisible();
      await expect(dialog.getByLabel("First name")).toHaveCount(0); // view-only until Edit
      await expect(dialog.getByRole("button", { name: "Edit" })).toBeVisible();
    });

    await test.step("Edit: Save is disabled until dirty; Cancel reverts", async () => {
      await dialog.getByRole("button", { name: "Edit" }).click();
      const save = dialog.getByRole("button", { name: "Save changes" });
      await expect(save).toBeDisabled();
      const first = dialog.getByLabel("First name");
      await first.fill("Changed");
      await expect(save).toBeEnabled();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog.getByLabel("First name")).toHaveCount(0);
      await expect(dialog.getByText("RGR User")).toBeVisible();
    });

    await test.step("Save: header name and avatar update without a reload", async () => {
      await dialog.getByRole("button", { name: "Edit" }).click();
      await dialog.getByLabel("First name").fill("Ada");
      await dialog.getByLabel("Last name").fill("Lovelace");
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog.getByText("Details updated.")).toBeVisible();
      await expect(dialog.getByText("Ada Lovelace")).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
      await expect(dialog).toHaveCount(0);
    });

    await test.step("the profile menu avatar refreshed (R -> A) without a reload; Change Password opens on Password; a wrong existing password is an inline error", async () => {
      await profileBtn.click();
      // The initial comes from the layout's refreshed props (router.refresh), not the popup's local state.
      await expect(page.locator("div.absolute.right-0.top-11 div.rounded-full")).toHaveText("A");
      await page.getByRole("button", { name: "Change Password" }).click();
      await expect(dialog.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true");
      await dialog.getByLabel("Existing Password").fill("definitely-not-it-1");
      await dialog.getByLabel("New Password", { exact: true }).fill("Another-Valid-Pw-9");
      await dialog.getByLabel("Confirm New Password").fill("Another-Valid-Pw-9");
      await dialog.getByRole("button", { name: "Change password" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Existing password is incorrect.");
      await expect(dialog).toBeVisible();
    });
  } finally {
    await ctx.close();
  }
});
