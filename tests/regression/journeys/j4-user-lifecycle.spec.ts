/**
 * J4 — one org user's whole life, run by the Test Org admin in the UI (User Management pages) while the user
 * keeps ONE browser session open the whole time. Every step is checked from both sides: the admin's view
 * (API) and what the user's live session can still do.
 *
 *   create (UI form; U3: an external role without a company is refused by the form) → the user signs in
 *   through the real login page → role change (UI) takes effect on that live session → deactivate (UI):
 *   the live session is refused at once, a new sign-in is refused → activate (UI) → password reset (UI):
 *   old password refused, new accepted → the user owns a project: delete is refused → the project goes →
 *   delete (UI) → the session is dead and sign-in is refused.
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
import { T, getJson, withPage } from "./journey-helpers";

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

      await test.step("activate (UI): sign-in works again — and the session held before deactivation is valid again", async () => {
        const btn = ap.getByRole("button", { name: "Activate" });
        await expect.poll(() => isHydrated(btn)).toBe(true);
        await btn.click();
        await expect.poll(async () => (await users()).find((u) => u.id === userId)?.active, { timeout: 20_000 }).toBe(true);
        // DECISION NEEDED — the page copy says "Deactivating signs the user out everywhere", but deactivation
        // only blocks requests while the flag is off (lib/session.ts: "no session purge needed"): reactivating
        // revives every session that existed before. If deactivation should end sessions, change this to 401.
        expect(await meStatus()).toBe(200);
        expect(await freshSignIn(pw1)).toBe(200);
      });

      await test.step("password reset (UI): old password refused, new accepted", async () => {
        await userPage();
        await ap.getByLabel("New Password").fill(pw2);
        const set = ap.getByRole("button", { name: "Set Password" });
        await expect.poll(() => isHydrated(set)).toBe(true);
        await set.click();
        await expect.poll(() => freshSignIn(pw1), { timeout: 30_000, intervals: [2_000, 5_000] }).toBe(401);
        expect(await freshSignIn(pw2)).toBe(200);
        // KNOWN BUG — same root cause as users.spec.ts "an admin password reset leaves the user's existing
        // sessions valid": setUserPassword only rewrites the hash (and the page copy says "Setting a password
        // signs the user out everywhere"). When fixed, change this expectation to 401.
        expect(await meStatus()).toBe(200);
      });

      let projectId = "";
      await test.step("a user who owns a project cannot be deleted (UI shows the refusal); once the project is gone, delete (UI) works", async () => {
        const name = `${run.prefix}j4p-${randomBytes(2).toString("hex")}`;
        const p = await up.request.post(T(c, "/projects"), { data: { name, currency: "AED", projectLocation: "Dubai UAE" } });
        expect(p.status(), await p.text()).toBe(201);
        projectId = ((await p.json()) as { project: { id: string } }).project.id;
        ledger.add({ kind: "project", id: projectId, orgSlug: slug, label: name }); // drained before the user

        await ap.goto(orgTarget(run, "/admin/users"));
        const del = ap.getByRole("button", { name: `Delete user ${username}` });
        await expect.poll(() => isHydrated(del)).toBe(true);
        await del.click();
        await ap.getByRole("button", { name: "Delete", exact: true }).click();
        // KNOWN BUG — the deleteUser server action THROWS the API's 400 message ("…associated projects or
        // inquiries…"), and a production build replaces a server-action error with Next's generic text (and
        // answers the action POST with HTTP 500). The admin never learns WHY the delete was refused. When fixed
        // (return the error as state instead of throwing), change this to the API's message and drop the
        // 500 allowance at the end of this test.
        const err = ap.locator("span.text-red-600");
        await expect(err).toHaveText(/^An error occurred in the Server Components render\. The specific message is omitted in production builds/);
        expect((await users()).find((u) => u.id === userId)?.active, "refused delete leaves the user as is").toBe(true);

        const dp = await as.admin.delete(T(c, `/projects/${projectId}`));
        expect(dp.status(), await dp.text()).toBe(200);
        ledger.remove(projectId);

        await ap.goto(orgTarget(run, "/admin/users"));
        await expect.poll(() => isHydrated(del)).toBe(true);
        await del.click();
        await ap.getByRole("button", { name: "Delete", exact: true }).click();
        await expect.poll(async () => (await users()).some((u) => u.id === userId), { timeout: 20_000 }).toBe(false);
        ledger.remove(userId);
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

    // Tolerated, and nothing else: (1) server-action POSTs on these User Management pages that Chromium reports
    // as ERR_ABORTED (Next's client drops the action fetch once it has the redirect / refreshed tree — timing
    // dependent; their effects are asserted via the API above); (2) the KNOWN BUG above: exactly one HTTP 500
    // (+ its console line) for the refused delete's action POST.
    const problems = await settledProblems(admin);
    const actionAbort = new RegExp(`^request failed \\[fetch/POST\\] \\S+/admin/users(/new|/${userId})? net::ERR_ABORTED$`);
    const knownBug500 = (p: string) => /^HTTP 500 \S+\/admin\/users$/.test(p) || p === "console.error: Failed to load resource: the server responded with a status of 500 ()";
    expect(problems.filter(knownBug500)).toHaveLength(2);
    expect(problems.filter((p) => !actionAbort.test(p) && !knownBug500(p))).toEqual([]);
  });
});
