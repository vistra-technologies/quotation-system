/**
 * J7 — the user-limit UI at the cap (Stage 29 fix round 1; was backlog Low "committed test for the at-cap UI states").
 *
 * One throwaway org (`rgr-<runId>-u…`, userLimit 2, filled to 2/2 with one SA-added user). Checked in the browser:
 *   - /controls Organizations list: the org's Users cell is the seat pill "2/2", amber (status-pending) at the cap.
 *   - /controls/orgs/<id>/users: the SA "Add user" button is disabled and the "User limit reached (2/2)" notice shows.
 *   - the org admin's /admin/users: the "reached its user limit (2/2)" banner shows; "Add user" stays enabled; filling the
 *     form and submitting shows "User limit reached (2/2). Contact your platform administrator." AND every field keeps
 *     what was typed (the form used to clear itself after any server-side error).
 *
 * Safety: the org is this run's own (ledgered at creation, id on the SA allowance); the Test Org is never touched.
 * The only identities are the run's own SA session and the throwaway org's admin (runPassword()).
 */
import { test, expect, createThrowawayOrg, SA, json } from "../api/sa-helpers";
import { Guarded, createAllowance } from "../fixtures/clients";
import { orgUrl } from "../../e2e/helpers";
import { orgApi } from "../api/project-helpers";
import { runPassword, signIn } from "../api/sign-in";
import { isHydrated } from "../pages/collect";
import { withPage } from "./journey-helpers";

test.use({ trace: "off" });

test("J7: at the user cap — SA pill / disabled Add / notice, org-admin banner, and the Create User form keeps its fields after USER_LIMIT_REACHED", async ({ browser, sa, run, ledger }) => {
  test.setTimeout(240_000);
  const org = await createThrowawayOrg(sa, { run, ledger }, "u", run.formulaSetId, 2);

  const roles = (await json<{ roles: { id: string; name: string }[] }>(await sa.get(`${SA}/roles?orgId=${org.id}`))).roles;
  const memberRoleId = roles.find((r) => r.name === "Company Member")!.id;
  const fill = await sa.post(`${SA}/orgs/${org.id}/users`, {
    data: { firstName: "Rgr", lastName: "Seat", username: `${org.slug.slice(0, 20)}-f`, roleId: memberRoleId, password: runPassword() },
  });
  expect(fill.status(), await fill.text()).toBe(201);

  await test.step("SuperAdmin console: seat pill (amber) in the org list; Add user disabled + notice on the Users tab", async () => {
    await withPage(browser, run, "sa", async (s) => {
      await s.page.goto("/controls/orgs");
      const row = s.page.locator("tr", { hasText: org.slug });
      const pill = row.getByText("2/2", { exact: true });
      await expect(pill).toBeVisible();
      await expect(pill).toHaveClass(/bg-status-pending-bg/);

      await s.page.goto(`/controls/orgs/${org.id}/users`);
      await expect.poll(() => isHydrated(s.page.getByRole("button", { name: "Add user" }))).toBe(true);
      await expect(s.page.getByRole("button", { name: "Add user" })).toBeDisabled();
      await expect(s.page.getByRole("status").filter({ hasText: "User limit reached (2/2)" })).toBeVisible();
    }, sa.token);
  });

  await test.step("org admin: banner at the cap; a refused Create User keeps every typed field", async () => {
    const ctx = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL,
      extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {},
    });
    try {
      const login = await signIn(ctx.request, org.slug, "admin", runPassword());
      expect(login.status(), await login.text()).toBe(200);
      const admin = new Guarded(ctx.request, createAllowance([org.slug], [org.id]));
      expect((await admin.get(orgApi(org.slug, "/users"))).status()).toBe(200); // the session works before the page checks

      const page = await ctx.newPage();
      await page.goto(orgUrl(org.slug, "/admin/users"));
      await expect(page.getByRole("status").filter({ hasText: "2/2" })).toBeVisible();
      const add = page.getByRole("button", { name: "Add user" });
      await expect.poll(() => isHydrated(add)).toBe(true);
      await expect(add).toBeEnabled();
      await add.click();

      const typed = { firstName: "Retain", lastName: "Fields", username: `${org.slug.slice(0, 20)}-x`, mobile: "5550100", profileEmail: "retain@example.com" };
      await page.getByLabel("First Name").fill(typed.firstName);
      await page.getByLabel("Last Name").fill(typed.lastName);
      await page.getByLabel("Username", { exact: true }).fill(typed.username);
      await page.getByLabel("Initial Password").fill(runPassword());
      await page.getByLabel(/^Mobile/).fill(typed.mobile);
      await page.getByLabel(/^Email/).fill(typed.profileEmail);
      await page.getByRole("button", { name: "Create User" }).click();

      await expect(page.getByText("User limit reached (2/2). Contact your platform administrator.")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByLabel("First Name")).toHaveValue(typed.firstName);
      await expect(page.getByLabel("Last Name")).toHaveValue(typed.lastName);
      await expect(page.getByLabel("Username", { exact: true })).toHaveValue(typed.username);
      await expect(page.getByLabel("Initial Password")).toHaveValue(runPassword());
      await expect(page.getByLabel(/^Mobile/)).toHaveValue(typed.mobile);
      await expect(page.getByLabel(/^Email/)).toHaveValue(typed.profileEmail);

      // nothing was created
      const users = (await json<{ users: unknown[] }>(await admin.get(orgApi(org.slug, "/users")))).users;
      expect(users).toHaveLength(2);
    } finally {
      await ctx.close();
    }
  });
});
