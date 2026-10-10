/**
 * J4 — one org user's whole life, run by the Test Org admin in the UI (User Management pages) while the user
 * keeps ONE browser session open the whole time. Every step is checked from both sides: the admin's view
 * (API) and what the user's live session can still do.
 *
 *   create (UI form; U3: an external role without a company is refused by the form) → the user signs in
 *   through the real login page → role change (UI) takes effect on that live session → deactivate (UI):
 *   the live session is refused at once, a new sign-in is refused → activate (UI) → password reset (UI):
 *   old password refused, new accepted → the user owns a project: delete (UI) still succeeds (Stage 31) and
 *   the project stays, attributed to the deleted user's name → the session is dead and sign-in is refused.
 *   Deactivate and the password reset both revoke the user's sessions (Stage 31 S31-2), so the journey
 *   signs the user in again after each.
 *
 * Users are rgr-<runId>-… and ledgered the moment they exist. Sign-ins are few (rate limit 3 / 10 s / IP)
 * and retry on 429.
 */
import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import type { RunState } from "../fixtures/run-state";
import { expectLands, orgPathOf, orgTarget, settledProblems } from "../pages/page-helpers";
import { isHydrated } from "../pages/collect";
import { runPassword, signIn } from "../api/sign-in";
import { T, getJson, getProject, withPage } from "./journey-helpers";

test.use({ trace: "off" });

type UserRow = { id: string; username: string; active: boolean; roleId: string; externalCompanyId: string | null; role: { name: string } };

/** Pick `option` in the custom SelectField (role=combobox) found by `trigger`. */
async function choose(page: Page, trigger: ReturnType<Page["locator"]>, option: string): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}

/** Sign in through the org login page (retries the form's own 429 cooldown). Lands on /dashboard. */
async function uiLogin(page: Page, run: RunState, username: string, password: string): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(orgTarget(run, "/login"));
    const user = page.getByPlaceholder("Enter your user ID");
    await expect.poll(() => isHydrated(user)).toBe(true);
    await user.fill(username);
    await page.getByPlaceholder("Enter your password").fill(password);
    await page.locator("form button[type=submit]").click();
    const out = await expect
      .poll(async () => (orgPathOf(run, page.url()) === "/dashboard" ? "in" : (await page.getByText(/too many|try again in/i).count()) ? "429" : ""), { timeout: 30_000 })
      .not.toBe("")
      .then(() => (orgPathOf(run, page.url()) === "/dashboard" ? "in" : "429"));
    if (out === "in") return;
    await page.waitForTimeout(11_000);
  }
  throw new Error(`UI login of ${username} kept hitting the rate limit`);
}

test("J4: user lifecycle — create → sign in → role change → deactivate → activate → password reset → delete, against one live session", async ({ browser, as, f, run, ledger, playwright, baseURL }) => {
  test.setTimeout(420_000);
  const c = { as, f, run };
  const slug = run.testOrg.slug;
  const username = `${run.prefix}j4-${randomBytes(2).toString("hex")}`;
  const pw1 = `${runPassword()}-J4a`;
  const pw2 = `${runPassword()}-J4b`;
  const users = async () => (await getJson<{ users: UserRow[] }>(as.admin, T(c, "/users"))).users;
  const freshSignIn = async (password: string) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {} });
    try {
      return (await signIn(ctx, slug, username, password)).status();
    } finally {
      await ctx.dispose();
    }
  };
  let userId = "";

  await withPage(browser, run, "admin", async (admin) => {
    const ap = admin.page;
    const userPage = () => ap.goto(orgTarget(run, `/admin/users/${userId}`));

    await test.step("create (UI): U3 blocks an external role without a company; a Company Member is created", async () => {
      await ap.goto(orgTarget(run, "/admin/users/new"));
      await ap.getByLabel("First Name").fill("RGR");
      await ap.getByLabel("Last Name").fill("Journey");
      await ap.getByLabel("Username").fill(username);
      await ap.getByLabel("Initial Password").fill(pw1);
      const role = ap.locator('label[for="roleId"] ~ div [role=combobox]');
      await expect.poll(() => isHydrated(role)).toBe(true);
      // U3: Distributor is an external role → the company field becomes required; with "None" the form refuses
      await choose(ap, role, "Distributor");
      await expect(ap.getByText("External Company (required for this role)")).toBeVisible();
      await ap.getByRole("button", { name: "Create User" }).click();
      await expect(ap.getByLabel("Username")).toHaveValue(username); // still on the form
      expect(orgPathOf(run, ap.url())).toBe("/admin/users/new");
      expect((await users()).some((u) => u.username === username), "U3: nothing created").toBe(false);
      // a Company Member needs no company
      await choose(ap, role, "Company Member");
      await expect(ap.getByText("External Company (required for this role)")).toHaveCount(0);
      await ap.getByRole("button", { name: "Create User" }).click();
      await expect.poll(async () => (await users()).find((u) => u.username === username)?.id ?? "", { timeout: 30_000 }).not.toBe("");
      const u = (await users()).find((x) => x.username === username)!;
      userId = u.id;
      ledger.add({ kind: "user", id: userId, orgSlug: slug, label: username });
      expect(u).toMatchObject({ active: true, externalCompanyId: null, role: { name: "Company Member" } });
      await expectLands(() => orgPathOf(run, ap.url()), "/admin/users", "Create User lands on the list");
      await expect(ap.getByText(username)).toBeVisible();
    });

    await withPage(browser, run, "anon", async (user) => {
      const up = user.page;
      const meStatus = async () => (await up.request.get(T(c, "/me"))).status();

      await test.step("the user signs in through the login page; as a Company Member User Management is closed to them", async () => {
        await uiLogin(up, run, username, pw1);
        expect(await meStatus()).toBe(200);
        expect((await up.request.get(T(c, "/users"))).status()).toBe(403);
        await up.goto(orgTarget(run, "/admin/users"));
        await expectLands(() => orgPathOf(run, up.url()), "/dashboard", "member → /admin/users denied");
      });

      await test.step("role change (UI) → Admin: the same live session can now manage users", async () => {
        await userPage();
        const roleForm = ap.locator("form").filter({ has: ap.getByRole("button", { name: "Update Role" }) });
        const role = roleForm.getByRole("combobox");
        await expect.poll(() => isHydrated(role)).toBe(true);
        await choose(ap, role, "Admin");
        await roleForm.getByRole("button", { name: "Update Role" }).click();
        await expect.poll(async () => (await users()).find((u) => u.id === userId)?.role.name, { timeout: 20_000 }).toBe("Admin");
        expect((await up.request.get(T(c, "/users"))).status(), "no re-login needed").toBe(200);
        await up.goto(orgTarget(run, "/admin/users"));
        await expectLands(() => orgPathOf(run, up.url()), "/admin/users");
        await expect(up.getByText("User Management").first()).toBeVisible();
      });

      await test.step("deactivate (UI): the live session is refused at once; a new sign-in is refused", async () => {
        await userPage();
        const btn = ap.getByRole("button", { name: "Deactivate" });
        await expect.poll(() => isHydrated(btn)).toBe(true);
        await btn.click();
        await expect.poll(async () => (await users()).find((u) => u.id === userId)?.active, { timeout: 20_000 }).toBe(false);
        await expect(ap.getByRole("button", { name: "Activate" })).toBeVisible();
        expect(await meStatus(), "instant deactivation: the held session's next API call").toBe(401);
        await up.goto(orgTarget(run, "/dashboard"));
        await expectLands(() => orgPathOf(run, up.url()), "/login", "the held session's next page");
        expect(await freshSignIn(pw1)).toBe(401);
      });

      await test.step("activate (UI): sign-in works again — the session held before deactivation stays dead", async () => {
        const btn = ap.getByRole("button", { name: "Activate" });
        await expect.poll(() => isHydrated(btn)).toBe(true);
        await btn.click();
        await expect.poll(async () => (await users()).find((u) => u.id === userId)?.active, { timeout: 20_000 }).toBe(true);
        // Confirmed (Stage 31 S31-2 P1/P4): deactivation revoked the session, so reactivating cannot revive it.
        expect(await meStatus()).toBe(401);
        expect(await freshSignIn(pw1)).toBe(200);
        await uiLogin(up, run, username, pw1); // the steps below need a live session again
        expect(await meStatus()).toBe(200);
      });

      await test.step("password reset (UI): old password refused, new accepted", async () => {
        await userPage();
        await ap.getByLabel("New Password").fill(pw2);
        const set = ap.getByRole("button", { name: "Set Password" });
        await expect.poll(() => isHydrated(set)).toBe(true);
        await set.click();
        await expect.poll(() => freshSignIn(pw1), { timeout: 30_000, intervals: [2_000, 5_000] }).toBe(401);
        expect(await freshSignIn(pw2)).toBe(200);
        // Stage 31 S31-2 P2: the reset revokes the user's sessions ("Setting a password signs the user out everywhere").
        expect(await meStatus()).toBe(401);
        await uiLogin(up, run, username, pw2); // the steps below need a live session again
        expect(await meStatus()).toBe(200);
      });

      let projectId = "";
      let name = "";
      await test.step("a user who owns a project can be deleted (UI): the dialog says the project stays, and it keeps the name as a snapshot", async () => {
        name = `${run.prefix}j4p-${randomBytes(2).toString("hex")}`;
        const p = await up.request.post(T(c, "/projects"), { data: { name, currency: "AED", projectLocation: "Dubai UAE" } });
        expect(p.status(), await p.text()).toBe(201);
        projectId = ((await p.json()) as { project: { id: string } }).project.id;
        ledger.add({ kind: "project", id: projectId, orgSlug: slug, label: name }); // drained before the user

        await ap.goto(orgTarget(run, "/admin/users"));
        const del = ap.getByRole("button", { name: `Delete user ${username}` });
        await expect.poll(() => isHydrated(del)).toBe(true);
        await del.click();
        // Stage 31 S31-4: the dialog says what happens to the records instead of refusing the delete.
        const dialog = ap.getByRole("dialog");
        await expect(dialog).toContainText("Owns 1 project and 0 inquiries");
        await expect(dialog).toContainText("RGR Journey (removed)");
        await dialog.getByRole("button", { name: "Delete", exact: true }).click();
        await expect.poll(async () => (await users()).some((u) => u.id === userId), { timeout: 20_000 }).toBe(false);
        ledger.remove(userId); // the project stays in the ledger: teardown deletes it

        // the project survived the delete: no creator any more, the name snapshot instead, and "(removed)" in the list
        const kept = await getProject(as.admin, c, projectId);
        expect(kept).toMatchObject({ createdByUserId: null, createdBy: null, createdByName: "RGR Journey" });
        await ap.goto(orgTarget(run, `/projects?search=${encodeURIComponent(name)}`));
        await expect(ap.getByText("RGR Journey (removed)")).toBeVisible({ timeout: 20_000 });
        // the list re-renders after the server action's refresh, which under parallel load can take longer than the
        // default 5 s (seen once in the final-review proof run: API already 404, row still listed at 5 s)
        await expect(ap.getByText(username)).toHaveCount(0, { timeout: 20_000 });
        expect((await as.admin.get(T(c, `/users/${userId}`))).status()).toBe(404);
      });

      await test.step("after delete: the live session is dead and sign-in is refused", async () => {
        expect(await meStatus()).toBe(401);
        await up.goto(orgTarget(run, "/dashboard"));
        await expectLands(() => orgPathOf(run, up.url()), "/login");
        expect(await freshSignIn(pw2)).toBe(401);
      });

      expect(await settledProblems(user)).toEqual([]);
    });

    // Tolerated, and nothing else: server-action POSTs on these User Management pages that Chromium reports
    // as ERR_ABORTED (Next's client drops the action fetch once it has the redirect / refreshed tree — timing
    // dependent; their effects are asserted via the API above). No HTTP 500 is tolerated any more (Stage 31:
    // the delete no longer throws).
    const problems = await settledProblems(admin);
    const actionAbort = new RegExp(`^request failed \\[fetch/POST\\] \\S+/admin/users(/new|/${userId})? net::ERR_ABORTED$`);
    expect(problems.filter((p) => !actionAbort.test(p))).toEqual([]);
  });
});
