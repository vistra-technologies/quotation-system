/**
 * J5 — a SuperAdmin runs a temporary org's whole life from the /controls UI, while that org's admin keeps one
 * browser session open in it.
 *
 *   create (SA API, rgr-<runId>-j… slug) → the org's admin signs in and fills EVERY org-scoped table through
 *   the org's own API (company, users, inquiry → project, floor / room / wall, inventory, saved component, a
 *   real Submit Design → calculation) → Suspend (/controls UI): the held session's pages answer 403 and no
 *   org data changes → Reactivate (UI): the SAME session works again → Suspend + Delete permanently (UI):
 *   every org-scoped table is empty for it (cascade), the org's host answers "Organization not found", the
 *   row is gone from /controls.
 *
 * Differs from superadmin-orgs.spec.ts (API lifecycle on org C with a DB-inserted calculation): here the data
 * is real (written through the org's API, a computed calculation), the SA actions are the console's buttons,
 * and the org user's live session is followed across every transition.
 *
 * Safety: the org is this run's own (rgr- slug, ledgered at creation, its id on the SA allowance). Every
 * /controls click is scoped to the table row holding OUR slug, and the window.confirm text must name OUR org or
 * the dialog is dismissed and the test fails — a click can never reach another org's row.
 *
 * proxy.ts caches an org's isSuspended / existence for up to 60 s per instance, so each page-side effect is
 * polled for up to 75 s.
 */
import type { Page } from "@playwright/test";
import { test, expect, createThrowawayOrg, listOrgs } from "../api/sa-helpers";
import { Guarded, createAllowance } from "../fixtures/clients";
import { countProjectCalculations, regressionSnapshot } from "../../e2e/db-helpers";
import { orgUrl } from "../../e2e/helpers";
import { orgApi } from "../api/project-helpers";
import { runPassword, signIn } from "../api/sign-in";
import { apexPathOf, settledProblems } from "../pages/page-helpers";
import { glassCfg, makeItemSet, orgItems } from "../engine/materials";
import { PLAIN, addSelection, buildRoom, designOf, wallOf, withPage } from "./journey-helpers";

test.use({ trace: "off" });

const PAGE_CACHE_MS = 75_000;

test("J5: SuperAdmin temp org — create → real data in every table → Suspend / Reactivate / Delete from /controls, followed by the org's live session", async ({ browser, sa, run, ledger }) => {
  test.setTimeout(480_000);
  const org = await createThrowawayOrg(sa, { run, ledger }, "j");
  const B = (p: string) => orgApi(org.slug, p);

  // the org's own admin, in its own browser context (its API calls share the context's cookies)
  const ctx = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {},
  });
  try {
    const login = await signIn(ctx.request, org.slug, "admin", runPassword());
    expect(login.status(), await login.text()).toBe(200);
    const admin = new Guarded(ctx.request, createAllowance([org.slug], [org.id]));
    const orgPage = await ctx.newPage();
    const dashboard = async () => (await orgPage.goto(orgUrl(org.slug, "/dashboard")))?.status();

    await test.step("fill every org-scoped table through the org's API", async () => {
      const ok = async (r: import("@playwright/test").APIResponse, status = 201) => {
        const text = await r.text();
        expect(r.status(), text).toBe(status);
        return text ? JSON.parse(text) : {};
      };
      await ok(await admin.post(B("/external-companies"), { data: { name: `${run.prefix}j5-co`, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" } }));
      const roles = (await ok(await admin.get(B("/roles")), 200)) as { roles: { id: string; name: string }[] };
      const memberRole = roles.roles.find((r) => r.name === "Company Member")!.id;
      await ok(await admin.post(B("/users"), { data: { username: `${run.prefix}j5-member`, firstName: "RGR", lastName: "J5", password: runPassword(), roleId: memberRole } }));
      const inq = (await ok(await admin.post(B("/inquiries"), { data: { name: `${run.prefix}j5-inq`, currency: "AED", projectLocation: "Dubai UAE" } }))) as { inquiry: { id: string } };
      const project = (await ok(await admin.post(B(`/inquiries/${inq.inquiry.id}/convert`)))) as { project: { id: string } };
      const projectId = project.project.id;
      const { partitionIds: [p1] } = await buildRoom(admin, org.slug, run.prefix, projectId, [wallOf(2000, 2400), PLAIN, PLAIN, PLAIN]);
      const items = await makeItemSet(orgItems(admin, org.slug), run.prefix, "GLASS", "j5");
      const sel = await addSelection(admin, org.slug, projectId, "GLASS", `${run.prefix}J5 Glass`, glassCfg(items));
      await ok(await admin.patch(B(`/partitions/${p1}`), { data: { heightMm: 2400, design: designOf([[2000, [[2400, sel]]]]) } }), 200);
      await ok(await admin.post(B(`/projects/${projectId}/submit-design`)), 200);
      expect(((await ok(await admin.get(B(`/projects/${projectId}/calculation`)), 200)) as { status: string }).status).toBe("OK");
    });

    const counts = async () => ((await regressionSnapshot()).orgs[org.slug] as { counts: Record<string, number> } | undefined)?.counts;
    const before = await counts();
    expect(before, "the org is in the DB snapshot").toBeTruthy();
    expect(before).toMatchObject({ user: 2, role: 4, externalCompany: 1, inquiry: 1, project: 1, floor: 1, room: 1, partition: 1, selection: 1, inventoryItem: 10, projectCalculation: 1 });
    expect(before!.componentType ?? 0).toBeGreaterThan(0);
    expect(await dashboard()).toBe(200);
    expect(new URL(orgPage.url()).pathname).toMatch(/\/dashboard$/);

    await withPage(browser, run, "sa", async (s) => {
      const page = s.page;
      const row = () => page.getByRole("row").filter({ has: page.getByRole("cell", { name: org.slug, exact: true }) });
      /** Click `button` in OUR row; a window.confirm must name OUR org, else it is dismissed and the test fails. */
      const clickInRow = async (button: string, confirmName = true) => {
        await expect(row()).toHaveCount(1);
        let wrong: string | null = null;
        const onDialog = async (d: import("@playwright/test").Dialog) => {
          if (d.message().includes(`"${org.name}"`)) await d.accept();
          else {
            wrong = d.message();
            await d.dismiss();
          }
        };
        if (confirmName) page.once("dialog", onDialog);
        await row().getByRole("button", { name: button, exact: true }).click();
        expect(wrong, "the confirm dialog named another org").toBeNull();
      };
      const listed = async () => (await listOrgs(sa)).find((o) => o.id === org.id);

      await page.goto("/controls/orgs");
      expect(apexPathOf(page.url())).toBe("/controls/orgs");

      await test.step("Suspend (UI): the org's held session gets 403 pages; nothing in the org changes", async () => {
        await clickInRow("Suspend");
        await expect.poll(async () => (await listed())?.isSuspended, { timeout: 20_000 }).toBe(true);
        await expect(row()).toContainText("Suspended", { timeout: 20_000 }); // moved to the Suspended table
        await expect.poll(dashboard, { timeout: PAGE_CACHE_MS, intervals: [5_000] }).toBe(403);
        await expect(orgPage.getByText(/has been suspended/)).toBeVisible();
        expect(await counts(), "suspension writes nothing in the org").toEqual(before);
      });

      await test.step("Reactivate (UI): the same session works again", async () => {
        await clickInRow("Reactivate");
        await expect.poll(async () => (await listed())?.isSuspended, { timeout: 20_000 }).toBe(false);
        await expect.poll(dashboard, { timeout: PAGE_CACHE_MS, intervals: [5_000] }).toBe(200);
        expect(new URL(orgPage.url()).pathname).toMatch(/\/dashboard$/);
        expect(await counts()).toEqual(before);
      });

      await test.step("Suspend + Delete permanently (UI): cascade across every org-scoped table; the org host is gone", async () => {
        await clickInRow("Suspend");
        await expect(row()).toContainText("Suspended", { timeout: 20_000 }); // moved to the Suspended table
        await row().getByRole("button", { name: "Delete", exact: true }).click();
        const dialog = page.getByRole("dialog").filter({ hasText: `Permanently delete "${org.name}" (${org.slug})?` });
        await expect(dialog).toBeVisible();
        const [resp] = await Promise.all([
          page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/v1/superadmin/orgs/${org.id}`)),
          dialog.getByRole("button", { name: "Delete permanently" }).click(),
        ]);
        expect(resp.status(), await resp.text()).toBe(200);
        ledger.remove(org.id);
        await expect(row()).toHaveCount(0);
        expect(await listed()).toBeUndefined();

        expect(await counts(), "no org-scoped row of the org survives (cascade)").toBeUndefined();
        expect(await countProjectCalculations(org.id)).toBe(0);
        // Until proxy.ts's per-instance org cache (60 s) expires, an instance may still answer from a stale
        // entry: 403 "suspended" (cached at the second Suspend) or — seen once, an instance that cached the org
        // as ACTIVE — a /dashboard ↔ /login redirect loop for the held session (ERR_TOO_MANY_REDIRECTS). Both are
        // recorded as annotations; the state must converge on 404 "Organization not found".
        const transient = new Set<string>();
        await expect
          .poll(async () => {
            let state: string;
            try {
              const r = await (orgPage as Page).goto(orgUrl(org.slug, "/dashboard"));
              state = `${r?.status()} ${(await r?.text())?.includes("Organization not found") ? "not-found" : "other"}`;
            } catch (e) {
              state = /ERR_TOO_MANY_REDIRECTS/.test(String(e)) ? "redirect-loop" : `error ${String(e).slice(0, 80)}`;
            }
            if (state !== "404 not-found") transient.add(state);
            return state;
          }, { timeout: PAGE_CACHE_MS, intervals: [5_000] })
          .toBe("404 not-found");
        for (const t of transient) test.info().annotations.push({ type: "transient (proxy org cache)", description: t });
        expect([...transient].filter((t) => !["403 other", "redirect-loop"].includes(t)), "only the known cache-window states").toEqual([]);        // the held session's API calls now fail too (the org is gone)
        expect((await ctx.request.get(B("/me"))).status()).toBeGreaterThanOrEqual(400);
      });

      expect(await settledProblems(s)).toEqual([]);
    }, sa.token);
  } finally {
    await ctx.close();
  }
});
