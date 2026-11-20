/**
 * Every page: access + render smoke (Task 12), generated from page-table.ts.
 *
 * Per row (page-table.ts `access`):
 *   - org / permission pages: unauthenticated → the Test Org's /login (content never rendered); org B's
 *     admin session → the Test Org's /login showing the cross-org notice (it is NOT clicked — that would
 *     sign the shared org-B session out); roles without the permission → /dashboard; the admin renders the
 *     page (HTTP 200, expected text, primary control enabled + React-hydrated, problem collector empty once
 *     the page's calls have settled — `settledProblems`);
 *     every other allowed role reaches it.
 *   - SuperAdmin pages: unauthenticated and an org session → /controls/login; the SA renders the page with
 *     an empty collector (a pageerror catches the AGENTS.md LoadingOverlay crash) and no global-error screen.
 *   - public pages: the anonymous render is the authorised render; signed-in visits land where pinned.
 * Plus: the apex 404 guard and subdomain routing, wizard pill gating (lock → Submit Design in the UI → unlock
 * → width edit saved on the Design canvas → re-lock without a reload), and KNOWN BUG / DECISION NEEDED pins.
 * Landing paths are polled (up to 15 s): many redirects arrive client-side in the RSC stream after a 200.
 *
 * Every expectation here was observed live on test.easeetool.com (Task 12 probe) and is the contract.
 * Data: params come from the factories (rgr-<runId>-…, ledgered, deleted at teardown); the wizard test uses
 * its own Test-Org projects. Nothing outside the Test Org / this run's org B is written; SA pages are only
 * READ (the seeded formula set and org B).
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect, rawContext } from "../api/sa-helpers";
import { runPassword, signIn } from "../api/sign-in";
import { coversPage } from "../fixtures/covers";
import type { Role, RunState } from "../fixtures/run-state";
import { deniedRolesFor, ROLES, ROLE_PERMISSIONS } from "../api/permissions";
import { distributorCompanyId, glassConfig, orgApi, tag } from "../api/project-helpers";
import { ok } from "../api/design-helpers";
import { distributorWall, materialCodes, priceItems } from "../api/quotation-helpers";
import { addSelection, sharedItems } from "../journeys/journey-helpers";
import { doorCfg } from "../engine/materials";
import { rgrSetSelectionConfig } from "../../e2e/db-helpers";
import { isSubdomain, orgUrl } from "../../e2e/helpers";
import {
  PAGES, CROSS_ORG_TEXT, DASHBOARD_TEXT, ORG_LOGIN_TEXT, SA_LOGIN_TEXT,
  fillPath, isOrgPage, orgRelative, type PageRow,
} from "./page-table";
import { isHydrated } from "./collect";
import {
  apexPathOf, expectLands, openAs, orgPathOf, orgTarget, param, paramsFor, readyWall, settledProblems, type Opened, type ParamDeps,
} from "./page-helpers";

coversPage("/[orgSlug]");
coversPage("/[orgSlug]/login");
coversPage("/[orgSlug]/dashboard");
coversPage("/[orgSlug]/inquiries");
coversPage("/[orgSlug]/inquiries/new");
coversPage("/[orgSlug]/inquiries/[inquiryId]");
coversPage("/[orgSlug]/inquiries/[inquiryId]/edit");
coversPage("/[orgSlug]/orders");
coversPage("/[orgSlug]/projects");
coversPage("/[orgSlug]/projects/new");
coversPage("/[orgSlug]/projects/[projectId]");
coversPage("/[orgSlug]/projects/[projectId]/configuration");
coversPage("/[orgSlug]/projects/[projectId]/design");
coversPage("/[orgSlug]/projects/[projectId]/edit");
coversPage("/[orgSlug]/projects/[projectId]/summary");
coversPage("/[orgSlug]/projects/[projectId]/quotation");
coversPage("/[orgSlug]/projects/[projectId]/update-configuration");
coversPage("/[orgSlug]/admin/catalog");
coversPage("/[orgSlug]/admin/inventory");
coversPage("/[orgSlug]/admin/product-pricing");
coversPage("/[orgSlug]/admin/settings");
coversPage("/[orgSlug]/admin/users");
coversPage("/[orgSlug]/admin/users/new");
coversPage("/[orgSlug]/admin/users/[userId]");
coversPage("/[orgSlug]/admin/external-companies");
coversPage("/[orgSlug]/admin/external-companies/new");
coversPage("/[orgSlug]/admin/external-companies/[companyId]");
coversPage("/controls");
coversPage("/controls/login");
coversPage("/controls/orgs");
coversPage("/controls/orgs/new");
coversPage("/controls/orgs/[orgId]");
coversPage("/controls/orgs/[orgId]/overview");
coversPage("/controls/orgs/[orgId]/users");
coversPage("/controls/orgs/[orgId]/roles");
coversPage("/controls/orgs/[orgId]/components");
coversPage("/controls/orgs/[orgId]/formula");
coversPage("/controls/workspace");
coversPage("/controls/admins");
coversPage("/controls/roles");
coversPage("/controls/users");
coversPage("/controls/component-types");
coversPage("/controls/formula-sets");
coversPage("/controls/formula-sets/[setId]");
coversPage("/controls/formula-sets/[setId]/new-version");
coversPage("/controls/audit-log");

// Rows are independent: spread them over the workers.
test.describe.configure({ mode: "parallel" });
// No traces for page tests: a trace.zip holds request headers and storage (session cookies, the Vercel bypass
// header), and nothing here needs one to diagnose — the error context + collector output name the problem.
test.use({ trace: "off" });

type Fx = { browser: import("@playwright/test").Browser; run: import("../fixtures/run-state").RunState };

/** Open `who`, run `body`, always close the context. */
async function withPage<T>(fx: Fx, who: Parameters<typeof openAs>[2], saToken: string | undefined, body: (o: Opened) => Promise<T>): Promise<T> {
  const o = await openAs(fx.browser, fx.run, who, saToken);
  try {
    return await body(o);
  } finally {
    await o.ctx.close();
  }
}

/** Target URL of a row (org-relative pages go to the Test Org's host / prefix). */
async function target(row: PageRow, d: ParamDeps): Promise<{ url: string; rel: string }> {
  const rel = fillPath(isOrgPage(row) ? orgRelative(row.path) : row.path, await paramsFor(row.path, d));
  return { url: isOrgPage(row) ? orgTarget(d.run, rel) : rel, rel };
}

const wizardNav = (o: Opened) => o.page.getByRole("navigation", { name: "Project wizard steps" });

/**
 * Text visible, the page hydrated (React owns the node), and — if the row has one — its primary control
 * ready. Project pages also need a hydrated wizard pill link (the breadcrumb's `wizard` namespace).
 */
async function expectRendered(o: Opened, row: PageRow): Promise<void> {
  const text = o.page.getByText(row.expectsText).filter({ visible: true }).first();
  await expect(text).toBeVisible();
  await expect.poll(() => isHydrated(text), { message: `${row.path}: page never hydrated` }).toBe(true);
  if (row.primary) {
    const el = o.page.getByRole(row.primary.role, { name: row.primary.name }).first();
    await expect(el).toBeVisible();
    await expect(el).toBeEnabled();
    await expect.poll(() => isHydrated(el), { message: `${row.path}: primary ${row.primary.role} "${row.primary.name}" is not hydrated (next-intl clientMessages class)` }).toBe(true);
    await el.click({ trial: true }); // actionable (not covered/inert) — never actually clicked
  }
  if (row.project) {
    const pill = wizardNav(o).getByRole("link", { name: "Project Details" });
    await expect(pill).toBeVisible();
    await expect.poll(() => isHydrated(pill), { message: `${row.path}: wizard pill link is not hydrated (wizard namespace)` }).toBe(true);
  }
}

/** Content of `row` must not be on the page (denied visits): no visible match of its text anywhere. */
async function expectNoContent(o: Opened, row: PageRow): Promise<void> {
  await expect(o.page.getByText(row.expectsText).filter({ visible: true })).toHaveCount(0);
}

/** The /controls crash class (shared LoadingOverlay / any provider-less client component) = global-error. */
async function expectNoGlobalError(o: Opened): Promise<void> {
  await expect(o.page.getByText("Something went wrong")).toHaveCount(0);
}

const roleHas = (role: Role, row: PageRow): boolean =>
  typeof row.access === "object" ? ROLE_PERMISSIONS[role].includes(row.access.permission) : true;

for (const row of PAGES) {
  test.describe(`page ${row.path}`, () => {
    const deps = ({ f, as, url, run }: { f: ParamDeps["f"]; as: { admin: ParamDeps["admin"] }; url: ParamDeps["url"]; run: ParamDeps["run"] }): ParamDeps =>
      ({ f, admin: as.admin, url, run });

    // ── org pages (any member, or a permission) ───────────────────────────────
    if (row.access === "org" || typeof row.access === "object") {
      test("unauthenticated → the Test Org's login; content never rendered", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "anon", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expectLands(() => orgPathOf(run, o.page.url()), "/login");
          await expect(o.page.getByText(ORG_LOGIN_TEXT)).toBeVisible();
          await expectNoContent(o, row);
        });
      });

      test("wrong org's session (org B admin) → the Test Org's login with the cross-org notice", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expectLands(() => orgPathOf(run, o.page.url()), "/login");
          await expect(o.page.getByText(CROSS_ORG_TEXT)).toBeVisible();
          await expect(o.page.getByText(`You are signed in to RGR ${run.runId} B.`, { exact: false })).toBeVisible(); // names org B only
          await expectNoContent(o, row);
        });
      });

      const denied = typeof row.access === "object" ? deniedRolesFor({ permission: row.access.permission }) : [];
      for (const role of denied) {
        test(`${role} (no ${(row.access as { permission: string }).permission}) → redirected to /dashboard`, async ({ browser, run, f, as, url }) => {
          const t = await target(row, deps({ f, as, url, run }));
          await withPage({ browser, run }, role, undefined, async (o) => {
            const res = await o.page.goto(t.url);
            expect(res?.status()).toBe(200);
            await expectLands(() => orgPathOf(run, o.page.url()), "/dashboard");
            await expect(o.page.getByText(DASHBOARD_TEXT).first()).toBeVisible();
            await expectNoContent(o, row);
          });
        });
      }

      test("admin: renders (200, text, hydrated controls, no console/page/network errors once settled)", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "admin", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expectLands(() => orgPathOf(run, o.page.url()), t.rel);
          await expectRendered(o, row);
          expect(await settledProblems(o)).toEqual([]);
        });
      });

      // External users reaching ANOTHER company's (here: an internal) project / inquiry is pinned
      // separately below (the 404 test), so detail pages are reached only by the internal member here.
      const scoped = /\[(projectId|inquiryId)\]/.test(row.path);
      const others = ROLES.filter((r) => r !== "admin" && roleHas(r, row) && !(scoped && (r === "distributor" || r === "architect")));
      if (others.length) {
        test(`other allowed roles reach it: ${others.join(", ")}`, async ({ browser, run, f, as, url }) => {
          const t = await target(row, deps({ f, as, url, run }));
          for (const role of others) {
            await withPage({ browser, run }, role, undefined, async (o) => {
              const res = await o.page.goto(t.url);
              expect(res?.status(), role).toBe(200);
              await expectLands(() => orgPathOf(run, o.page.url()), t.rel, role);
              await expect(o.page.getByText(row.expectsText).filter({ visible: true }).first(), role).toBeVisible();
            });
          }
        });
      }
    }

    // ── SuperAdmin console ────────────────────────────────────────────────────
    if (row.access === "sa") {
      test("unauthenticated → /controls/login", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "anon", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expectLands(() => apexPathOf(o.page.url()), "/controls/login");
          await expect(o.page.getByText(SA_LOGIN_TEXT)).toBeVisible();
          await expectNoContent(o, row);
        });
      });

      test("an org-user session (no SA session) → /controls/login", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "admin", undefined, async (o) => {
          await o.page.goto(t.url);
          await expectLands(() => apexPathOf(o.page.url()), "/controls/login");
          await expect(o.page.getByText(SA_LOGIN_TEXT)).toBeVisible();
          await expectNoContent(o, row);
        });
      });

      // The AGENTS.md LoadingOverlay crash (useTranslations with no provider under /controls) surfaces as a
      // pageerror + the global-error screen — that is what this test asserts; it does not look for the overlay.
      test("SuperAdmin: renders; no global-error screen; no console/page/network errors once settled", async ({ browser, run, f, as, url, sa }) => {
        const t = await target(row, deps({ f, as, url, run }));
        // Redirect-only rows (Stage 29 S29-3) land elsewhere; the row's text/primary describe the landing page.
        const lands = row.saLandsOn ? fillPath(row.saLandsOn, await paramsFor(row.path, deps({ f, as, url, run }))) : t.rel;
        await withPage({ browser, run }, "sa", sa.token, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expectLands(() => apexPathOf(o.page.url()), lands);
          await expectRendered(o, row);
          const problems = await settledProblems(o);
          await expectNoGlobalError(o);
          expect(problems).toEqual([]);
        });
      });
    }

    // ── public pages ──────────────────────────────────────────────────────────
    if (row.access === "public") {
      test("unauthenticated: renders (200, text, no console/page/network errors once settled)", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "anon", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expectLands(() => (isOrgPage(row) ? orgPathOf(run, o.page.url()) : apexPathOf(o.page.url())), row.landsOn?.anon ?? t.rel);
          await expectRendered(o, row);
          const problems = await settledProblems(o);
          if (row.path.startsWith("/controls")) await expectNoGlobalError(o);
          expect(problems).toEqual([]);
        });
      });

      if (row.landsOn?.signedIn) {
        const sa = row.path.startsWith("/controls");
        test(`signed in (${sa ? "SuperAdmin" : "Test-Org admin"}) → ${row.landsOn.signedIn}`, async ({ browser, run, f, as, url, sa: saClient }) => {
          const t = await target(row, deps({ f, as, url, run }));
          await withPage({ browser, run }, sa ? "sa" : "admin", sa ? saClient.token : undefined, async (o) => {
            const res = await o.page.goto(t.url);
            expect(res?.status()).toBe(200);
            await expectLands(() => (sa ? apexPathOf(o.page.url()) : orgPathOf(run, o.page.url())), row.landsOn!.signedIn!);
            await expect(o.page.getByText(row.landsOn!.signedInText!).first()).toBeVisible();
            expect(await settledProblems(o)).toEqual([]);
          });
        });
      }

      if (isOrgPage(row)) {
        test("wrong org's session (org B admin) → /login with the cross-org notice naming org B only", async ({ browser, run, f, as, url }) => {
          const t = await target(row, deps({ f, as, url, run }));
          await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
            await o.page.goto(t.url);
            await expectLands(() => orgPathOf(run, o.page.url()), "/login");
            await expect(o.page.getByText(CROSS_ORG_TEXT)).toBeVisible();
            await expect(o.page.getByText(`You are signed in to RGR ${run.runId} B.`, { exact: false })).toBeVisible();
            await expect(o.page.getByText(ORG_LOGIN_TEXT)).toHaveCount(0); // the form is replaced by the notice
          });
        });
      }
    }
  });
}

// ── table completeness ──────────────────────────────────────────────────────

test("page table, this file's coversPage() lines and the app's page.tsx files are the same set", () => {
  // Static check, repeated in tests/unit/regression-pages.test.ts; here it guards a run on a stale table.
  const src = fs.readFileSync(__filename, "utf-8");
  const literal = [...src.matchAll(/^coversPage\("([^"]+)"\);\r?$/gm)].map((m) => m[1]).sort();
  expect(PAGES.map((r) => r.path).sort()).toEqual(literal);
  expect(new Set(literal).size).toBe(literal.length);
});

// ── /controls org workspace (Stage 29) ──────────────────────────────────────

test.describe("controls: old flat URLs redirect into the org workspace; switching org keeps the tab", () => {
  const depsOf = ({ f, as, url, run }: { f: ParamDeps["f"]; as: { admin: ParamDeps["admin"] }; url: ParamDeps["url"]; run: ParamDeps["run"] }): ParamDeps =>
    ({ f, admin: as.admin, url, run });

  test("old URLs WITH ?orgId= → the same org's workspace tab (roleId / typeId carried over)", async ({ browser, run, f, as, url, sa }) => {
    const orgId = await param("orgId", depsOf({ f, as, url, run }));
    const cases: Array<[string, string, string]> = [
      [`/controls/users?orgId=${orgId}`, `/controls/orgs/${orgId}/users`, ""],
      [`/controls/roles?orgId=${orgId}`, `/controls/orgs/${orgId}/roles`, ""],
      [`/controls/roles?orgId=${orgId}&roleId=rgr-none`, `/controls/orgs/${orgId}/roles`, "?roleId=rgr-none"],
      [`/controls/component-types?orgId=${orgId}`, `/controls/orgs/${orgId}/components`, ""],
      [`/controls/component-types?orgId=${orgId}&typeId=rgr-none`, `/controls/orgs/${orgId}/components`, "?typeId=rgr-none"],
    ];
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      for (const [from, path, search] of cases) {
        const res = await o.page.goto(from);
        expect(res?.status(), from).toBe(200);
        await expectLands(() => apexPathOf(o.page.url()), path, from);
        expect(new URL(o.page.url()).search, from).toBe(search);
        expect(await o.page.getByText("Something went wrong").count(), from).toBe(0);
      }
    });
  });

  test("the org dropdown lists every org (search finds the Test Org) and switching keeps the tab, dropping ?typeId=", async ({ browser, run, f, as, url, sa }) => {
    const orgId = await param("orgId", depsOf({ f, as, url, run }));
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      await o.page.goto(`/controls/orgs/${orgId}/components?typeId=rgr-none`);
      await expectLands(() => apexPathOf(o.page.url()), `/controls/orgs/${orgId}/components`);
      const trigger = o.page.getByRole("button", { name: "Organization", exact: true });
      await expect(trigger).toBeVisible();
      await expect.poll(() => isHydrated(trigger), { message: "org dropdown never hydrated" }).toBe(true);
      await trigger.click();
      await o.page.getByRole("textbox", { name: "Search organizations" }).fill(run.testOrg.slug);
      const option = o.page.getByRole("option").filter({ hasText: run.testOrg.slug }).first();
      await expect(option).toBeVisible();
      await option.click();
      await expectLands(() => apexPathOf(o.page.url()), `/controls/orgs/${run.testOrg.id}/components`);
      expect(new URL(o.page.url()).search, "tab-local ?typeId= is dropped").toBe("");
      await expect(o.page.getByText("Create new component type")).toBeVisible();
    });
  });
});

test.describe("controls: fix round 2", () => {
  test("org workspace header has no 'Back to organizations' link and starts with the org name", async ({ browser, run, sa }) => {
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      await o.page.goto(`/controls/orgs/${run.testOrg.id}/overview`);
      await expect(o.page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await o.page.getByText("Back to organizations").count()).toBe(0);
    });
  });

  test("audit log: 'Hide testeraccount activity' toggles ?hideTest=1, keeps it across paging, hides that account's rows", async ({ browser, run, sa }) => {
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      await o.page.goto("/controls/audit-log");
      const box = o.page.getByLabel("Hide testeraccount activity");
      await expect(box).toBeVisible();
      await expect(box).not.toBeChecked(); // default unchecked
      await expect.poll(() => isHydrated(box), { message: "audit filters never hydrated" }).toBe(true);
      await box.click(); // controlled by the URL: click, not check() (the state flips only after navigation)
      await expect.poll(() => new URL(o.page.url()).searchParams.get("hideTest")).toBe("1");
      await expect(o.page.getByTestId("audit-count")).toBeVisible();
      // the "By" column (3rd cell) only — a row ABOUT testeraccount by another admin legitimately stays
      await expect(o.page.getByTestId("audit-row").locator("td:nth-child(3)").filter({ hasText: /^testeraccount$/ })).toHaveCount(0);
      // reload keeps it (URL is the state)
      await o.page.reload();
      await expect(o.page.getByLabel("Hide testeraccount activity")).toBeChecked();
      // the pager links carry the param
      for (const name of ["Previous", "Next"]) {
        expect(await o.page.getByRole("link", { name, exact: true }).getAttribute("href")).toContain("hideTest=1");
      }
      await o.page.getByLabel("Hide testeraccount activity").click();
      await expect.poll(() => new URL(o.page.url()).searchParams.has("hideTest")).toBe(false);
    });
  });
});

// ── routing ─────────────────────────────────────────────────────────────────

test.describe("routing", () => {
  test("apex 404 guard: a non-root, non-/controls path on the apex host → 404 (subdomain hosts only)", async ({ browser, run }) => {
    if (!isSubdomain) {
      test.info().annotations.push({ type: "precondition", description: "path-mode target: the apex guard only exists on *.easeetool.com hosts (Task 3 mode log) — not exercised" });
      return;
    }
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      for (const p of ["/projects", "/dashboard", `/${run.testOrg.slug}/login`]) {
        const res = await o.page.goto(p);
        expect(res?.status(), p).toBe(404);
        expect(apexPathOf(o.page.url()), p).toBe(p);
      }
    });
  });

  test("subdomain routing: /controls is apex-only — an org subdomain 404s it (even with an SA session)", async ({ browser, run, sa }) => {
    if (!isSubdomain) {
      test.info().annotations.push({ type: "precondition", description: "path-mode target: no org subdomains — not exercised" });
      return;
    }
    for (const who of ["admin", "sa"] as const) {
      await withPage({ browser, run }, who, sa.token, async (o) => {
        const res = await o.page.goto(orgUrl(run.testOrg.slug, "/controls/orgs"));
        expect(res?.status(), who).toBe(404);
        await expect(o.page.getByRole("heading", { name: "Page not found" }), who).toBeVisible();
      });
    }
  });

  test("an unknown org slug 404s before any page renders", async ({ browser, run }) => {
    await withPage({ browser, run }, "anon", undefined, async (o) => {
      const res = await o.page.goto(orgUrl(`${run.prefix}nope`, "/login"));
      expect(res?.status()).toBe(404);
      expect(await res?.text()).toContain("Organization not found");
    });
  });

  // Stage 33 S33-26: the inquiry list lives in app/[orgSlug]/inquiries/(list)/ and the detail has no loading.tsx, so
  // notFound() runs before any Suspense boundary and the response is a real 404 (it used to be a 200 shell).
  test("an unknown inquiry id is an HTTP 404 on the detail and edit pages; a real id is a 200 (read-only)", async ({ browser, run, f }) => {
    const known = await f.inquiry(); // ledgered rgr- inquiry; only read here
    const unknown = randomUUID();
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      for (const rel of [`/inquiries/${unknown}`, `/inquiries/${unknown}/edit`]) {
        const res = await o.page.goto(orgTarget(run, rel));
        expect(res?.status(), rel).toBe(404);
        await expect(o.page.getByRole("heading", { name: "Page not found" }), rel).toBeVisible();
      }
      for (const rel of [`/inquiries/${known.id}`, "/inquiries"]) {
        const res = await o.page.goto(orgTarget(run, rel));
        expect(res?.status(), rel).toBe(200);
      }
    });
  });
});

// ── wizard gating ───────────────────────────────────────────────────────────

test.describe("wizard pills: Summary/Quotation lock until Submit Design, re-lock after a design edit", () => {
  const STEPS = ["Project Details", "Configuration", "Design", "Summary", "Quotation"] as const;

  async function pillState(o: Opened): Promise<Record<string, "open" | "locked">> {
    const nav = wizardNav(o);
    await expect(nav).toBeVisible();
    const out: Record<string, "open" | "locked"> = {};
    for (const s of STEPS) {
      const locked = await nav.locator('span[aria-disabled="true"]', { hasText: s }).count();
      const open = await nav.getByRole("link", { name: new RegExp(s) }).count();
      expect(locked + open, `${s}: exactly one pill`).toBe(1);
      out[s] = locked ? "locked" : "open";
    }
    return out;
  }

  test("no selections: Design/Summary/Quotation locked and their URLs bounce to Project Details", async ({ browser, run, f }) => {
    const p = await f.project();
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      await o.page.goto(orgTarget(run, `/projects/${p.id}`));
      expect(await pillState(o)).toEqual({ "Project Details": "open", Configuration: "open", Design: "locked", Summary: "locked", Quotation: "locked" });
      for (const step of ["design", "summary", "quotation"]) {
        await o.page.goto(orgTarget(run, `/projects/${p.id}/${step}`));
        await expectLands(() => orgPathOf(run, o.page.url()), `/projects/${p.id}`, step);
      }
      expect(await settledProblems(o)).toEqual([]);
    });
  });

  test("Submit Design (UI) unlocks Summary/Quotation; a width edit saved on the Design canvas re-locks them with no reload", async ({ browser, run, f, as, url }) => {
    test.setTimeout(180_000);
    const w = await readyWall(f, as.admin, url);
    const detail = orgTarget(run, `/projects/${w.projectId}`);
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      // 1. Not submitted yet.
      await o.page.goto(detail);
      expect(await pillState(o)).toEqual({ "Project Details": "open", Configuration: "open", Design: "open", Summary: "locked", Quotation: "locked" });
      for (const step of ["summary", "quotation"]) {
        await o.page.goto(orgTarget(run, `/projects/${w.projectId}/${step}`));
        await expectLands(() => orgPathOf(run, o.page.url()), `/projects/${w.projectId}`, step);
      }

      // 2. The real flow: click Submit Design on the Design page; the page router.refresh()es → pills unlock.
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design`));
      const submit = o.page.getByRole("button", { name: /^Submit Design$/ });
      await expect(submit).toBeEnabled();
      await expect.poll(() => isHydrated(submit)).toBe(true);
      const [resp] = await Promise.all([
        o.page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/projects/${w.projectId}/submit-design`)),
        submit.click(),
      ]);
      expect(resp.status(), await resp.text()).toBe(200);
      await expect.poll(async () => (await pillState(o)).Summary, { timeout: 20_000 }).toBe("open");
      expect(await pillState(o)).toMatchObject({ Design: "open", Summary: "open", Quotation: "open" });
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/summary`));
      await expectLands(() => orgPathOf(run, o.page.url()), `/projects/${w.projectId}/summary`);
      await expect(o.page.getByRole("button", { name: "Export PDF" }).filter({ visible: true })).toBeVisible();

      // 3. Open the wall in the Design canvas's Configure mode (the problem popup's deep link). Before the edit
      //    the pills are still unlocked.
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${w.partitionId}`));
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible();
      expect(await pillState(o)).toMatchObject({ Design: "open", Summary: "open", Quotation: "open" });

      // 4. Change a real value through the canvas UI (width 2000 → 2100 mm) and Save. From here on there is NO
      //    page.goto / reload: the pills must re-lock through the page's own router.refresh() (the Stage 25
      //    bug class: a Design save path that forgets it leaves Summary/Quotation open on a stale design).
      //    Stage 34 (D-11): the wall width is an always-live input; a typed value applies ONLY via its tick or Enter.
      const width = o.page.getByLabel("Partition width");
      await expect(width).toHaveValue("2000"); // mm display — the unit the API speaks
      await width.fill("2100");
      await o.page.getByRole("button", { name: "Apply width", exact: true }).click();
      await expect(width).toHaveValue("2100");
      await expect(o.page.getByTestId("wall-width-tick")).toHaveCount(0); // applied and closed, not refused
      const save = o.page.getByRole("button", { name: "Save changes" });
      await expect(save).toBeEnabled();
      const [patch] = await Promise.all([
        o.page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(`/partitions/${w.partitionId}`)),
        save.click(),
      ]);
      expect(patch.status(), await patch.text()).toBe(200);
      await expect(o.page.getByRole("button", { name: "Saved" })).toBeVisible();
      await expect.poll(async () => (await pillState(o)).Summary, { timeout: 20_000, message: "Summary pill did not re-lock after a Design save (no router.refresh?)" }).toBe("locked");
      expect(await pillState(o)).toMatchObject({ Design: "open", Summary: "locked", Quotation: "locked" });

      // The server agrees: the saved width is real and the submission is cleared.
      const pr = await as.admin.get(url(`/partitions/${w.partitionId}`));
      expect(pr.status()).toBe(200);
      expect(((await pr.json()) as { partition: { widthMm: number } }).partition.widthMm).toBe(2100);
      const pj = await as.admin.get(url(`/projects/${w.projectId}`));
      expect(((await pj.json()) as { project: { designSubmittedAt: string | null } }).project.designSubmittedAt).toBeNull();
      expect(await settledProblems(o)).toEqual([]);

      // 5. And the locked URLs bounce again.
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/summary`));
      await expectLands(() => orgPathOf(run, o.page.url()), `/projects/${w.projectId}`);
    });
  });

  test("Design canvas (Stage 34): typed widths apply only via the tick / Enter; a typed width locks its panel, the others absorb, and the lock survives Save + reload", async ({ browser, run, f, as, url }) => {
    test.setTimeout(180_000);
    const w = await readyWall(f, as.admin, url);
    const cell = (id: string) => [{ id, heightMm: 2400, selectionId: w.selectionId }];
    const put = await as.admin.patch(url(`/partitions/${w.partitionId}`), {
      data: { heightMm: 2400, design: { schemaVersion: 2, sections: [
        { id: "s1", widthMm: 800, cells: cell("c1") }, { id: "s2", widthMm: 800, cells: cell("c2") }, { id: "s3", widthMm: 800, cells: cell("c3") },
      ] } },
    });
    expect(put.status(), await put.text()).toBe(200);
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${w.partitionId}`));
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible();
      const panels = o.page.locator("[role='button'][aria-selected]").filter({ visible: true });
      await expect(panels).toHaveCount(3);
      const widths = async () => (await panels.allInnerTexts()).map((t) => Number(/P\d+ · (\d+) mm/.exec(t)?.[1]));
      const locks = o.page.getByTestId("panel-lock").filter({ visible: true });
      const menu = () => o.page.getByRole("menu");
      const input = () => menu().locator("input[type='number']");

      // Escape discards a typed value (nothing applied, nothing locked)
      await panels.nth(0).click({ button: "right" });
      await input().fill("1500");
      await o.page.keyboard.press("Escape");
      await expect(menu()).toHaveCount(0);
      expect(await widths()).toEqual([800, 800, 800]);
      await expect(locks).toHaveCount(0);

      // Enter applies: P1 = 1000, the others absorb, P1 shows the lock
      await panels.nth(0).click({ button: "right" });
      await input().fill("1000");
      await input().press("Enter");
      expect(await widths()).toEqual([1000, 700, 700]);
      await expect(locks).toHaveCount(1);

      // The tick applies P2 = 1000: P1 stays 1000, only P3 changes
      await panels.nth(1).click({ button: "right" });
      await input().fill("1000");
      await menu().getByRole("button", { name: "Apply width", exact: true }).click();
      expect(await widths()).toEqual([1000, 1000, 400]);
      await expect(locks).toHaveCount(2);

      // Every other panel locked: the typed value is refused inline and the menu stays open
      await panels.nth(2).click({ button: "right" });
      await input().fill("500");
      await input().press("Enter");
      await expect(menu().getByRole("alert")).toHaveText("Unlock a panel to absorb the difference");
      await o.page.keyboard.press("Escape");
      expect(await widths()).toEqual([1000, 1000, 400]);

      // Save + reload: widths and locks survive
      await o.page.getByRole("button", { name: "Save changes" }).click();
      await expect(o.page.getByRole("button", { name: "Saved", exact: true })).toBeVisible({ timeout: 15_000 });
      const pr = await as.admin.get(url(`/partitions/${w.partitionId}`));
      const sections = ((await pr.json()) as { partition: { design: { sections: Array<{ widthMm: number; locked?: boolean }> } } }).partition.design.sections;
      expect(sections.map((s) => [s.widthMm, s.locked ?? false])).toEqual([[1000, true], [1000, true], [400, false]]);
      await o.page.reload();
      await expect(panels).toHaveCount(3);
      expect(await widths()).toEqual([1000, 1000, 400]);
      await expect(locks).toHaveCount(2);
    });
  });

  test("Design canvas (Stage 34 B5): convert form with no door Selection - Door only is disabled with the (i) tooltip, and a client refusal (Panels 0) sends no request", async ({ browser, run, f, as, url }) => {
    test.setTimeout(120_000);
    const w = await readyWall(f, as.admin, url); // a glass Selection only: no DOOR in this project
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      const sidePatches: string[] = [];
      o.page.on("request", (r) => { if (r.method() === "PATCH" && /\/rooms\/[^/]+\/sides$/.test(r.url())) sidePatches.push(r.url()); });
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design`));
      const sides = o.page.locator("svg polygon.cursor-pointer").filter({ visible: true });
      await expect(sides).toHaveCount(4);
      await sides.nth(1).click(); // side 0 is the wall; side 1 is still PLAIN
      const convert = o.page.getByRole("button", { name: "Convert to Partition" });
      await expect(convert).toBeVisible();
      await expect(o.page.getByTestId("convert-panels").filter({ visible: true })).toHaveValue("3");
      const doorOnly = o.page.getByTestId("convert-door-only").filter({ visible: true });
      await expect(doorOnly).toBeDisabled();
      const tip = o.page.getByTestId("convert-door-only-tip").filter({ visible: true });
      const tipText = o.page.getByRole("tooltip").filter({ hasText: "No door is configured for this project" });
      await expect(tipText).toBeHidden();
      await tip.focus();
      await expect(tipText).toBeVisible();
      // client-side refusal: nothing is sent
      await o.page.getByLabel("Width (mm)").fill("1500");
      await o.page.getByLabel("Height (mm)").fill("2400");
      await o.page.getByTestId("convert-panels").filter({ visible: true }).fill("0");
      await convert.click();
      await expect(o.page.getByTestId("convert-options-error")).toHaveText("Enter 1 to 20 panels");
      expect(sidePatches, "a refused Panels value sends no sides PATCH").toEqual([]);
    });
  });

  test("Design canvas (Stage 34 B6): Duplicate room - icon + tooltip, prefilled prompt, a taken name keeps the prompt open with the error, success opens the copy, the unsaved-changes guard runs before the request (Cancel creates nothing, Save copies the saved edits, Discard copies the saved state)", async ({ browser, run, f, as, url }) => {
    test.setTimeout(180_000);
    const w = await readyWall(f, as.admin, url);
    const rooms = async () => (await as.admin.get(url(`/rooms?floorId=${w.floorId}`))).json() as Promise<{ rooms: { id: string; label: string }[] }>;
    const label = (await rooms()).rooms.find((r) => r.id === w.roomId)!.label;
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design`));
      const dup = o.page.getByTestId(`room-duplicate-${w.roomId}`).filter({ visible: true });
      await expect(dup).toBeVisible();
      await expect(dup).toHaveAttribute("title", "Duplicate");
      await dup.click();
      const name = o.page.getByLabel("Name of the copy");
      await expect(name).toHaveValue(`${label} copy`);

      // a taken name: 409 -> the error shows inside the prompt and the prompt stays open
      await name.fill(label);
      await o.page.getByRole("button", { name: "Duplicate", exact: true }).click();
      await expect(o.page.getByText("Name already exists on this floor")).toBeVisible();
      await expect(name).toBeVisible();
      expect((await rooms()).rooms).toHaveLength(1);

      // a free name: the copy is created, listed and opened
      const copyName = `${label}-b6`;
      await name.fill(copyName);
      await o.page.getByRole("button", { name: "Duplicate", exact: true }).click();
      await expect(name).toBeHidden();
      // M-2 (Stage 37 bugs-1): the label text also sits in the pulsing loading placeholder, so match the room row by its test id
      await expect(o.page.locator('[data-testid^="room-row-"]').filter({ hasText: copyName })).toBeVisible();
      const copy = (await rooms()).rooms.find((r) => r.label === copyName)!;
      expect(copy.id).not.toBe(w.roomId);
      expect((await rooms()).rooms).toHaveLength(2);

      // unsaved edits in Configure mode (D-32): the guard runs BEFORE the request.
      const partsOf = async (roomId: string) => ((await (await as.admin.get(url(`/partitions?roomId=${roomId}`))).json()) as { partitions: { widthMm: number }[] }).partitions;
      const dirtyWidth = async (mm: string) => {
        await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${w.partitionId}`));
        await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible();
        await o.page.getByLabel("Partition width").fill(mm);
        await o.page.getByRole("button", { name: "Apply width", exact: true }).click();
        await expect(o.page.getByRole("button", { name: "Save changes" })).toBeEnabled();
        await o.page.getByTestId(`room-duplicate-${w.roomId}`).filter({ visible: true }).click();
      };
      const dupBtn = () => o.page.getByRole("button", { name: "Duplicate", exact: true });
      const guard = o.page.getByText("Save changes?");

      // Cancel: nothing is created, the prompt stays open, still in Configure mode
      const second = `${label}-b6b`;
      await dirtyWidth("2100");
      await o.page.getByLabel("Name of the copy").fill(second);
      await dupBtn().click();
      await expect(guard).toBeVisible();
      await o.page.getByText("Cancel", { exact: true }).click();
      await expect(guard).toBeHidden();
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible();
      await expect(o.page.getByLabel("Name of the copy")).toBeVisible();
      expect((await rooms()).rooms.map((r) => r.label)).not.toContain(second);

      // Save: saves first, then duplicates, so the copy carries the edited width; the copy opens
      await dupBtn().click();
      await expect(guard).toBeVisible();
      await o.page.getByRole("button", { name: "Save & Go Back", exact: true }).click();
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeHidden();
      const saved = (await rooms()).rooms.find((r) => r.label === second)!;
      expect(saved, "Save then duplicate creates the copy").toBeTruthy();
      expect((await partsOf(saved.id)).map((p) => p.widthMm)).toEqual([2100]);
      expect((await partsOf(w.roomId)).map((p) => p.widthMm)).toEqual([2100]);

      // Discard: the edit is dropped, the copy is of the saved state (2100), and it opens
      const third = `${label}-b6c`;
      await dirtyWidth("2300");
      await o.page.getByLabel("Name of the copy").fill(third);
      await dupBtn().click();
      await expect(guard).toBeVisible();
      await o.page.getByRole("button", { name: "Discard Changes", exact: true }).click();
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeHidden();
      const discarded = (await rooms()).rooms.find((r) => r.label === third)!;
      expect(discarded, "Discard then duplicate creates the copy").toBeTruthy();
      expect((await partsOf(discarded.id)).map((p) => p.widthMm)).toEqual([2100]);
      expect((await partsOf(w.roomId)).map((p) => p.widthMm)).toEqual([2100]);
    });
  });

  test("Design canvas (Stage 34 B8): loading feedback - room switch shows the pending row + placeholder with one fetch per room and no cross-room bleed, cached partition opens with no fetch, re-clicks do nothing, the ?partition= deep link fetches once under the overlay, and the unsaved-changes modal spins, disables and ignores Escape / outside clicks while Save or Discard works", async ({ browser, run, f, as, url }) => {
    test.setTimeout(240_000);
    const w = await readyWall(f, as.admin, url);
    // a second room with one converted wall, so there is something to switch to
    const rb = await as.admin.post(url("/rooms"), { data: { floorId: w.floorId, label: `${run.prefix}RB` } });
    expect(rb.status(), await rb.text()).toBe(201);
    const roomB = ((await rb.json()) as { room: { id: string } }).room.id;
    const sb = await as.admin.patch(url(`/rooms/${roomB}/sides`), {
      data: {
        sides: [
          { kind: "PARTITION", turnDegrees: 90, label: `${run.prefix}Wall B`, heightMm: 2400, widthMm: 2000 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
          { kind: "PLAIN", turnDegrees: 90 },
        ],
      },
    });
    expect(sb.status(), await sb.text()).toBe(200);
    const partB = ((await sb.json()) as { room: { sides: { partitionId?: string }[] } }).room.sides[0].partitionId!;
    const roomA = w.roomId;
    const partA = w.partitionId;

    await withPage({ browser, run }, "admin", undefined, async (o) => {
      const page = o.page;
      const reqs: string[] = [];
      page.on("request", (r) => {
        if (r.method() !== "GET") return;
        const u = new URL(r.url());
        if (u.pathname.includes("/api/v1/orgs/")) reqs.push(u.pathname + u.search);
      });
      const roomFetches = (id: string) => reqs.filter((u) => u.endsWith(`/partitions?roomId=${id}`)).length;
      const partFetches = (id: string) => reqs.filter((u) => u.endsWith(`/partitions/${id}`)).length;
      const gate = () => {
        let release!: () => void;
        const p = new Promise<void>((r) => (release = r));
        return { p, release };
      };
      const plan = page.getByTestId("room-floor-plan").filter({ visible: true });
      const loading = page.getByTestId("room-canvas-loading").filter({ visible: true });
      const rowOf = (id: string) => page.getByTestId(`room-row-${id}`).filter({ visible: true });
      const partRow = (id: string) => page.getByTestId(`partition-row-${id}`).filter({ visible: true });
      const back = page.getByRole("button", { name: "Back to Room Layout" });

      // 1. Room switch. Both rooms' partition lists are held back so the pending states can be seen.
      const gateA = gate();
      const gateB = gate();
      await page.route(
        (u) => u.pathname.endsWith("/partitions") && !!u.searchParams.get("roomId"),
        async (route) => {
          const id = new URL(route.request().url()).searchParams.get("roomId");
          if (id === roomA) await gateA.p;
          if (id === roomB) await gateB.p;
          await route.continue();
        },
      );
      await page.goto(orgTarget(run, `/projects/${w.projectId}/design`));
      await expect(loading, "initial room: placeholder until its partitions arrive").toBeVisible();
      await rowOf(roomB).click();
      await expect(rowOf(roomB)).toHaveAttribute("data-pending", "true");
      await expect(loading).toBeVisible();
      await expect(plan, "the previous room's walls are gone at once").toHaveCount(0);
      gateB.release();
      await expect(plan).toHaveAttribute("data-room-id", roomB);
      await expect(plan).toHaveAttribute("data-partition-ids", partB);
      await expect(rowOf(roomB)).not.toHaveAttribute("data-pending", "true");
      // race: room A's slow reply lands after B is selected and must not touch B's canvas
      gateA.release();
      await page.waitForTimeout(700);
      await expect(plan).toHaveAttribute("data-room-id", roomB);
      await expect(plan).toHaveAttribute("data-partition-ids", partB);
      expect(roomFetches(roomB), "exactly one GET /partitions?roomId= for the first visit of B").toBe(1);
      expect(roomFetches(roomA), "A: one request, not two (the duplicate fetch is gone)").toBe(1);
      // back to A: its reply is cached -> no pending, no new request
      const before = reqs.length;
      await rowOf(roomA).click();
      await expect(plan).toHaveAttribute("data-room-id", roomA);
      await expect(plan).toHaveAttribute("data-partition-ids", partA);
      await expect(rowOf(roomA)).not.toHaveAttribute("data-pending", "true");
      await page.waitForTimeout(400);
      expect(reqs.slice(before).filter((u) => u.includes("/partitions")), "revisiting a loaded room makes no request").toEqual([]);

      // 2. Re-click of the open room: nothing is fetched or pending (the chevron only toggles)
      const b2 = reqs.length;
      await rowOf(roomA).click();
      await rowOf(roomA).click();
      await expect(rowOf(roomA)).not.toHaveAttribute("data-pending", "true");
      await expect(plan).toHaveAttribute("data-room-id", roomA);
      await page.waitForTimeout(400);
      expect(reqs.slice(b2).filter((u) => u.includes("/partitions"))).toEqual([]);

      // 3. A cached partition row opens Configure with no GET /partitions/{id} and no overlay left behind
      await expect(partRow(partA)).toBeVisible();
      await partRow(partA).click();
      await expect(back).toBeVisible();
      await expect(page.getByTestId("partition-open-overlay")).toHaveCount(0);
      expect(partFetches(partA), "no GET /partitions/{id} for a cached row").toBe(0);
      // re-click of the open partition: no fetch, no pending
      await partRow(partA).click();
      await page.waitForTimeout(400);
      expect(partFetches(partA)).toBe(0);
      await expect(partRow(partA)).not.toHaveAttribute("data-pending", "true");
      await expect(back).toBeVisible();
      await back.click();
      await expect(back).toBeHidden();

      // 4. ?partition= deep link: the fetch is held back, the overlay shows, then Configure opens (one fetch)
      const gateP = gate();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route(
        (u) => u.pathname.endsWith(`/partitions/${partB}`),
        async (route) => {
          if (route.request().method() === "GET") await gateP.p;
          await route.continue();
        },
      );
      const b4 = reqs.length;
      await page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${partB}`));
      await expect(page.getByTestId("partition-open-overlay")).toBeVisible();
      gateP.release();
      await expect(back).toBeVisible();
      await expect(page.getByTestId("partition-open-overlay")).toHaveCount(0);
      expect(reqs.slice(b4).filter((u) => u.endsWith(`/partitions/${partB}`)), "deep link: exactly one fetch").toHaveLength(1);

      // 5. Unsaved-changes modal: Save works while every button is disabled and Escape / outside clicks are ignored
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const dirty = async (mm: string) => {
        await page.getByLabel("Partition width").fill(mm);
        await page.getByRole("button", { name: "Apply width", exact: true }).click();
        await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
      };
      const dialog = page.getByRole("dialog");
      const saveBtn = page.getByRole("button", { name: "Save & Go Back", exact: true });
      const discardBtn = page.getByRole("button", { name: "Discard Changes", exact: true });
      const cancelBtn = dialog.getByRole("button", { name: "Cancel", exact: true });
      await dirty("2100");
      await back.click();
      await expect(dialog, "the guard still blocks Back").toBeVisible();
      await cancelBtn.click();
      await expect(dialog).toBeHidden();
      await expect(back).toBeVisible();

      const gateS = gate();
      await page.route(
        (u) => u.pathname.endsWith(`/partitions/${partB}`),
        async (route) => {
          if (route.request().method() === "PATCH") await gateS.p;
          await route.continue();
        },
      );
      await rowOf(roomA).click(); // a room switch with unsaved edits -> the same modal
      await expect(dialog).toBeVisible();
      await saveBtn.click();
      await expect(saveBtn).toHaveAttribute("aria-busy", "true");
      await expect(saveBtn).toBeDisabled();
      await expect(discardBtn).toBeDisabled();
      await expect(cancelBtn).toBeDisabled();
      await page.keyboard.press("Escape");
      await page.mouse.click(4, 4);
      await expect(dialog, "Escape and an outside click are ignored while pending").toBeVisible();
      gateS.release();
      await expect(dialog).toBeHidden();
      await expect(plan).toHaveAttribute("data-room-id", roomA);
      const saved = ((await (await as.admin.get(url(`/partitions?roomId=${roomB}`))).json()) as { partitions: { widthMm: number }[] }).partitions;
      expect(saved.map((p) => p.widthMm), "Save & Go Back saved first").toEqual([2100]);

      // 6. Discard spins the same way (the discard re-fetches the partition; that GET is held back)
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${partB}`));
      await expect(back).toBeVisible();
      await dirty("2300");
      const gateD = gate();
      await page.route(
        (u) => u.pathname.endsWith(`/partitions/${partB}`),
        async (route) => {
          if (route.request().method() === "GET") await gateD.p;
          await route.continue();
        },
      );
      await rowOf(roomA).click();
      await expect(dialog).toBeVisible();
      await discardBtn.click();
      await expect(discardBtn).toHaveAttribute("aria-busy", "true");
      await expect(saveBtn).toBeDisabled();
      await expect(discardBtn).toBeDisabled();
      await expect(cancelBtn).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      gateD.release();
      await expect(dialog).toBeHidden();
      await expect(plan).toHaveAttribute("data-room-id", roomA);
    });
  });

  test("Design canvas (Stage 34 B4): divider snap + lock, a locked panel is frozen (notice + Unlock), glass change keeps locked panels, door menus start with Lock, one menu at a time, layout holds", async ({ browser, run, f, as, url }) => {
    test.setTimeout(240_000);
    const c = { as, f, run };
    const slug = run.testOrg.slug;
    // S31-7: the DOOR codes must be Test-Org dropdown choices BEFORE the project (and its snapshot) exists
    const door = await sharedItems(c, "DOOR");
    const w = await readyWall(f, as.admin, url);
    const gA = await addSelection(as.admin, slug, w.projectId, "GLASS", `${run.prefix}B4 Glass A`, await glassConfig(f));
    await addSelection(as.admin, slug, w.projectId, "GLASS", `${run.prefix}B4 Glass B`, await glassConfig(f));
    const dSingle = await addSelection(as.admin, slug, w.projectId, "DOOR", `${run.prefix}B4 Door single`, doorCfg(door));
    const dDouble = await addSelection(as.admin, slug, w.projectId, "DOOR", `${run.prefix}B4 Door double`, doorCfg(door));
    await rgrSetSelectionConfig(dDouble, { ...doorCfg(door), isDoubleLeaf: "Yes" }); // the Test Org's DOOR type has no such field: DB write, Test Org only
    const cell = (id: string, sel: string, hinging?: string) => [{ id, heightMm: 2400, selectionId: sel, ...(hinging ? { hinging } : {}) }];
    const put = await as.admin.patch(url(`/partitions/${w.partitionId}`), {
      data: { heightMm: 2400, design: { schemaVersion: 2, sections: [
        { id: "s1", widthMm: 750, cells: cell("c1", gA) },
        { id: "s2", widthMm: 750, cells: cell("c2", dSingle, "left") },
        { id: "s3", widthMm: 750, cells: cell("c3", dDouble, "left") },
        { id: "s4", widthMm: 750, cells: cell("c4", gA) },
      ] } },
    });
    expect(put.status(), await put.text()).toBe(200);
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      await o.page.setViewportSize({ width: 1440, height: 900 });
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${w.partitionId}`));
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible();
      const panels = o.page.locator("[role='button'][aria-selected]").filter({ visible: true });
      await expect(panels).toHaveCount(4);
      const widths = async () => (await panels.allInnerTexts()).map((t) => Number(/P\d+ · (\d+) mm/.exec(t)?.[1]));
      const locks = o.page.getByTestId("panel-lock").filter({ visible: true });
      const notice = o.page.getByTestId("canvas-notice").filter({ visible: true });
      const menus = o.page.getByRole("menu");
      const item = (name: string | RegExp) => menus.getByRole("menuitem", { name });
      const doorOf = (i: number) => panels.nth(i).locator("div.absolute").first();
      const dividers = o.page.getByRole("separator").filter({ visible: true });
      const wallHeight = async () => Math.round((await panels.first().boundingBox())!.height * 10) / 10;
      const headerBox = () => o.page.getByLabel("Partition name").locator("xpath=..");
      const h0 = await wallHeight();
      const hdr0 = Math.round((await headerBox().boundingBox())!.height);

      // AC4 snapping: drag the P1|P2 divider (pair 1500 mm). 1005 is inside the 1000 pull: snapped; 750 (the
      // start) is free; release at 1000 -> P1 = 1000 and BOTH neighbours become locked.
      const first = (await panels.first().boundingBox())!;
      const lastBox = (await panels.last().boundingBox())!;
      const pxPerMm = (lastBox.x + lastBox.width - first.x) / 3000;
      const dv = (await dividers.nth(0).boundingBox())!;
      const grab = { x: dv.x + dv.width / 2, y: dv.y + dv.height / 2 };
      const toLeft = (mm: number) => o.page.mouse.move(grab.x + (mm - 750) * pxPerMm, grab.y, { steps: 4 });
      await o.page.mouse.move(grab.x, grab.y);
      await o.page.mouse.down();
      await toLeft(1005);
      await expect(dividers.nth(0)).toHaveAttribute("data-snapped", "true");
      await expect(dividers.nth(0)).toHaveAttribute("data-snap-step", "1000");
      await toLeft(750);
      await expect(dividers.nth(0)).not.toHaveAttribute("data-snapped", "true");
      await toLeft(1000);
      await o.page.mouse.up();
      expect(await widths()).toEqual([1000, 500, 750, 750]);
      await expect(locks).toHaveCount(2);
      expect(await wallHeight()).toBe(h0);
      await o.page.getByTestId("unlock-all").click();
      await expect(locks).toHaveCount(0);

      // D-49: rail Width field rejects '-', '+', 'e', 'E' (fix-3 numeric guard).
      // doEnterConfigureMode pre-selects P1; clicking the already-sole selection deselects it
      // (design-page-stage34.html:2540 — alreadySoleSelection ? null : ...). Click P4 first to
      // move selection away, then click P1 to become the sole selection → #rail-width-input renders.
      await panels.nth(3).click(); // P4 — sole selection moves away from P1
      await panels.nth(0).click(); // P1 — now sole selection → #rail-width-input renders
      const railWidthInput = o.page.locator("#rail-width-input");
      await railWidthInput.focus();
      await o.page.keyboard.type("-");
      expect(await railWidthInput.inputValue(), "rail Width: '-' must be blocked").not.toContain("-");
      // Also verify paste of '1400--' is rejected (paste guard covers multi-char junk).
      await railWidthInput.fill("");
      await railWidthInput.evaluate((el: HTMLInputElement) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "1400--");
        el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      });
      expect(await railWidthInput.inputValue(), "rail Width: paste of '1400--' must be blocked").not.toContain("--");
      await o.page.keyboard.press("Escape");

      // AC3: every door menu starts with Lock panel; the double leaf has no hinge items
      await doorOf(1).click({ button: "right" });
      await expect(menus).toHaveCount(1);
      await expect(menus.getByRole("menuitem").first()).toHaveText(/Lock panel/);
      await expect(item(/hinge/i)).toHaveCount(2);
      // one menu at a time: a panel menu replaces the door menu, a door menu replaces the panel menu
      await panels.nth(0).click({ button: "right" });
      await expect(menus).toHaveCount(1);
      await expect(item("Split the panel")).toBeVisible();
      await doorOf(2).click({ button: "right" });
      await expect(menus).toHaveCount(1);
      await expect(menus.getByRole("menuitem").first()).toHaveText(/Lock panel/);
      await expect(item(/hinge/i)).toHaveCount(0);
      await item("Lock panel").click(); // locks P3 (the double-leaf door)
      await expect(locks).toHaveCount(1);
      await doorOf(2).click({ button: "right" });
      await expect(menus.getByRole("menuitem").first()).toHaveText(/Unlock panel/);
      await o.page.keyboard.press("Escape");

      // AC1: a locked panel is frozen. Lock P2 (single door) from its door menu: the hinge items grey out.
      await doorOf(1).click({ button: "right" });
      await item("Lock panel").click();
      await expect(locks).toHaveCount(2);
      await doorOf(1).click({ button: "right" });
      await expect(item(/Left hinge/)).toBeDisabled();
      await o.page.keyboard.press("Escape");
      // rail paths on the locked single-door P2 (the notice shows in the canvas, D-16). `solo` selects P2 alone,
      // which also clears any earlier notice.
      const solo = async () => {
        await panels.nth(0).click();
        await panels.nth(1).click();
        await expect(notice).toHaveCount(0);
      };
      const railItem = (label: string) => o.page.getByText(`${run.prefix}${label}`, { exact: true });
      await solo();
      await railItem("B4 Door double").click(); // swap the door
      await expect(notice).toHaveText(/Panel is locked/);
      await expect(doorOf(1)).toHaveCount(1);
      await solo();
      await railItem("B4 Door single").click(); // the active door again = remove it
      await expect(notice).toHaveText(/Panel is locked/);
      await expect(doorOf(1)).toHaveCount(1);
      await solo();
      const slider = o.page.locator("input[type='range']");
      await slider.focus();
      await o.page.keyboard.press("ArrowLeft"); // door height
      await expect(notice).toHaveText(/Panel is locked/);
      await expect(slider).toHaveValue("2400");
      await solo();
      await o.page.locator("#rail-width-input").click(); // the read-only Width field
      await expect(notice).toHaveText(/Panel is locked/);
      expect(await widths()).toEqual([1000, 500, 750, 750]);
      // split / unite are greyed in a locked panel's menu (P4 is glass, so its panel menu is reachable)
      await panels.nth(3).click({ button: "right" });
      await item("Lock panel").click();
      await expect(locks).toHaveCount(3);
      await panels.nth(3).click({ button: "right" });
      await expect(item("Split the panel")).toBeDisabled();
      await expect(item(/Unite/)).toBeDisabled();
      await item("Unlock panel").click();
      await expect(locks).toHaveCount(2);
      // toolbar Remove on a locked panel: refused with the notice, the wall is unchanged
      await panels.nth(1).click();
      await o.page.getByRole("button", { name: "− Remove Panel" }).click();
      await expect(panels).toHaveCount(4);
      await expect(notice).toHaveText(/Panel is locked/);
      expect(await widths()).toEqual([1000, 500, 750, 750]);
      expect(await wallHeight()).toBe(h0); // the notice never changes the wall's drawn height
      expect(Math.round((await headerBox().boundingBox())!.height)).toBe(hdr0);
      // a divider next to a locked panel can't be dragged
      const dvb = (await dividers.nth(0).boundingBox())!;
      await o.page.mouse.move(dvb.x + dvb.width / 2, dvb.y + dvb.height / 2);
      await o.page.mouse.down();
      await o.page.mouse.move(dvb.x + 60, dvb.y + dvb.height / 2, { steps: 5 });
      await o.page.mouse.up();
      expect(await widths()).toEqual([1000, 500, 750, 750]);
      await expect(dividers.nth(0)).toHaveAttribute("data-blocked", "true");
      await expect(notice).toHaveText(/Panel is locked/);
      // Unlock from the notice unlocks the panel the attempt was about
      await notice.getByRole("button", { name: /Unlock/ }).click();
      await expect(locks).toHaveCount(1);

      // AC2: a glass change applies to unlocked panels only; no "applies to every panel" caption. With only the
      // full-height double door (no glass cell) locked, nothing "kept its glass": no note.
      await expect(o.page.getByText("Applies to every panel on this wall")).toHaveCount(0);
      await panels.nth(0).click();
      await o.page.getByText(`${run.prefix}B4 Glass B`, { exact: true }).click();
      await expect(notice).toHaveCount(0);
      // lock the glass panel P4 (now Glass B), switch to Glass A: P4 keeps B and the note counts exactly it
      await panels.nth(3).click({ button: "right" });
      await item("Lock panel").click();
      await o.page.getByText(`${run.prefix}B4 Glass A`, { exact: true }).click();
      await expect(notice).toHaveText(/^1 locked panel kept its glass/);
      await expect(panels.nth(3)).toContainText("Glass B");
      await expect(panels.nth(0)).toContainText("Glass A");
      await panels.nth(3).click({ button: "right" });
      await item("Unlock panel").click();
      await expect(locks).toHaveCount(1);
      // multi-select Remove skips locked panels and counts them: P3 (locked) + P4
      await panels.nth(2).click();
      await panels.nth(3).click({ modifiers: ["Control"] });
      await o.page.getByRole("button", { name: "− Remove Panel" }).click();
      await expect(panels).toHaveCount(3);
      await expect(notice).toHaveText(/1 locked panel skipped/);
      expect(await wallHeight()).toBe(h0);

      // AC5: a 120-character wall name keeps the header on one row and the wall the same height
      const nameInput = o.page.getByLabel("Partition name");
      await nameInput.fill("W".repeat(120));
      await nameInput.blur();
      expect(Math.round((await headerBox().boundingBox())!.height)).toBe(hdr0);
      expect(await wallHeight()).toBe(h0);
      const bar = await o.page.getByRole("button", { name: "Add Panel" }).locator("xpath=..").boundingBox();
      expect(bar!.height).toBeLessThan(50); // one toolbar row at 1440
    });
  });
});

// ── KNOWN BUG / DECISION NEEDED pins (today's behaviour; the comment says what "fixed" looks like) ──

test.describe("pins", () => {
  test("external users (distributor, architect) get the app's 404 on another company's project and inquiry pages (their lists hide them too)", async ({ browser, run, f, as }) => {
    // Fixed by Hotfix 2026-10-05 (HF-1/HF-4; backlog 2026-10-04 "Cross-company access by id"): the detail/edit
    // pages read through the API, which now answers 404 for a foreign record, and each page maps a non-OK
    // response to notFound(). Same denial as a random UUID.
    const p = await f.project(); // internal: no external company
    const inq = await f.inquiry();
    expect(await distributorCompanyId({ run, as })).toBeTruthy();
    for (const who of ["distributor", "architect"] as const) {
      await withPage({ browser, run }, who, undefined, async (o) => {
        for (const rel of [
          `/projects/${p.id}`,
          `/projects/${p.id}/edit`,
          `/projects/${p.id}/design`,
          `/projects/${p.id}/summary`,
          `/inquiries/${inq.id}`,
          `/inquiries/${inq.id}/edit`,
        ]) {
          // No status assertion: the routes stream behind a loading.tsx, so notFound() can arrive after a 200 shell.
          await o.page.goto(orgTarget(run, rel));
          await expect(o.page.getByRole("heading", { name: "Page not found" }), `${who} ${rel}`).toBeVisible();
        }
        // ... and their own lists do not show them (anchored on the list's empty-filter state):
        await o.page.goto(orgTarget(run, `/projects?search=${encodeURIComponent(p.name)}`));
        await expect(o.page.getByText("No projects match your filters.").filter({ visible: true }), who).toBeVisible();
        await expect(o.page.getByText(p.name), who).toHaveCount(0);
        await o.page.goto(orgTarget(run, `/inquiries?search=${encodeURIComponent(inq.name)}`));
        await expect(o.page.getByText("No inquiries match your filters.").filter({ visible: true }), who).toBeVisible();
        await expect(o.page.getByText(inq.name), who).toHaveCount(0);
      });
    }
  });

  test("/organizations is gone: 404 on the apex and on an org subdomain, listing no tenant (Stage 31 S31-6)", async ({ browser, run }) => {
    // Was the DECISION NEEDED pin (a public listing of every tenant). The page and the proxy matcher exclusion
    // were removed, so the path answers the app's 404 everywhere.
    const hosts = isSubdomain ? ["/organizations", orgUrl(run.testOrg.slug, "/organizations")] : ["/organizations"];
    await withPage({ browser, run }, "anon", undefined, async (o) => {
      for (const h of hosts) {
        const res = await o.page.goto(h);
        expect(res?.status(), h).toBe(404);
        await expect(o.page.getByText(`/${run.testOrg.slug}`, { exact: true }), h).toHaveCount(0);
        await expect(o.page.getByText(`/${run.orgB.slug}`, { exact: true }), h).toHaveCount(0);
      }
    });
  });
});

// Stage 35 Batch 4 — visibility UI. Throwaway org B only: its own type + project go with org B at teardown, so no
// shared Test-Org data is touched (rule 10 n/a). One fixture type: root `kind`, then `hasLeaf` and gated fields,
// all depending on `kind` (the production DOOR shape: tier-2 column with bands) plus an independent `hinge`.
test.describe("Stage 35 B4: visibility UI (Configuration form, Catalog, SuperAdmin edit form), throwaway org B", () => {
  test.describe.configure({ mode: "serial" });
  const VALS = (...v: string[]) => ({ valueMap: { K1: v, K2: v } });
  const fld = (key: string, label: string, over: Record<string, unknown> = {}) =>
    ({ key, label, type: "dropdown", required: false, basic: true, ...over });
  const dep = { dependsOn: "kind" };
  const SCHEMA = [
    fld("kind", "Kind", { required: true }),
    fld("hasLeaf", "Has Leaf", { required: true, ...dep }),
    fld("leafCode", "Leaf Code", { required: true, ...dep, inventoryLinked: true, showWhen: { field: "hasLeaf", in: ["Yes"] } }),
    fld("leafNote", "Leaf Note", { type: "field", showWhen: { field: "hasLeaf", in: ["Yes"] } }),
    fld("rackCode", "Rack Code", { required: true, ...dep, showWhen: { field: "hasLeaf", in: ["No"] } }),
    fld("partialA", "Partial A", { ...dep, showWhen: { field: "hasLeaf", in: ["Partial"] } }),
    fld("partialB", "Partial B", { ...dep, showWhen: { field: "hasLeaf", in: ["Partial"] } }),
    fld("hinge", "Hinge", { inventoryLinked: true }), // Stage 35 B6: a second offending (independent) linked field
  ];
  const CONFIG = {
    fieldOptionsConfig: {
      kind: { options: ["K1", "K2"] },
      hasLeaf: VALS("Yes", "No"),
      leafCode: VALS("L1", "L2"),
      rackCode: VALS("R1", "R2"),
      partialA: VALS("P1", "P2"),
      partialB: VALS("Q1", "Q2"),
      hinge: { options: ["H1", "H2"] },
    },
  };

  /** The fixture type, configured, then a project frozen AFTER it (its snapshot carries the rules). */
  async function fixture(run: RunState, orgB: import("../fixtures/clients").Guarded) {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const cats = (await ok<{ categories: { id: string }[] }>(await orgB.get(B("/component-categories")))).categories;
    const code = `RGRW${tag().toUpperCase()}`;
    const type = (await ok<{ componentType: { id: string; name: string; code: string } }>(
      await orgB.post(B("/component-types"), { data: { code, name: `${run.prefix}vis-${tag()}`, categoryId: cats[0].id, fieldsSchema: SCHEMA } }),
      201,
    )).componentType;
    await ok(await orgB.put(B(`/component-types/${type.id}/field-values`), { data: CONFIG }));
    const project = (await ok<{ project: { id: string } }>(await orgB.post(B("/projects"), { data: { name: `${run.prefix}vis-${tag()}`, currency: "AED" } }), 201)).project;
    return { B, type, projectId: project.id };
  }
  // Fixtures are test-scoped, so the shared type + project are built by the first test that needs them (serial mode, one worker).
  let fxP: ReturnType<typeof fixture> | undefined;
  const getFx = (run: RunState, orgB: import("../fixtures/clients").Guarded) => (fxP ??= fixture(run, orgB));

  type Page = import("@playwright/test").Page;
  /** The control wrapper (label + input) of a Configuration-form field, by its label text. */
  const field = (page: Page, label: string) => page.locator("label", { hasText: new RegExp(`^${label}\\b`) }).locator("xpath=..");
  const pick = async (page: Page, label: string, value: string) => {
    await field(page, label).getByRole("combobox").click();
    await page.getByRole("option", { name: value, exact: true }).click();
  };

  test("UI AC1 Configuration form: hidden fields do not render, values clear when hidden, switching back shows them empty, the saved body has no hidden key", async ({ browser, run, orgB }) => {
    test.setTimeout(120_000);
    const fx = await getFx(run, orgB);
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      const actionBodies: string[] = [];
      page.on("request", (r) => { if (r.method() === "POST" && r.headers()["next-action"]) actionBodies.push(r.postDataBuffer()?.toString("utf8") ?? ""); });
      await page.goto(orgUrl(run.orgB.slug, `/projects/${fx.projectId}/configuration`));
      await page.getByRole("button", { name: fx.type.name }).click();
      const hidden = ["Leaf Code", "Leaf Note", "Rack Code", "Partial A", "Partial B"];
      await expect(field(page, "Kind")).toBeVisible();
      await pick(page, "Kind", "K1");
      for (const l of hidden) await expect(page.locator("label", { hasText: new RegExp(`^${l}\\b`) }), `${l} hidden while Has Leaf is blank`).toHaveCount(0);

      await pick(page, "Has Leaf", "Yes");
      await expect(field(page, "Leaf Code")).toBeVisible();
      await expect(field(page, "Leaf Note")).toBeVisible();
      await expect(page.locator("label", { hasText: /^Rack Code\b/ })).toHaveCount(0);
      await pick(page, "Leaf Code", "L1");
      await field(page, "Leaf Note").locator("input").fill("note-1");

      // required + visible: refused client-side before any request
      await page.locator("#sel-label").fill(`${run.prefix}vis-sel`);
      const before = actionBodies.length;
      await pick(page, "Has Leaf", "Yes");
      await page.getByRole("button", { name: "Add Component" }).click();
      await expect(page.getByText('"Leaf Code" is required.')).toBeVisible(); // re-picking Has Leaf cleared its dependent; the controller value is kept
      expect(actionBodies.length, "a refused save sends no request").toBe(before);
      await pick(page, "Leaf Code", "L1");

      await pick(page, "Has Leaf", "No");
      for (const l of ["Leaf Code", "Leaf Note"]) await expect(page.locator("label", { hasText: new RegExp(`^${l}\\b`) }), `${l} gone at once`).toHaveCount(0);
      await expect(field(page, "Rack Code")).toBeVisible();

      await pick(page, "Has Leaf", "Yes");
      await expect(field(page, "Leaf Code").getByRole("combobox")).toHaveText("Select"); // cleared: shows empty
      await expect(field(page, "Leaf Note").locator("input")).toHaveValue("");

      await pick(page, "Has Leaf", "No");
      await pick(page, "Rack Code", "R1");
      await pick(page, "Hinge", "H1");
      await page.getByRole("button", { name: "Add Component" }).click();
      await expect.poll(async () => (await ok<{ selections: { config: Record<string, unknown> }[] }>(await orgB.get(fx.B(`/selections?projectId=${fx.projectId}`)))).selections.length).toBe(1);
      const sel = (await ok<{ selections: { config: Record<string, unknown> }[] }>(await orgB.get(fx.B(`/selections?projectId=${fx.projectId}`)))).selections[0];
      expect(sel.config).toEqual({ kind: "K1", hasLeaf: "No", rackCode: "R1", hinge: "H1" });
      const saved = actionBodies.filter((b) => b.includes("rackCode")).join("\n");
      expect(saved, "the submitted body carries the visible gated key").toContain("rackCode");
      expect(saved, "no hidden key in the submitted body").not.toMatch(/leafCode|leafNote/);
    });
  });

  test("UI AC3 org Catalog: a Yes band and a No band, focus/dim, the never-shown warning band + pill, attribute-editor chips with the lock", async ({ browser, run, orgB }) => {
    test.setTimeout(120_000);
    const fx = await getFx(run, orgB);
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/admin/catalog"));
      await page.getByRole("tab", { name: new RegExp(`\\(${fx.type.code}\\)`) }).click();
      const bands = page.getByTestId("show-band").filter({ visible: true });
      await expect(bands).toHaveCount(3);
      await expect(bands.filter({ hasText: /Shown when Has Leaf = Yes/ })).toHaveCount(1);
      await expect(bands.filter({ hasText: /Shown when Has Leaf = No/ })).toHaveCount(1);
      const warn = bands.filter({ hasText: /Shown when Has Leaf = Partial/ });
      await expect(warn).toHaveCount(1);
      await expect(warn.getByText("These fields can never appear")).toBeVisible();
      await expect(warn.getByRole("img", { name: /has no value Partial/ })).toBeVisible();
      await expect(bands.filter({ hasText: /Yes/ }).first().getByText("These fields can never appear")).toHaveCount(0);
      await expect(page.getByTestId("never-shown-pill").filter({ visible: true })).toHaveText(/2 never shown/);

      // focus/dim: hovering the controller lights its bands' fields and dims the unrelated independent field
      await page.getByRole("button", { name: /^Edit Has Leaf/ }).filter({ visible: true }).hover();
      await expect(page.locator('[data-node-id="hinge"]').filter({ visible: true })).toHaveClass(/opacity-40/);
      await expect(page.locator('[data-node-id="leafCode"]').filter({ visible: true })).not.toHaveClass(/opacity-40/);
      await expect(page.locator('[data-node-id="rackCode"]').filter({ visible: true })).not.toHaveClass(/opacity-40/);

      // editor chips: read-only, lock + "Set by platform admin", Linked to inventory
      await page.getByRole("button", { name: /^Edit Leaf Code/ }).filter({ visible: true }).click();
      const chips = page.getByTestId("attr-chips");
      await expect(chips).toContainText("Values by Kind");
      await expect(chips).toContainText("Shown when Has Leaf = Yes");
      await expect(chips.getByRole("img", { name: "Set by platform admin" })).toBeVisible();
      await expect(chips).toContainText("Linked to inventory");
    });
  });

  // Stage 35 Batch 6 — inventory-link UI + quick-add. Org B only: the quick-added rows live in org B and go with it
  // at teardown (the org hard-delete cascades every org-scoped table), so no Test-Org / shared data is touched.
  // The `hinge` field is linked too, so there are two offending fields (the pill needs two to step through).
  test("B6/B8 UI AC1-AC3 org Catalog (MANAGE_PRICING): cube + red card tag + pill, card/tag/pill open the editor, the pill steps in tree order, chip badges + tooltip + live unsaved flag, quick-add drawer locks code, type and Part and has no price, the badge and counts drop, keyboard path, a 409 shows inline and keeps the typed values", async ({ browser, run, orgB }) => {
    test.setTimeout(180_000);
    const fx = await getFx(run, orgB);
    // an item with code H2 but NO component type: it still counts as missing for the type, and makes the quick-add of H2 a 409
    await ok(await orgB.post(fx.B("/inventory"), { data: { code: "H2", name: `${run.prefix}vis-dup`, measurementUnit: "pieces" } }), 201);
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/admin/catalog"));
      await page.getByRole("tab", { name: new RegExp(`\\(${fx.type.code}\\)`) }).click();
      const vis = (id: string) => page.getByTestId(id).filter({ visible: true });
      const node = (key: string) => page.locator(`[data-node-id="${key}"]`).filter({ visible: true });
      const dlg = page.getByRole("dialog").filter({ visible: true });
      const pill = vis("not-in-inventory-pill");
      const closeEditor = async () => { await dlg.getByRole("button", { name: "Cancel" }).click(); await expect(dlg).toHaveCount(0); };

      // AC1: cube on linked cards only, red tag on the offending cards, header pill = missing values across the type
      await expect(pill).toHaveText("4 not in inventory");
      await expect(node("leafCode").getByTestId("linked-icon")).toBeVisible();
      await expect(node("hinge").getByTestId("linked-icon")).toBeVisible();
      await expect(node("kind").getByTestId("linked-icon")).toHaveCount(0);
      await expect(vis("not-in-inventory-tag")).toHaveCount(2);
      await expect(node("leafCode").getByTestId("not-in-inventory-tag")).toBeVisible();

      // card, tag and pill each open that field's editor
      await node("hinge").getByRole("button", { name: /^Edit Hinge/ }).click();
      await expect(dlg.getByRole("heading", { name: "Hinge", exact: true })).toBeVisible();
      await closeEditor();
      await node("leafCode").getByTestId("not-in-inventory-tag").click();
      await expect(dlg.getByRole("heading", { name: "Leaf Code", exact: true })).toBeVisible();
      await closeEditor();
      // repeated pill clicks step through the offenders in tree order (tier column, then the independent lane), then wrap
      for (const label of ["Leaf Code", "Hinge", "Leaf Code"]) {
        await pill.click();
        await expect(dlg.getByRole("heading", { name: label, exact: true })).toBeVisible();
        await closeEditor();
      }

      // Batch 8: a corner badge per offending chip (H1, H2), the field-header pill, a tooltip on hover with an icon add button
      const shot = async (name: string) => { if (process.env.B8_SHOTS) await page.screenshot({ path: `${process.env.B8_SHOTS}/b8-${name}.png` }); };
      const badges = dlg.getByTestId("value-not-in-inventory");
      const tip = page.getByRole("tooltip").filter({ visible: true });
      const addBtn = page.getByTestId("inventory-badge-add").filter({ visible: true });
      await node("hinge").getByRole("button", { name: /^Edit Hinge/ }).click();
      await expect(badges).toHaveCount(2);
      await expect(dlg.getByTestId("editor-not-in-inventory-pill")).toHaveText("2 not in inventory");
      await expect(tip).toHaveCount(0);
      await shot("rest");
      await badges.nth(0).hover();
      await expect(tip).toContainText("Not in inventory");
      await expect(addBtn).toHaveAttribute("aria-label", "Add to inventory");
      await expect(addBtn).toHaveAttribute("title", "Add to inventory");
      await shot("hover");
      const box = (await badges.nth(0).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24); // the 24px hit area
      await page.mouse.move(5, 5);
      await expect(tip).toHaveCount(0);
      // AC1 live: a value typed into the editor is flagged BEFORE Save (and counted), removing it clears it; nothing is saved
      await dlg.getByLabel("Add value", { exact: true }).fill("LIVE-Z");
      await dlg.getByRole("button", { name: "Add", exact: true }).click();
      await expect(badges).toHaveCount(3);
      await expect(dlg.getByTestId("editor-not-in-inventory-pill")).toHaveText("3 not in inventory");
      await shot("unsaved");
      await dlg.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Discard" }).click();
      await expect(dlg).toHaveCount(0);
      await expect(pill).toHaveText("4 not in inventory");

      // AC2: quick-add (badge -> tooltip -> icon add button -> the unchanged side panel)
      await node("hinge").getByRole("button", { name: /^Edit Hinge/ }).click();
      await expect(badges).toHaveCount(2);
      // keyboard path: focus the badge -> tooltip -> Tab -> the add button is focused -> Escape closes the tooltip only
      await badges.nth(1).focus();
      await expect(tip).toContainText("Not in inventory");
      await page.keyboard.press("Tab");
      await expect(addBtn).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(tip).toHaveCount(0);
      await expect(dlg).toBeVisible();
      await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
      await badges.nth(1).click();
      await addBtn.click();
      // Stage 37 B3-D2/D3: the shared Inventory drawer opens over the editor, type, Part and Code locked
      const panel = page.getByRole("dialog", { name: "New item" });
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId("quick-add-code")).toContainText("H2");
      await expect(panel.getByTestId("quick-add-type")).toContainText(fx.type.name);
      await expect(panel.getByTestId("quick-add-part")).toContainText("Hinge");
      await expect(panel.getByText(/price/i)).toHaveCount(0); // G0-c: no price field
      await expect(panel.getByLabel("Pack size")).toHaveValue("1");

      // AC3: a 409 duplicate code shows inline and keeps what was typed
      await panel.getByLabel("Name", { exact: false }).first().fill("Hinge two");
      await panel.getByLabel("Pack size").fill("2.5");
      await panel.getByRole("combobox").click();
      await page.getByRole("option", { name: "set (Sets)", exact: true }).click();
      await panel.getByRole("button", { name: "Create item" }).click();
      await expect(panel.getByText("This code is already in use.").first()).toBeVisible();
      await expect(panel.getByRole("alert")).toBeVisible();
      await expect(panel.getByLabel("Name", { exact: false }).first()).toHaveValue("Hinge two");
      await expect(panel.getByLabel("Pack size")).toHaveValue("2.5");
      await expect(panel.getByRole("combobox")).toContainText("set");
      await panel.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Discard", exact: true }).last().click(); // dirty drawer: Discard changes?
      await expect(panel).toHaveCount(0);
      await expect(dlg.getByTestId("editor-not-in-inventory-pill")).toHaveText("2 not in inventory"); // the editor kept its state

      // the successful add: the editor's missing count and the pill drop by one
      await badges.nth(0).click();
      await addBtn.click();
      await panel.getByLabel("Name", { exact: false }).first().fill("Hinge one");
      await panel.getByRole("combobox").click();
      await page.getByRole("option", { name: "m (Metre)", exact: true }).click();
      await panel.getByRole("button", { name: "Create item" }).click();
      await expect(panel).toHaveCount(0);
      await expect(badges).toHaveCount(1); // H1's badge is gone; no "In inventory" text
      await expect(dlg.getByTestId("editor-not-in-inventory-pill")).toHaveText("1 not in inventory");
      await shot("after-add");
      await closeEditor();
      await expect(pill).toHaveText("3 not in inventory");
      await expect(node("hinge").getByTestId("not-in-inventory-tag")).toBeVisible(); // H2 is still missing

      // the item exists (GET inventory), typed to this component type, no price rows (G0-c); a reload agrees
      const items = (await ok<{ items: { code: string; name: string; componentTypeId: string | null; measurementUnit: string; perUnitQuantity: unknown; prices?: unknown[] }[] }>(await orgB.get(fx.B("/inventory")))).items;
      const h1 = items.find((i) => i.code === "H1")!;
      expect(h1, "the quick-added item exists").toBeTruthy();
      expect(h1.name).toBe("Hinge one");
      expect(h1.componentTypeId).toBe(fx.type.id);
      expect(h1.measurementUnit).toBe("metres");
      expect(Number(h1.perUnitQuantity)).toBe(1);
      expect(h1.prices ?? []).toHaveLength(0);
      await page.reload();
      await page.getByRole("tab", { name: new RegExp(`\\(${fx.type.code}\\)`) }).click();
      await expect(vis("not-in-inventory-pill")).toHaveText("3 not in inventory");
    });
  });

  // Isolated actor (review-b6-1 IMPORTANT): its own org-B role (MANAGE_FEATURES only) + user, created here and
  // deleted with org B. org B's shared admin role is never edited, so parallel specs' org-B inventory calls are unaffected.
  test("B6 UI AC2 without MANAGE_PRICING: the red card tag, pill and chip badges remain, the tooltip is text only (no add button) (own org-B role + user, MANAGE_FEATURES only)", async ({ browser, run, sa, orgB, ledger, playwright, baseURL }) => {
    test.setTimeout(150_000);
    const fx = await getFx(run, orgB);
    const SAB = "/api/v1/superadmin";
    const perms = (await ok<{ permissions: { id: string; code: string }[] }>(await sa.get(`${SAB}/permissions`))).permissions;
    const role = (await ok<{ role: { id: string } }>(await sa.post(`${SAB}/roles`, { data: { orgId: run.orgB.id, name: `${run.prefix}nopricing-${tag()}` } }), 201)).role;
    await ok(await sa.post(`${SAB}/roles/${role.id}/permissions`, { data: { orgId: run.orgB.id, permissionId: perms.find((p) => p.code === "MANAGE_FEATURES")!.id } }), 201);
    // custom roles are external: the user needs an org-B external company
    const coName = `${run.prefix}nopricing-co-${tag()}`;
    await ok(await orgB.post(fx.B("/external-companies"), { data: { name: coName, type: "DISTRIBUTOR", country: "UAE", defaultCurrency: "AED" } }), 201);
    const co = (await ok<{ companies: { id: string; name: string }[] }>(await orgB.get(fx.B("/external-companies")))).companies.find((c) => c.name === coName)!;
    const username = `${run.prefix}nopr-${tag()}`;
    const u = await sa.post(`${SAB}/orgs/${run.orgB.id}/users`, { data: { firstName: "Rgr", lastName: "NoPricing", username, roleId: role.id, externalCompanyId: co.id, password: runPassword() } });
    const text = await u.text();
    if (u.status() === 201) ledger.add({ kind: "user", id: (JSON.parse(text) as { user: { id: string } }).user.id, orgSlug: run.orgB.slug, label: username });
    expect(u.status(), text).toBe(201);

    const api = await rawContext(playwright, baseURL);
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    let ctx: import("@playwright/test").BrowserContext | undefined;
    try {
      expect((await signIn(api, run.orgB.slug, username, runPassword())).status()).toBe(200);
      ctx = await browser.newContext({
        baseURL: process.env.PLAYWRIGHT_BASE_URL,
        extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {},
        storageState: await api.storageState(),
      });
      const page = await ctx.newPage();
      await page.goto(orgUrl(run.orgB.slug, "/admin/catalog"));
      await page.getByRole("tab", { name: new RegExp(`\\(${fx.type.code}\\)`) }).click();
      await expect(page.getByTestId("not-in-inventory-pill").filter({ visible: true })).toBeVisible();
      const tag35 = page.locator('[data-node-id="leafCode"]').filter({ visible: true }).getByTestId("not-in-inventory-tag");
      await expect(tag35).toBeVisible();
      await tag35.click();
      const dlg = page.getByRole("dialog").filter({ visible: true });
      const badges = dlg.getByTestId("value-not-in-inventory");
      await expect(badges).toHaveCount(4); // L1, L2 under each of the two Kind groups: a badge per chip
      await badges.first().hover();
      await expect(page.getByRole("tooltip").filter({ visible: true })).toHaveText("Not in inventory"); // text only
      await expect(page.getByTestId("inventory-badge-add")).toHaveCount(0);
      await expect(dlg.getByRole("button", { name: /to inventory/ })).toHaveCount(0);
      // the server gate agrees: this role cannot create inventory items
      expect((await api.post(fx.B("/inventory"), { data: { code: "X", name: "x", measurementUnit: "pieces" } })).status()).toBe(403);
    } finally {
      await ctx?.close();
      await api.dispose();
    }
  });

  test("UI AC2 SuperAdmin edit form: Show-when lists only earlier dropdown/radio fields, value chips, Linked toggle on dropdown/radio only, retyping clears Linked, a server 400 shows inline", async ({ browser, run, sa, orgB }) => {
    test.setTimeout(150_000);
    const fx = await getFx(run, orgB);
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      const page = o.page;
      const edit = `/controls/orgs/${run.orgB.id}/components?typeId=${fx.type.id}`;
      await page.goto(edit);
      const rows = page.getByTestId("field-row").filter({ visible: true });
      await expect(rows).toHaveCount(SCHEMA.length);
      const leaf = rows.nth(2); // leafCode
      await expect(leaf.getByRole("combobox").filter({ hasText: "Has Leaf" })).toBeVisible();
      await expect(leaf.getByTestId("showwhen-values")).toContainText("Yes");
      await expect(leaf.getByRole("switch", { name: "Linked to inventory" })).toHaveAttribute("aria-checked", "true");
      await expect(rows.nth(3).getByRole("switch")).toHaveCount(0); // text field: no Linked toggle
      await expect(rows.nth(1).getByRole("switch", { name: "Linked to inventory" })).toHaveAttribute("aria-checked", "false");

      // controller list = "Always shown" + earlier dropdown/radio fields only
      await leaf.getByRole("combobox").filter({ hasText: "Has Leaf" }).click();
      await expect(page.getByRole("option")).toHaveText(["Always shown", "Kind", "Has Leaf"]);
      await page.keyboard.press("Escape");

      // MINOR 2: retyping a linked dropdown to a text field clears Linked, and Save does not 400
      await leaf.getByRole("combobox").filter({ hasText: "Dropdown" }).click();
      await page.getByRole("option", { name: "Field (text)" }).click();
      await expect(leaf.getByRole("switch")).toHaveCount(0);
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect.poll(async () => {
        const t = (await ok<{ componentType: { fieldsSchema: { key: string; type: string; inventoryLinked?: boolean }[] } }>(await sa.get(`/api/v1/superadmin/component-types/${fx.type.id}?orgId=${run.orgB.id}`))).componentType;
        const f = t.fieldsSchema.find((x) => x.key === "leafCode")!;
        return `${f.type}/${f.inventoryLinked ?? "absent"}`;
      }).toBe("field/absent");

      // a server 400 (showWhen with no values) shows inline, nothing is stored
      await page.goto(edit);
      await expect(rows).toHaveCount(SCHEMA.length);
      const target = rows.nth(7); // hinge: Always shown -> controller Kind -> no values
      await target.getByRole("combobox").filter({ hasText: "Always shown" }).click();
      await page.getByRole("option", { name: "Kind", exact: true }).click();
      await expect(target.getByTestId("showwhen-values")).toBeVisible();
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page.getByText(/showWhen\.in must be a non-empty array/)).toBeVisible();
    });
  });
  // review-b4-1 MINOR 2: the create form's new inline-400 path (it used to throw to the error boundary) and the
  // JSON-mode round trip of showWhen / inventoryLinked, neither of which had a UI step. Creates nothing (the 400 is the point).
  test("UI AC2 SuperAdmin create form: JSON mode round-trips showWhen + inventoryLinked, and a server 400 (showWhen with no values) shows inline with the typed code/name kept", async ({ browser, run, sa, orgB }) => {
    test.setTimeout(150_000);
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      const page = o.page;
      await page.goto(`/controls/orgs/${run.orgB.id}/components`);
      const rows = page.getByTestId("field-row").filter({ visible: true });
      const schema = [
        { key: "kind", label: "Kind", type: "dropdown", required: true, basic: true },
        { key: "gate", label: "Gate", type: "dropdown", required: false, basic: true, inventoryLinked: true, showWhen: { field: "kind", in: ["A"] } },
      ];
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      await page.locator("textarea").fill(JSON.stringify(schema));
      await page.getByRole("button", { name: "Form", exact: true }).click();
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(1).getByRole("switch", { name: "Linked to inventory" })).toHaveAttribute("aria-checked", "true");
      await expect(rows.nth(1).getByTestId("showwhen-values")).toContainText("A");
      // back to JSON: both keys survived the Form round trip
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const text = await page.locator("textarea").inputValue();
      expect(JSON.parse(text)[1]).toMatchObject({ key: "gate", inventoryLinked: true, showWhen: { field: "kind", in: ["A"] } });
      await page.getByRole("button", { name: "Form", exact: true }).click();

      // empty the controller's values, fill code/name/category, Save: the server's 400 shows inline, the inputs keep their values
      await rows.nth(1).getByRole("button", { name: "Remove A" }).click();
      const code = `RGRC${tag().toUpperCase()}`;
      await page.locator("#code").fill(code);
      await page.locator("#name").fill(`${run.prefix}create-400`);
      await page.getByRole("combobox").first().click();
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: "Create Component Type" }).click();
      await expect(page.getByText(/showWhen\.in must be a non-empty array/)).toBeVisible();
      await expect(page.locator("#code")).toHaveValue(code);
      await expect(page.locator("#name")).toHaveValue(`${run.prefix}create-400`);
      const listed = (await ok<{ componentTypes: { code: string }[] }>(await orgB.get(orgApi(run.orgB.slug, "/component-types")))).componentTypes;
      expect(listed.some((t) => t.code === code), "the refused create stored nothing").toBe(false);
    });
  });
});

// Stage 36 Batch 1 UI AC5: the SuperAdmin "Product spec" toggle. Throwaway org B only (its own type goes with org B at
// teardown), so no Test-Org schema is touched and there is nothing to restore (rule 10 n/a).
test.describe("Stage 36 B1: Product spec toggle (SuperAdmin edit form), throwaway org B", () => {
  test("UI AC5: toggle only on dropdown/radio, saves and survives reload; the type-change confirm (Keep type / Change type) and the inline dependency guard error", async ({ browser, run, sa, orgB }) => {
    test.setTimeout(150_000);
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const cats = (await ok<{ categories: { id: string }[] }>(await orgB.get(B("/component-categories")))).categories;
    const fld = (key: string, label: string, over: Record<string, unknown> = {}) =>
      ({ key, label, type: "dropdown", required: false, basic: true, ...over });
    const type = (await ok<{ componentType: { id: string; code: string } }>(
      await orgB.post(B("/component-types"), { data: { code: `RGRP${tag().toUpperCase()}`, name: `${run.prefix}spec-${tag()}`, categoryId: cats[0].id, fieldsSchema: [fld("glass", "Glass type"), fld("thick", "Thickness", { dependsOn: "glass" }), fld("note", "Note", { type: "field" })] } }),
      201,
    )).componentType;
    const stored = async () => (await ok<{ componentType: { fieldsSchema: { key: string; type: string; productSpec?: boolean }[] } }>(
      await sa.get(`/api/v1/superadmin/component-types/${type.id}?orgId=${run.orgB.id}`),
    )).componentType.fieldsSchema.map((f) => `${f.key}:${f.type}:${f.productSpec ?? "absent"}`);
    await withPage({ browser, run }, "sa", sa.token, async (o) => {
      const page = o.page;
      const edit = `/controls/orgs/${run.orgB.id}/components?typeId=${type.id}`;
      await page.goto(edit);
      const rows = page.getByTestId("field-row").filter({ visible: true });
      await expect(rows).toHaveCount(3);
      const spec = (i: number) => rows.nth(i).getByRole("switch", { name: "Product spec" });
      // toggle only on dropdown/radio rows
      await expect(spec(0)).toHaveAttribute("aria-checked", "false");
      await expect(spec(1)).toHaveAttribute("aria-checked", "false");
      await expect(spec(2)).toHaveCount(0);
      // the dependency guard: a child flagged while its parent is not shows the server's message inline, nothing stored
      await spec(1).click();
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect(page.getByText(/a Product spec field that depends on/)).toBeVisible();
      expect(await stored()).toEqual(["glass:dropdown:absent", "thick:dropdown:absent", "note:field:absent"]);
      await page.goto(edit);
      await expect(rows).toHaveCount(3);
      // turn it on, save, reload: it survived
      await spec(0).click();
      await expect(spec(0)).toHaveAttribute("aria-checked", "true");
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect.poll(stored).toEqual(["glass:dropdown:true", "thick:dropdown:absent", "note:field:absent"]);
      await page.goto(edit);
      await expect(spec(0)).toHaveAttribute("aria-checked", "true");
      // the list's "Product specs" column counts flagged fields (1 spec for this type)
      await page.goto(`/controls/orgs/${run.orgB.id}/components`);
      const listRow = page.getByRole("row").filter({ hasText: type.code }).filter({ visible: true });
      await expect(listRow.getByTestId("product-specs-count")).toHaveText("1 spec");
      await page.goto(edit);
      await expect(rows).toHaveCount(3);

      // retype a flagged field: the confirm shows; Keep type leaves both unchanged
      const typeBox = () => rows.nth(0).getByRole("combobox").filter({ hasText: "Dropdown" });
      await typeBox().click();
      await page.getByRole("option", { name: "Field (text)" }).click();
      const confirm = rows.nth(0).getByRole("alertdialog");
      await expect(confirm).toContainText("Product spec requires Dropdown or Radio.");
      await confirm.getByRole("button", { name: "Keep type" }).click();
      await expect(confirm).toHaveCount(0);
      await expect(typeBox()).toBeVisible();
      await expect(spec(0)).toHaveAttribute("aria-checked", "true");
      // a pending confirm is dropped on a move attempt (here the move itself is refused: thick depends on glass)
      await typeBox().click();
      await page.getByRole("option", { name: "Field (text)" }).click();
      await expect(rows.nth(0).getByRole("alertdialog")).toBeVisible();
      await rows.nth(0).getByRole("button", { name: "Move down" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(spec(0)).toHaveAttribute("aria-checked", "true");
      await expect(typeBox()).toBeVisible();
      // Change type clears the flag (and the toggle goes away with the choice type)
      await typeBox().click();
      await page.getByRole("option", { name: "Field (text)" }).click();
      await rows.nth(0).getByRole("alertdialog").getByRole("button", { name: "Change type" }).click();
      await expect(spec(0)).toHaveCount(0);
      await page.getByRole("button", { name: "Save Changes" }).click();
      await expect.poll(stored).toEqual(["glass:field:absent", "thick:dropdown:absent", "note:field:absent"]);

    });
  });
});

// Stage 36 Batch 3 UI AC1-AC4: the Product Pricing admin page. Throwaway org B only: its types, pricing rows and the
// option removal that orphans a row all go with org B at teardown (rule 10 n/a, nothing in the Test Org is written).
// The GET-failure banner (UI AC2) is a server-side fetch, so a browser route cannot fail it; it is covered by the page code
// path and the by-design 4xx/5xx API specs, not here.
// M-1 (Stage 37 bugs-1): was test.describe.serial, so one failure skipped the rest of the block as "did not run" (and
// AC4 / AC3b, which depend on earlier tests' rows, never reported their own result). Now every test builds its OWN
// component type and rows in org B (`getFx` is not cached), so the tests are independent: they run in the file's
// parallel mode and each one reports its own pass or fail. (A mode "default" describe would still inherit the file's
// parallel mode, so it would not pin the order either.)
test.describe("Stage 36 B3: Product Pricing admin page, throwaway org B", () => {
  const fld = (key: string, label: string, over: Record<string, unknown> = {}) =>
    ({ key, label, type: "dropdown", required: false, basic: true, ...over });
  const SCHEMA = [
    fld("glass", "Glass type", { productSpec: true }),
    fld("thick", "Thickness", { productSpec: true, dependsOn: "glass" }),
    fld("note", "Note"),
  ];
  const CONFIG = {
    fieldOptionsConfig: {
      glass: { options: ["Single", "Double"] },
      thick: { valueMap: { Single: ["8 mm", "12 mm"], Double: ["12 mm"] } },
      note: { options: ["x"] },
    },
  };
  type Guarded = import("../fixtures/clients").Guarded;
  async function fixture(run: RunState, orgB: Guarded) {
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const cats = (await ok<{ categories: { id: string }[] }>(await orgB.get(B("/component-categories")))).categories;
    const mk = async (code: string, fieldsSchema: unknown[]) =>
      (await ok<{ componentType: { id: string; code: string } }>(
        await orgB.post(B("/component-types"), { data: { code, name: `${run.prefix}pp-${code}`, categoryId: cats[0].id, fieldsSchema } }),
        201,
      )).componentType;
    const spec = await mk(`RGRPP${tag().toUpperCase()}`, SCHEMA);
    await ok(await orgB.put(B(`/component-types/${spec.id}/field-values`), { data: CONFIG }));
    const plain = await mk(`RGRPN${tag().toUpperCase()}`, [fld("kind", "Kind")]);
    return { B, typeId: spec.id, code: spec.code, plainCode: plain.code };
  }
  const getFx = (run: RunState, orgB: Guarded) => fixture(run, orgB);
  const key = (glass: string, thick: string) => JSON.stringify({ glass, thick });

  test("UI AC1 flyout: Product Pricing for a MANAGE_PRICING user only, no SuperAdmin text or /controls link on the page", async ({ browser, run, orgB }) => {
    test.setTimeout(120_000);
    const fx = await getFx(run, orgB);
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/dashboard"));
      await page.getByRole("button", { name: /Admin/ }).first().click();
      const link = page.getByRole("link", { name: "Product Pricing" });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page.getByRole("heading", { name: "Product Pricing" })).toBeVisible();
      await expect(page.getByTestId(`type-tab-${fx.code}`).filter({ visible: true })).toBeVisible();
      await expect(page.getByText(/SuperAdmin/i)).toHaveCount(0);
      await expect(page.locator('main a[href*="/controls"]')).toHaveCount(0);
    });
    await withPage({ browser, run }, "architect", undefined, async (o) => {
      await o.page.goto(orgUrl(run.testOrg.slug, "/dashboard"));
      await expect(o.page.getByRole("link", { name: "Product Pricing" })).toHaveCount(0);
    });
  });

  test("UI AC2 tabs, counts, spec columns, search and filters, empty state with Go to catalog", async ({ browser, run, orgB }) => {
    test.setTimeout(120_000);
    const fx = await getFx(run, orgB);
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/admin/product-pricing"));
      const tab = page.getByTestId(`type-tab-${fx.code}`).filter({ visible: true });
      await tab.click();
      await expect(tab).toContainText("0 / 3 priced");
      await expect(page.getByRole("columnheader", { name: "Glass type" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Thickness" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Note" })).toHaveCount(0);
      const rows = page.getByTestId("pricing-row");
      await expect(rows).toHaveCount(3);
      await expect(rows.first()).toContainText("No prices");
      await page.getByRole("textbox", { name: "Search combinations" }).fill("8 mm");
      await expect(rows).toHaveCount(1);
      await page.getByRole("textbox", { name: "Search combinations" }).fill("");
      await page.getByRole("button", { name: "Show unpriced only" }).click();
      await expect(rows).toHaveCount(3);
      await page.getByRole("button", { name: "Show orphaned" }).click();
      await expect(rows).toHaveCount(0);
      await page.getByTestId(`type-tab-${fx.plainCode}`).filter({ visible: true }).click();
      await expect(page.getByText("Contact the Easeetool team to add product specifications to your catalog.")).toBeVisible();
      const go = page.getByRole("link", { name: "Go to catalog" });
      await expect(go).toHaveAttribute("href", /\/admin\/catalog$/);
      await expect(rows).toHaveCount(0);
    });
  });

  test("UI AC3 drawer: Enter opens, add, duplicate error keeps the typed value, description, one PUT, prices-only save keeps the description, discard, empty save unprices", async ({ browser, run, orgB }) => {
    test.setTimeout(150_000);
    const fx = await getFx(run, orgB);
    const storedRows = async () => (await ok<{ rows: { combinationKey: string; prices: { amount: number }[]; description: string | null }[] }>(await orgB.get(fx.B(`/product-pricing?componentTypeId=${fx.typeId}`)))).rows;
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      const puts: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "PUT" && r.url().includes("/product-pricing")) puts.push(r.postData() ?? "");
      });
      await page.goto(orgUrl(run.orgB.slug, "/admin/product-pricing"));
      const tab = page.getByTestId(`type-tab-${fx.code}`).filter({ visible: true });
      await tab.click();
      const rows = page.getByTestId("pricing-row");
      const dlg = page.getByRole("dialog");
      // Enter on the focused row opens the drawer for that combination (first by label: Double · 12 mm)
      await rows.first().focus();
      await page.keyboard.press("Enter");
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText("Double · 12 mm");
      await expect(dlg.getByText("No prices set.")).toBeVisible();
      // add INR 2800 (the unit is the locked pcs for a piece type)
      await dlg.getByRole("button", { name: "Add price" }).click();
      await dlg.getByRole("textbox", { name: "Amount" }).fill("2800");
      await dlg.getByRole("button", { name: "Add", exact: true }).click();
      await expect(dlg.getByTestId("price-entry")).toHaveCount(1);
      // duplicate pair: the error, the existing entry highlighted, the typed value kept
      await dlg.getByRole("button", { name: "Add price" }).click();
      await dlg.getByRole("textbox", { name: "Amount" }).fill("3100");
      await dlg.getByRole("button", { name: "Add", exact: true }).click();
      await expect(dlg.getByText("A price entry for INR pcs already exists.")).toBeVisible();
      await expect(dlg.getByTestId("price-entry").first()).toHaveClass(/bg-danger-bg/);
      await expect(dlg.getByRole("textbox", { name: "Amount" })).toHaveValue("3100");
      await dlg.getByRole("button", { name: "Cancel" }).click();
      // description tab with its counter
      await dlg.getByRole("tab", { name: "Description" }).click();
      await dlg.getByLabel("Description").fill("Standard unit");
      await expect(dlg).toContainText("13 / 500");
      // discard reverts both
      await dlg.getByRole("button", { name: "Discard" }).click();
      await expect(dlg.getByLabel("Description")).toHaveValue("");
      await dlg.getByLabel("Description").fill("Standard unit");
      await dlg.getByRole("tab", { name: "Prices" }).click();
      await dlg.getByRole("button", { name: "Add price" }).click();
      await dlg.getByRole("textbox", { name: "Amount" }).fill("2800");
      await dlg.getByRole("button", { name: "Add", exact: true }).click();
      await dlg.getByRole("button", { name: "Save changes" }).click();
      await expect(dlg).toHaveCount(0);
      expect(puts.length, "one PUT per save").toBe(1);
      await expect(rows.first()).toContainText("2,800 INR/pcs");
      await expect(rows.first()).toContainText("Standard unit");
      await expect(tab).toContainText("1 / 3 priced");
      let stored = await storedRows();
      expect(stored).toHaveLength(1);
      expect(stored[0].description).toBe("Standard unit");

      // a prices-only change still sends the current description (PUT replaces the row)
      await rows.first().click();
      await dlg.getByRole("button", { name: "Edit" }).click();
      await dlg.getByRole("textbox", { name: "Amount" }).fill("2900");
      await dlg.getByRole("button", { name: "Update" }).click();
      await dlg.getByRole("button", { name: "Save changes" }).click();
      await expect(dlg).toHaveCount(0);
      expect(puts).toHaveLength(2);
      expect(JSON.parse(puts[1]).description).toBe("Standard unit");
      await expect(rows.first()).toContainText("2,900 INR/pcs");

      // empty drawer + blank description deletes the row: back to unpriced
      await rows.first().click();
      await dlg.getByRole("button", { name: "Remove" }).click();
      await dlg.getByRole("tab", { name: "Description" }).click();
      await dlg.getByLabel("Description").fill("");
      await dlg.getByRole("button", { name: "Save changes" }).click();
      await expect(dlg).toHaveCount(0);
      await expect(rows.first()).toContainText("No prices");
      await expect(tab).toContainText("0 / 3 priced");
      stored = await storedRows();
      expect(stored).toHaveLength(0);
    });
  });

  test("UI AC4 orphan: band, badge, stored label and note; Remove deletes without opening the drawer", async ({ browser, run, orgB }) => {
    test.setTimeout(150_000);
    const fx = await getFx(run, orgB);
    const put = (g: string, t: string, label: string) =>
      orgB.put(fx.B("/product-pricing"), {
        data: { componentTypeId: fx.typeId, combinationKey: key(g, t), combinationLabel: label, prices: [{ currency: "INR", unit: "pcs", amount: 100 }] },
      });
    await ok(await put("Single", "8 mm", "Single · 8 mm"));
    await ok(await put("Double", "12 mm", "Double · 12 mm"));
    // remove the option value that produced "Single · 8 mm"
    await ok(await orgB.put(fx.B(`/component-types/${fx.typeId}/field-values`), {
      data: { fieldOptionsConfig: { ...CONFIG.fieldOptionsConfig, thick: { valueMap: { Single: ["12 mm"], Double: ["12 mm"] } } } },
    }));
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/admin/product-pricing"));
      const tab = page.getByTestId(`type-tab-${fx.code}`).filter({ visible: true });
      await tab.click();
      await expect(page.getByText("1 orphaned combination")).toBeVisible();
      await expect(tab).toContainText("1 / 2 priced");
      await page.getByRole("button", { name: "Show orphaned" }).click();
      const rows = page.getByTestId("pricing-row");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute("data-orphaned", "true");
      await expect(rows.first()).toContainText("Orphaned");
      await expect(rows.first()).toContainText("Single · 8 mm");
      await expect(rows.first()).toContainText("This combination is no longer available. Clear or update it.");
      await expect(rows.first().locator("td").first()).toHaveClass(/bg-status-pending-bg/);
      await rows.first().getByRole("button", { name: "Remove" }).click();
      await expect(rows).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const left = (await ok<{ rows: { combinationKey: string }[] }>(await orgB.get(fx.B(`/product-pricing?componentTypeId=${fx.typeId}`)))).rows;
      expect(left.map((r) => r.combinationKey)).toEqual([key("Double", "12 mm")]);
      await expect(page.getByText("orphaned combination")).toHaveCount(0);
    });
  });

  test("UI AC3b drawer: Escape on a dropdown keeps the drawer open; a save in flight finishes, closes its own drawer and toasts (Q-D29: no other row can be opened meanwhile)", async ({ browser, run, orgB }) => {
    test.setTimeout(150_000);
    const fx = await getFx(run, orgB);
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/admin/product-pricing"));
      await page.getByTestId(`type-tab-${fx.code}`).filter({ visible: true }).click();
      const rows = page.getByTestId("pricing-row");
      const dlg = page.getByRole("dialog");
      await rows.filter({ hasText: "Double" }).first().click();
      await dlg.getByRole("button", { name: "Add price" }).click();
      // Escape closes the open Currency list only
      await dlg.locator('button[role="combobox"]').first().click(); // the Currency trigger (first in the form)
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await expect(dlg).toBeVisible();
      // a save still in flight: the drawer is modal, so no other row can be opened meanwhile (it was possible before Q-D29)
      await dlg.getByRole("textbox", { name: "Amount" }).fill("100");
      await dlg.getByRole("button", { name: "Add", exact: true }).click();
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      await page.route("**/product-pricing", async (r) => {
        if (r.request().method() === "PUT") await gate;
        await r.continue();
      });
      await dlg.getByRole("button", { name: "Save changes" }).click();
      await expect(dlg).toContainText("Double");
      release();
      await expect(page.getByText("Pricing saved")).toBeVisible();
      await expect(dlg).toHaveCount(0);
      await page.unroute("**/product-pricing");
    });
  });

  test("UI AC2b + AC2d (Stage 38 B2): prices read '<amount> <CUR>/<unit>' with a bold amount and a muted suffix, no pills; the drawer is modal (scrim click closes without reaching the row beneath, page inert, Escape and Close, focus returns)", async ({ browser, run, orgB }) => {
    test.setTimeout(150_000);
    const fx = await getFx(run, orgB);
    await ok(await orgB.put(fx.B("/product-pricing"), {
      data: {
        componentTypeId: fx.typeId,
        combinationKey: key("Single", "12 mm"),
        combinationLabel: "Single · 12 mm",
        prices: [{ currency: "INR", unit: "pcs", amount: 2800 }, { currency: "USD", unit: "pcs", amount: 40 }],
        description: "AC2b",
      },
    }));
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      await page.goto(orgUrl(run.orgB.slug, "/admin/product-pricing"));
      await page.getByTestId(`type-tab-${fx.code}`).filter({ visible: true }).click();
      const rows = page.getByTestId("pricing-row");
      const rowA = rows.filter({ hasText: "Single" }).filter({ hasText: "12 mm" });
      const rowB = rows.filter({ hasText: "Double" }).first();
      // table: two price lines, amount and suffix are separate elements, text reads "<amount> <CUR>/<unit>"
      const lines = rowA.getByTestId("price-line");
      await expect(lines).toHaveCount(2);
      await expect(rowA).toContainText("2,800 INR/pcs");
      await expect(rowA).toContainText("40 USD/pcs");
      await expect(lines.first().getByTestId("price-amount")).toHaveText("2,800");
      await expect(lines.first().getByTestId("price-suffix")).toHaveText("INR/pcs");
      await expect(lines.first().getByTestId("price-amount")).toHaveClass(/font-extrabold/);
      await expect(lines.first().getByTestId("price-suffix")).toHaveClass(/text-text-muted/);
      // no pill anywhere on a price: no rounded-full element and none of the old currency chip colours inside a price line
      await expect(rowA.getByTestId("price-line").locator(".rounded-full")).toHaveCount(0);
      await expect(rowA.locator(".bg-status-shipped-bg, .bg-status-paid-bg")).toHaveCount(0);

      // drawer entries read the same
      await rowA.click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toBeVisible();
      const entries = dlg.getByTestId("price-entry");
      await expect(entries).toHaveCount(2);
      await expect(entries.first()).toContainText("2,800 INR/pcs");
      await expect(entries.first().getByTestId("price-amount")).toHaveClass(/font-extrabold/);
      await expect(entries.first().getByTestId("price-suffix")).toHaveText("INR/pcs");
      await expect(entries.first().locator(".rounded-full")).toHaveCount(0);
      expect(await page.evaluate(() => Array.from(document.body.children).some((e) => (e as HTMLElement).inert))).toBe(true);

      // a click on the scrim over ANOTHER row closes the drawer and does not open that row
      const box = (await rowB.boundingBox())!;
      await page.mouse.click(box.x + 20, box.y + box.height / 2);
      await expect(dlg).toHaveCount(0);
      await page.waitForTimeout(400);
      await expect(dlg).toHaveCount(0);

      // Escape closes and focus returns to the row that opened the drawer
      await rowA.focus();
      await page.keyboard.press("Enter");
      await expect(dlg).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dlg).toHaveCount(0);
      await expect(rowA).toBeFocused();

      // the Close button closes too
      await rowA.click();
      await dlg.getByRole("button", { name: "Close" }).click();
      await expect(dlg).toHaveCount(0);
      await expect(rowA).toBeFocused();
    });
  });
});

// Stage 37 Batch 3 - the Inventory page (list states + modal drawer). Throwaway org B only: its own type and items go
// with org B at teardown (the org hard-delete cascades every org-scoped table), so no Test-Org data is touched.
// Stage 38 B2: the Inventory prices test below lives in this block on purpose. Both tests create items in org B, and the
// Stage 37 test asserts exact tab totals (deltas on "All" and "Unassigned"), so they must not run at the same time:
// serial mode keeps them in one worker, in this order.
test.describe("Stage 37 B3: Inventory list and drawer, throwaway org B", () => {
  test.describe.configure({ mode: "serial" });
  test("UI AC1-AC3 /admin/inventory: tabs with counts, search + chips, Part groups, sort, read-only drawer then Edit, Matches rows (a used field is not offered), Also matched by (active items only), the modal drawer (scrim and Escape close, page behind inert, focus returns), the discard confirm, a dash-free delete confirm, ?type preselects the tab", async ({ browser, run, orgB }) => {
    test.setTimeout(180_000);
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const cats = (await ok<{ categories: { id: string }[] }>(await orgB.get(B("/component-categories")))).categories;
    const fld = (key: string, label: string, over: Record<string, unknown> = {}) =>
      ({ key, label, type: "dropdown", required: false, basic: true, ...over });
    const code = `RGRI${tag().toUpperCase()}`;
    const type = (await ok<{ componentType: { id: string; name: string; code: string } }>(
      await orgB.post(B("/component-types"), {
        data: { code, name: `${run.prefix}inv-${tag()}`, categoryId: cats[0].id, fieldsSchema: [fld("grade", "Grade"), fld("hinge", "Hinge", { inventoryLinked: true })] },
      }),
      201,
    )).componentType;
    await ok(await orgB.put(B(`/component-types/${type.id}/field-values`), { data: { fieldOptionsConfig: { grade: { options: ["A", "B"] }, hinge: { options: ["HG1"] } } } }));
    // a second type, the target of the type-change flow
    const type2 = (await ok<{ componentType: { id: string; name: string; code: string } }>(
      await orgB.post(B("/component-types"), {
        data: { code: `RGRJ${tag().toUpperCase()}`, name: `${run.prefix}inv2-${tag()}`, categoryId: cats[0].id, fieldsSchema: [fld("size", "Size")] },
      }),
      201,
    )).componentType;
    const mk = async (c: string, over: Record<string, unknown> = {}) =>
      (await ok<{ item: { id: string } }>(await orgB.post(B("/inventory"), { data: { code: c, name: `${c} name`, measurementUnit: "pieces", ...over } }), 201)).item.id;
    const p = run.prefix.toUpperCase();
    const a1 = `${p}A1`, a2 = `${p}A2`, a3 = `${p}A3`, u1 = `${p}U1`, n1 = `${p}N1`;
    const created: string[] = []; // item ids to delete in finally (org B is also hard-deleted at teardown)

    try {
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      const drawer = page.getByRole("dialog", { name: /./ });
      const tab = (name: RegExp) => page.getByRole("tab", { name });
      // org B is shared in a full pages run: read the tab counts BEFORE creating this test's items, assert deltas.
      // Stage 38 (B2-1): a tab reads "<label><priced> / <total> priced"; the count is the total.
      const countOf = async (name: RegExp) => {
        const t = tab(name);
        if ((await t.count()) === 0) return 0;
        return Number((((await t.first().textContent()) ?? "").match(/\/\s*(\d+)\s*priced\s*$/) ?? [])[1] ?? 0);
      };
      await page.goto(orgUrl(run.orgB.slug, "/admin/inventory"));
      await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
      const allBase = await countOf(/^All\s*\d+ \/ \d+ priced$/);
      const unassignedBase = await countOf(/^Unassigned\s*\d+ \/ \d+ priced$/);
      const a1Id = await mk(a1, { componentTypeId: type.id, partKey: "hinge", attributes: { grade: "A" } });
      const a2Id = await mk(a2, { componentTypeId: type.id, attributes: { grade: "A" } });
      const a3Id = await mk(a3, { componentTypeId: type.id, active: false, attributes: { grade: "A" } });
      const u1Id = await mk(u1);
      created.push(a1Id, a2Id, a3Id, u1Id);
      // rows by id: a row's text also carries "Also matched by <other code>", so a text filter would match two rows
      const rowId = (id: string) => page.locator(`tr[data-row-id="${id}"]`);
      const row = (c: string) => rowId({ [a1]: a1Id, [a2]: a2Id, [a3]: a3Id, [u1]: u1Id }[c] as string);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();

      // tabs with counts: All +4, the own type exactly 3, Unassigned +1
      await expect(tab(new RegExp(`^All\\s*\\d+ / ${allBase + 4} priced$`))).toBeVisible();
      await expect(tab(new RegExp(`^Unassigned\\s*\\d+ / ${unassignedBase + 1} priced$`))).toBeVisible();
      await tab(new RegExp(`^${type.name}\\s*0 / 3 priced$`)).click();
      // Part groups: Hinge (A1) and Other (A2, A3)
      await expect(page.getByRole("rowgroup").filter({ hasText: /Hinge/ })).toBeVisible();
      await page.getByRole("button", { name: "Collapse Other" }).click();
      await expect(row(a2)).toHaveCount(0);
      await page.getByRole("button", { name: "Expand Other" }).click();
      await expect(row(a2)).toHaveCount(1);

      // search + chips + empty state
      await page.getByLabel("Search code or name").fill(a3);
      await expect(page.getByText("1 item", { exact: true })).toBeVisible();
      await page.getByLabel("Search code or name").fill("");
      await page.getByRole("button", { name: "Inactive", exact: true }).click();
      await expect(row(a3)).toHaveCount(1);
      await expect(row(a1)).toHaveCount(0);
      await page.getByLabel("Search code or name").fill("zzz-no-such");
      await expect(page.getByText("No items match your filters")).toBeVisible();
      await page.getByRole("button", { name: "Clear filters" }).click();
      await expect(row(a1)).toHaveCount(1);

      // a drawer field's visible (custom) combobox: label text -> its container -> last combobox (the native one is empty)
      const fieldCombo = (label: RegExp) => drawer.getByText(label).locator("xpath=..").getByRole("combobox").last();
      // sort: Code starts ascending (mockup default), so one click = descending, within each Part group
      await page.getByRole("button", { name: /^Code/ }).click();
      const codes = (await page.locator("tr[data-row-id] td:first-child").allTextContents()).map((c) => c.trim()).filter((c) => c.startsWith(p));
      expect(codes).toEqual([a1, a3, a2]);

      // Also matched by: A1 and A2 (both active, same rows) link each other; inactive A3 is never offered
      await expect(row(a1)).toContainText(`Also matched by ${a2}`);
      await expect(row(a2)).toContainText(`Also matched by ${a1}`);
      await expect(row(a1)).not.toContainText(a3);

      // read-only drawer first, then Edit; modal: the page behind is inert, Escape closes, focus returns to the row
      const opener = row(a1);
      await opener.click();
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(drawer.getByText("Grade")).toBeVisible();
      // Stage 38a: the Prices section is part of the read-only drawer (this item has no price yet)
      await expect(drawer.getByRole("heading", { name: "Prices" })).toBeVisible();
      await expect(drawer.getByText("No prices")).toBeVisible();
      expect(await page.evaluate(() => Array.from(document.body.children).some((e) => (e as HTMLElement).inert))).toBe(true);
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(opener).toBeFocused();
      // the scrim closes it too
      await opener.click();
      await expect(drawer).toBeVisible();
      await page.mouse.click(5, 300);
      await expect(drawer).toHaveCount(0);

      // Edit: Matches rows. Grade is used, so the picker of a new row offers Hinge only
      await opener.click();
      await drawer.getByRole("button", { name: "Edit" }).click();
      await expect(drawer.getByRole("button", { name: /^Remove match Grade/ })).toBeVisible();
      await drawer.getByRole("button", { name: "Add match" }).click();
      // the new row's field picker (the last combobox is its disabled value picker)
      await drawer.getByRole("combobox").filter({ hasText: "Choose a field" }).click();
      await expect(page.getByRole("option", { name: "Grade", exact: true })).toHaveCount(0);
      await expect(page.getByRole("option", { name: "Hinge", exact: true })).toHaveCount(1);
      await page.keyboard.press("Escape");
      await drawer.getByRole("button", { name: /^Remove match Choose a field/ }).click();
      await drawer.getByRole("button", { name: /^Remove match Grade/ }).click();
      await expect(drawer.getByText("No matches")).toBeVisible();
      // dirty: the scrim asks "Discard changes?"; Keep editing stays, Cancel then Discard returns to the read-only view
      await page.mouse.click(5, 300);
      await expect(page.getByRole("heading", { name: "Discard changes?" })).toBeVisible();
      await page.getByRole("button", { name: "Keep editing" }).click();
      await expect(drawer).toBeVisible();
      await drawer.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);

      // the delete confirm text carries no dash
      await page.getByRole("button", { name: `Delete item ${a3}` }).click();
      const confirm = page.getByRole("dialog").filter({ hasText: "This cannot be undone." });
      await expect(confirm).toBeVisible();
      expect(((await confirm.textContent()) ?? "").match(/[–—]| - /)).toBeNull();
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm).toHaveCount(0);
      await expect(row(a3)).toHaveCount(1);

      // Save, edit: rename A2, Save changes, the drawer is back in the read-only view with the new name (no toast on update)
      const renamed = `${a2} renamed`;
      await row(a2).click();
      await drawer.getByRole("button", { name: "Edit" }).click();
      await drawer.getByRole("textbox", { name: /^Name/ }).fill(renamed);
      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(drawer).toContainText(renamed);
      await expect(page.getByText("Item added to inventory")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(row(a2)).toContainText(renamed);

      // S37-5: changing the type of a saved item that has a Part or rows asks first. Cancel keeps the type;
      // Change type clears the Part and the Matches rows in the draft; Save persists the new type with no Part/rows
      await row(a1).click();
      await drawer.getByRole("button", { name: "Edit" }).click();
      const compSel = fieldCombo(/^Component type$/);
      await compSel.click();
      await page.getByRole("option", { name: type2.name, exact: true }).click();
      await expect(page.getByRole("heading", { name: "Change component type?" })).toBeVisible();
      const tc = page.getByRole("dialog").filter({ hasText: "Change component type?" });
      await tc.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Change component type?" })).toHaveCount(0);
      await expect(compSel).toContainText(type.name);
      await expect(drawer.getByRole("button", { name: /^Remove match Grade/ })).toBeVisible();
      await compSel.click();
      await page.getByRole("option", { name: type2.name, exact: true }).click();
      await page.getByRole("dialog").filter({ hasText: "Change component type?" }).getByRole("button", { name: "Change type", exact: true }).click();
      await expect(compSel).toContainText(type2.name);
      await expect(drawer.getByRole("button", { name: /^Remove match/ })).toHaveCount(0);
      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
      await expect(drawer).toContainText(type2.name);
      await expect(drawer.getByText("No matches")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      // A1 left this type tab, so A2 is no longer matched by it
      await expect(row(a1)).toHaveCount(0);
      await expect(row(a2)).not.toContainText("Also matched by");

      // New item: Create item closes the drawer, the toast shows (create only) and the row appears
      await page.getByRole("button", { name: "New item", exact: true }).click();
      await expect(drawer).toBeVisible();
      await drawer.getByRole("textbox", { name: /^Code/ }).fill(n1);
      await drawer.getByRole("textbox", { name: /^Name/ }).fill(`${n1} name`);
      await fieldCombo(/^Component type$/).click();
      await page.getByRole("option", { name: type.name, exact: true }).click();
      await fieldCombo(/^Unit\s*\*?$/).click();
      await page.getByRole("option", { name: "pc (Pieces)", exact: true }).click();
      await drawer.getByRole("button", { name: "Create item" }).click();
      await expect(page.getByText("Item added to inventory")).toBeVisible();
      await expect(drawer).toHaveCount(0);
      const newRow = page.locator("tr[data-row-id]").filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${n1}$`) }) });
      await expect(newRow).toHaveCount(1);

      // ?type=<code> preselects that tab; an unknown code means All
      await page.goto(orgUrl(run.orgB.slug, `/admin/inventory?type=${type.code}`));
      await expect(tab(new RegExp(`^${type.name}`))).toHaveAttribute("aria-selected", "true");
      await page.goto(orgUrl(run.orgB.slug, "/admin/inventory?type=NOPE"));
      await expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
    });
    } finally {
      // the created item (UI flow) is found by code; every id is deleted, prefix asserted first
      const all = await orgB.get(B("/inventory")).then((r) => r.json()).catch(() => ({ items: [] as { id: string; code: string }[] }));
      for (const it of (all.items ?? []) as { id: string; code: string }[]) {
        if (it.code === n1 && it.code.startsWith(p)) created.push(it.id);
      }
      for (const id of created) await orgB.delete(B(`/inventory/${id}`)).catch(() => undefined);
    }
  });

  // Stage 38 Batch 2 (38a) - Inventory prices: the default-currency list columns, Priced/Unpriced, "N / M priced" tabs and
  // the drawer Prices section (view, validation, one PUT per save). Throwaway org B only: the type and items go with it.
  // The org's default currency is only READ here (via /me), never written. org-settings.spec.ts DOES write org B's
  // default (INR to AED to USD and back, a few seconds), so a read can overlap that window when the two files run in
  // parallel workers: the `Max (cur)` assertions would then see the other currency. Accepted (Stage 38 B2 review N2):
  // the suite's automatic --workers=1 re-run cannot overlap, so a red here that passes on the re-run is this race.
  test("Stage 38 B2: Inventory prices, UI AC1-AC2 /admin/inventory: Max/Min columns in the default currency (bold plain numbers, no unit text, 'No price', arrow for no upper limit, (i) on Max), Priced/Unpriced and 'N / M priced' tabs, the drawer Prices section (heading unit once, amount + currency only, add/validate/save/remove, discard)", async ({ browser, run, orgB }) => {
    test.setTimeout(240_000);
    const B = (p: string) => orgApi(run.orgB.slug, p);
    const cats = (await ok<{ categories: { id: string }[] }>(await orgB.get(B("/component-categories")))).categories;
    const type = (await ok<{ componentType: { id: string; name: string; code: string } }>(
      await orgB.post(B("/component-types"), {
        data: { code: `RGRQ${tag().toUpperCase()}`, name: `${run.prefix}prc-${tag()}`, categoryId: cats[0].id, fieldsSchema: [{ key: "grade", label: "Grade", type: "dropdown", required: false, basic: true }] },
      }),
      201,
    )).componentType;
    const cur = (await ok<{ orgDefaultCurrency: string }>(await orgB.get(B("/me")))).orgDefaultCurrency;
    const other = cur === "INR" ? "AED" : "INR";
    const third = ["INR", "AED", "USD"].find((c) => c !== cur && c !== other)!;
    const p = run.prefix.toUpperCase();
    const mk = async (c: string) =>
      (await ok<{ item: { id: string } }>(await orgB.post(B("/inventory"), { data: { code: c, name: `${c} name`, measurementUnit: "pieces", componentTypeId: type.id } }), 201)).item.id;
    const put = (id: string, prices: unknown[]) => orgB.put(B(`/inventory/${id}/prices`), { data: { prices } });
    const stored = async (id: string) =>
      (await ok<{ item: { prices: { currency: string; price: string; minPrice: string; allowAbove: boolean }[] } }>(await orgB.get(B(`/inventory/${id}`)))).item.prices;
    const created: string[] = [];

    try {
      const i1 = await mk(`${p}P1`);
      const i2 = await mk(`${p}P2`);
      const i3 = await mk(`${p}P3`);
      created.push(i1, i2, i3);
      await ok(await put(i1, [{ currency: cur, price: 2800, minPrice: 2500, allowAbove: true }, { currency: other, price: 40, minPrice: 35, allowAbove: false }]));
      await ok(await put(i2, [{ currency: other, price: 10, minPrice: 5, allowAbove: false }]));

      await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
        const page = o.page;
        const drawer = page.getByRole("dialog", { name: /./ });
        const rowId = (id: string) => page.locator(`tr[data-row-id="${id}"]`);
        const puts: string[] = [];
        page.on("request", (r) => {
          if (r.method() === "PUT" && r.url().includes("/prices")) puts.push(r.postData() ?? "");
        });
        await page.goto(orgUrl(run.orgB.slug, "/admin/inventory"));

        // tab: priced in the default currency over the tab's items
        const tab = page.getByRole("tab", { name: new RegExp(`^${type.name}`) });
        await expect(tab).toHaveText(`${type.name}1 / 3 priced`);
        await tab.click();

        // list columns: org default currency only, currency in the header, (i) on Max
        await expect(page.getByRole("columnheader", { name: new RegExp(`^Max \\(${cur}\\)`) })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: new RegExp(`^Min \\(${cur}\\)`) })).toBeVisible();
        await expect(page.getByRole("img", { name: "Prices are per pack, in the item's unit, shown in your organization's default currency" })).toBeVisible();
        await expect(page.getByRole("columnheader", { name: /Per\b/ })).toHaveCount(0);
        const max1 = rowId(i1).getByTestId("price-max");
        await expect(max1).toHaveText("2,800");
        await expect(rowId(i1).getByTestId("price-min")).toHaveText("2,500");
        await expect(max1.getByRole("img", { name: "No upper limit" })).toBeVisible();
        // no unit or currency text inside any price cell (Q-D30)
        for (const cell of [max1, rowId(i1).getByTestId("price-min")]) expect(((await cell.textContent()) ?? "").trim()).toMatch(/^[\d,.]+$/);
        // unpriced in the default currency (i2 is priced only in the other one): "No price", empty Min
        await expect(rowId(i2).getByTestId("price-max")).toHaveText("No price");
        await expect(rowId(i2).getByTestId("price-min")).toHaveText("");
        await expect(rowId(i3).getByTestId("price-max")).toHaveText("No price");

        // Priced / Unpriced chips
        const priced = page.getByRole("button", { name: "Priced", exact: true });
        const unpriced = page.getByRole("button", { name: "Unpriced", exact: true });
        await priced.click();
        await expect(rowId(i1)).toHaveCount(1);
        await expect(rowId(i2)).toHaveCount(0);
        await expect(rowId(i3)).toHaveCount(0);
        await priced.click();
        await unpriced.click();
        await expect(rowId(i1)).toHaveCount(0);
        await expect(rowId(i2)).toHaveCount(1);
        await expect(rowId(i3)).toHaveCount(1);
        await priced.click(); // both on = no price filter
        await expect(rowId(i1)).toHaveCount(1);
        await expect(rowId(i3)).toHaveCount(1);
        await priced.click();
        await unpriced.click();

        // drawer view: heading says the unit once, rows are amount + currency only, the unpriced currency is named
        await rowId(i1).click();
        await expect(drawer).toBeVisible();
        const section = drawer.getByTestId("prices-section");
        await expect(section.getByRole("heading", { name: /^Prices/ })).toContainText("per pc");
        const rows = section.getByTestId("price-row");
        await expect(rows).toHaveCount(2);
        await expect(rows.first()).toContainText(`2,800 ${cur}`);
        await expect(rows.first()).toContainText(`2,500 ${cur}`);
        await expect(rows.first()).toContainText("Yes");
        await expect(rows.nth(1)).toContainText(`40 ${other}`);
        expect(((await rows.first().textContent()) ?? "")).not.toMatch(/\/|\bpc\b/);
        await expect(section).toContainText(`Not priced in ${third}`);
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);

        // unpriced item: empty state, Add price enters edit mode; blank Max is refused before any request
        await rowId(i3).click();
        await expect(drawer.getByTestId("prices-section")).toContainText("No prices");
        await drawer.getByRole("button", { name: "Add price" }).click();
        await drawer.getByRole("button", { name: "Add price" }).click(); // the edit-mode button adds the row
        await drawer.getByRole("button", { name: "Save changes" }).click();
        await expect(drawer.getByText("Max must be 0 or more.")).toBeVisible();
        expect(puts).toHaveLength(0);
        // min above max
        await drawer.getByLabel(`Max ${cur}`).fill("100");
        await drawer.getByLabel(`Min ${cur}`).fill("150");
        await drawer.getByRole("button", { name: "Save changes" }).click();
        await expect(drawer.getByText("Min can't be above max.")).toBeVisible();
        expect(puts).toHaveLength(0);
        // valid: one PUT with 2 dp strings, then back to the read-only view
        await drawer.getByLabel(`Min ${cur}`).fill("80");
        await drawer.getByRole("switch", { name: `No upper limit for ${cur}` }).click();
        await drawer.getByRole("button", { name: "Save changes" }).click();
        await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
        expect(puts).toHaveLength(1);
        expect(JSON.parse(puts[0])).toEqual({ prices: [{ currency: cur, price: "100.00", minPrice: "80.00", allowAbove: true }] });
        expect(await stored(i3)).toEqual([expect.objectContaining({ currency: cur, price: "100.00", minPrice: "80.00", allowAbove: true })]);
        await expect(drawer.getByTestId("price-row")).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await expect(rowId(i3).getByTestId("price-max")).toHaveText("100");
        await expect(tab).toHaveText(`${type.name}2 / 3 priced`);

        // remove a currency row: one PUT, the other currency is gone
        await rowId(i1).click();
        await drawer.getByRole("button", { name: "Edit" }).click();
        await drawer.getByRole("button", { name: `Remove ${other} price` }).click();
        await drawer.getByRole("button", { name: "Save changes" }).click();
        await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
        expect(puts).toHaveLength(2);
        expect((await stored(i1)).map((x) => x.currency)).toEqual([cur]);

        // a price edit alone makes the drawer dirty: the scrim asks "Discard changes?", Discard leaves the stored prices alone
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await rowId(i2).click();
        await drawer.getByRole("button", { name: "Edit" }).click();
        await drawer.getByLabel(`Max ${other}`).fill("11");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("heading", { name: "Discard changes?" })).toBeVisible();
        await page.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(drawer).toHaveCount(0);
        expect(puts).toHaveLength(2);
        expect((await stored(i2))[0].price).toBe("10.00");

        // no dash in the visible text of the Prices UI (Q-D25)
        await rowId(i1).click();
        expect(((await drawer.getByTestId("prices-section").textContent()) ?? "").match(/[–—]/)).toBeNull();
        expect(await settledProblems(o)).toEqual([]);
      });
    } finally {
      for (const id of created) await orgB.delete(B(`/inventory/${id}`)).catch(() => undefined);
    }
  });
});

// Stage 38 Batch 2 (38a) - Organization Settings (/admin/settings). The default currency is NEVER written here (the API
// spec org-settings.spec.ts owns the real round trip on org B): the Save requests are answered by a route stub, so
// this test leaves no state behind and never changes what that spec sees. It still READS the stored value at the
// start, which can overlap that spec's few-second write window in a parallel run (same accepted race as the Inventory
// prices test; the --workers=1 re-run is clean).
test.describe("Stage 38 B2: Organization Settings page, throwaway org B", () => {
  test("UI AC2c: flyout link for MANAGE_ORG only, title-only header, General section read-only with its own Edit, (i) tooltip, Save disabled until a change, Cancel reverts, saved toast, 400 and 5xx errors (Reference only on 5xx)", async ({ browser, run, orgB }) => {
    test.setTimeout(150_000);
    const label: Record<string, string> = { INR: "INR (Indian Rupee)", AED: "AED (UAE Dirham)", USD: "USD (US Dollar)" };
    const saved = (await ok<{ defaultCurrency: string }>(await orgB.get(orgApi(run.orgB.slug, "/settings")))).defaultCurrency;
    const next = saved === "AED" ? "USD" : "AED";
    await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
      const page = o.page;
      const patches: string[] = [];
      let reply: { status: number; body: unknown } | null = null;
      await page.route("**/settings", async (r) => {
        if (r.request().method() !== "PATCH") return r.continue();
        patches.push(r.request().postData() ?? "");
        const answer = reply ?? { status: 200, body: { defaultCurrency: next } };
        return r.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
      });
      await page.goto(orgUrl(run.orgB.slug, "/dashboard"));
      await page.getByRole("button", { name: /Admin/ }).first().click();
      const link = page.getByRole("link", { name: "Organization Settings" });
      await expect(link).toBeVisible();
      await link.click();

      // title-only header, one "General" section card with its own Edit (no page-level Edit)
      await expect(page.getByRole("heading", { level: 1, name: "Organization Settings" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "General" })).toBeVisible();
      await expect(page.getByText("Default Currency", { exact: true })).toBeVisible();
      await expect(page.getByTestId("default-currency-value")).toHaveText(label[saved]);
      await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
      // (i) tooltip
      await page.getByLabel("About Default Currency").hover();
      await expect(page.getByRole("tooltip")).toContainText("Sets the currency the Inventory list shows, and the default currency for new projects and Quick Estimate.");

      // edit: Save disabled until the value differs; Cancel reverts without a request
      await page.getByRole("button", { name: "Edit" }).click();
      const save = page.getByRole("button", { name: "Save", exact: true });
      await expect(save).toBeDisabled();
      await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
      const combo = page.getByRole("combobox").last();
      await combo.click();
      await page.getByRole("option", { name: label[next], exact: true }).click();
      await expect(save).toBeEnabled();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByTestId("default-currency-value")).toHaveText(label[saved]);
      expect(patches).toHaveLength(0);

      // 400: the message shows, no Reference, still editing
      reply = { status: 400, body: { error: "currency must be one of INR, AED, USD" } };
      await page.getByRole("button", { name: "Edit" }).click();
      await page.getByRole("combobox").last().click();
      await page.getByRole("option", { name: label[next], exact: true }).click();
      await save.click();
      const alert = page.locator('section[aria-labelledby="sec-general"] [role="alert"]'); // not the route announcer
      await expect(alert).toHaveText("currency must be one of INR, AED, USD");
      await expect(save).toBeEnabled();
      // 5xx: the Reference code shows
      reply = { status: 500, body: { error: "Internal server error", requestId: "rgr-ref-1" } };
      await save.click();
      await expect(alert).toContainText("(Reference: rgr-ref-1)");
      // success: one PATCH body per attempt, read-only again, toast, no confirm dialog
      reply = null;
      await save.click();
      await expect(page.getByTestId("default-currency-value")).toHaveText(label[next]);
      await expect(page.getByText("Settings saved")).toBeVisible();
      expect(patches.map((b) => JSON.parse(b))).toEqual([{ defaultCurrency: next }, { defaultCurrency: next }, { defaultCurrency: next }]);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.unroute("**/settings");
    });
    // (no read-back of the stored value: all three PATCHes were answered by the stub, asserted above via `patches`,
    // and a read here would race org-settings.spec.ts)
    // a Company Member (no MANAGE_ORG) has no Organization Settings link in the flyout
    await withPage({ browser, run }, "member", undefined, async (o) => {
      await o.page.goto(orgTarget(run, "/dashboard"));
      await o.page.getByRole("button", { name: /Admin/ }).first().click();
      await expect(o.page.getByRole("link", { name: "Inventory" })).toBeVisible();
      await expect(o.page.getByRole("link", { name: "Organization Settings" })).toHaveCount(0);
    });
  });
});

// Stage 38 Batch 3 (carried N3) - the notice's "Open Inventory" link needs MANAGE_PRICING: a distributor sees the
// notice without it. The unpriced state is made deterministic by clearing ONE code's price in the project currency and
// putting the item's own price list back in `finally` (rule 10).
test.describe("Stage 38 B3: Summary missing-price notice without MANAGE_PRICING", () => {
  test("UI AC3b: a distributor sees the notice but no 'Open Inventory' link; an admin sees the link", async ({ browser, run, f, as, url, ledger }) => {
    test.setTimeout(240_000);
    const projectId = await distributorWall(f, as, url, run, ledger);
    const codes = await materialCodes(as.admin, url, projectId);
    const { restore } = await priceItems(as.admin, url, [codes[0]], "AED", [codes[0]]); // AED = the project currency
    try {
      const calc = await ok<{ missingPrices: { currency: string; items: { code: string }[] } }>(await as.admin.get(url(`/projects/${projectId}/calculation`)));
      expect(calc.missingPrices.items.map((i) => i.code)).toContain(codes[0]);
      const n = calc.missingPrices.items.length;
      const text = `${n === 1 ? "1 item has" : `${n} items have`} no AED price; a quotation can't be made yet.`;
      await withPage({ browser, run }, "distributor", undefined, async (o) => {
        await o.page.goto(orgTarget(run, `/projects/${projectId}/summary`));
        const notice = o.page.getByTestId("missing-prices-notice").filter({ visible: true });
        await expect(notice).toContainText(text);
        await expect(notice.getByRole("link", { name: "Open Inventory" })).toHaveCount(0);
      });
      await withPage({ browser, run }, "admin", undefined, async (o) => {
        await o.page.goto(orgTarget(run, `/projects/${projectId}/summary`));
        const notice = o.page.getByTestId("missing-prices-notice").filter({ visible: true });
        await expect(notice).toContainText(text);
        await expect(notice.getByRole("link", { name: "Open Inventory" })).toHaveAttribute("href", /\/admin\/inventory$/);
      });
    } finally {
      await restore();
    }
  });
});

// Stage 38 Batch 2 (38a) - the Summary page's missing-price notice (Q-D8). Test Org project with a submitted design,
// READ only: the expected count comes from the calculation API itself (prices are never written here).
test.describe("Stage 38 B2: Summary missing-price notice", () => {
  test("UI AC3: the notice names the count and the project currency and links to Inventory for MANAGE_PRICING; absent when every item is priced", async ({ browser, run, f, as, url }) => {
    test.setTimeout(180_000);
    const w = await readyWall(f, as.admin, url);
    const submit = await as.admin.post(url(`/projects/${w.projectId}/submit-design`));
    expect(submit.status(), await submit.text()).toBe(200);
    const calc = await ok<{ missingPrices: { currency: string; items: { code: string }[] } }>(await as.admin.get(url(`/projects/${w.projectId}/calculation`)));
    const n = calc.missingPrices.items.length;
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/summary`));
      await expect(o.page.getByRole("button", { name: /^Recompute$/ })).toBeVisible();
      const notice = o.page.getByTestId("missing-prices-notice").filter({ visible: true });
      if (n === 0) {
        await expect(notice).toHaveCount(0);
      } else {
        await expect(notice).toContainText(`${n === 1 ? "1 item has" : `${n} items have`} no ${calc.missingPrices.currency} price; a quotation can't be made yet.`);
        await expect(notice.getByRole("link", { name: "Open Inventory" })).toHaveAttribute("href", /\/admin\/inventory$/);
        expect((await notice.textContent()) ?? "").not.toMatch(/[–—]/);
      }
    });
  });
});
