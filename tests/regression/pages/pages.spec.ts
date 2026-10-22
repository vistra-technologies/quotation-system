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
import { test, expect } from "../api/sa-helpers";
import { coversPage } from "../fixtures/covers";
import type { Role } from "../fixtures/run-state";
import { deniedRolesFor, ROLES, ROLE_PERMISSIONS } from "../api/permissions";
import { distributorCompanyId, glassConfig } from "../api/project-helpers";
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
      await expect(o.page.getByText("Export PDF")).toBeVisible();

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

  test("Design canvas (Stage 34 B6): Duplicate room - icon + tooltip, prefilled prompt, a taken name keeps the prompt open with the error, success opens the copy, unsaved edits show the guard (Cancel keeps the copy listed but unopened)", async ({ browser, run, f, as, url }) => {
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
      await expect(o.page.getByText(copyName, { exact: true }).filter({ visible: true })).toBeVisible();
      const copy = (await rooms()).rooms.find((r) => r.label === copyName)!;
      expect(copy.id).not.toBe(w.roomId);
      expect((await rooms()).rooms).toHaveLength(2);

      // unsaved edits in Configure mode: opening a copy is a room switch -> the guard; Cancel keeps the copy listed, unopened
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/design?partition=${w.partitionId}`));
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible();
      const width = o.page.getByLabel("Partition width");
      await width.fill("2100");
      await o.page.getByRole("button", { name: "Apply width", exact: true }).click();
      await expect(o.page.getByRole("button", { name: "Save changes" })).toBeEnabled();
      await o.page.getByTestId(`room-duplicate-${w.roomId}`).filter({ visible: true }).click();
      const second = `${label}-b6b`;
      await o.page.getByLabel("Name of the copy").fill(second);
      await o.page.getByRole("button", { name: "Duplicate", exact: true }).click();
      await expect(o.page.getByText("Save changes?")).toBeVisible();
      await o.page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(o.page.getByText("Save changes?")).toBeHidden();
      await expect(o.page.getByRole("button", { name: "Back to Room Layout" })).toBeVisible(); // still in Configure mode
      await expect(o.page.getByText(second, { exact: true }).filter({ visible: true })).toBeVisible(); // copy is listed
      expect((await rooms()).rooms.map((r) => r.label)).toContain(second);
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
        await expect(o.page.getByText("No projects match your filters."), who).toBeVisible();
        await expect(o.page.getByText(p.name), who).toHaveCount(0);
        await o.page.goto(orgTarget(run, `/inquiries?search=${encodeURIComponent(inq.name)}`));
        await expect(o.page.getByText("No inquiries match your filters."), who).toBeVisible();
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
