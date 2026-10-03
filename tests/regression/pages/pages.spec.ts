/**
 * Every page: access + render smoke (Task 12), generated from page-table.ts.
 *
 * Per row (page-table.ts `access`):
 *   - org / permission pages: unauthenticated → the Test Org's /login (content never rendered); org B's
 *     admin session → the Test Org's /login showing the cross-org notice (it is NOT clicked — that would
 *     sign the shared org-B session out); roles without the permission → /dashboard; the admin renders the
 *     page (HTTP 200, expected text, primary control enabled + React-hydrated, problem collector empty);
 *     every other allowed role reaches it.
 *   - SuperAdmin pages: unauthenticated and an org session → /controls/login; the SA renders the page with
 *     an empty collector, the shared LoadingOverlay never mounted and no global-error screen.
 *   - public pages: the anonymous render is the authorised render; signed-in visits land where pinned.
 * Plus: the apex 404 guard and subdomain routing, wizard pill gating (lock → submit → unlock → design edit
 * → re-lock), and KNOWN BUG / DECISION NEEDED pins.
 *
 * Every expectation here was observed live on test.easeetool.com (Task 12 probe) and is the contract.
 * Data: params come from the factories (rgr-<runId>-…, ledgered, deleted at teardown); the wizard test uses
 * its own Test-Org projects. Nothing outside the Test Org / this run's org B is written; SA pages are only
 * READ (the seeded formula set and org B).
 */
import fs from "node:fs";
import { test, expect } from "../api/sa-helpers";
import { coversPage } from "../fixtures/covers";
import type { Role } from "../fixtures/run-state";
import { deniedRolesFor, ROLES, ROLE_PERMISSIONS } from "../api/permissions";
import { distributorCompanyId } from "../api/project-helpers";
import { isSubdomain, orgUrl } from "../../e2e/helpers";
import {
  PAGES, CROSS_ORG_TEXT, DASHBOARD_TEXT, ORG_LOGIN_TEXT, SA_LOGIN_TEXT,
  fillPath, isOrgPage, orgRelative, type PageRow,
} from "./page-table";
import { isHydrated } from "./collect";
import { apexPathOf, openAs, orgPathOf, orgTarget, paramsFor, readyWall, type Opened, type ParamDeps } from "./page-helpers";

coversPage("/");
coversPage("/organizations");
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
coversPage("/controls/roles");
coversPage("/controls/users");
coversPage("/controls/component-types");
coversPage("/controls/formula-sets");
coversPage("/controls/formula-sets/[setId]");
coversPage("/controls/formula-sets/[setId]/new-version");
coversPage("/controls/audit-log");

// Rows are independent: spread them over the workers.
test.describe.configure({ mode: "parallel" });

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

/** Text visible, the page hydrated (React owns the node), and — if the row has one — its primary control ready. */
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
}

/** Content of `row` must not be on the page (denied visits). Headings only — body copy can repeat words. */
async function expectNoContent(o: Opened, row: PageRow): Promise<void> {
  await expect(o.page.getByRole("heading", { name: row.expectsText })).toHaveCount(0);
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
          await expect.poll(() => orgPathOf(run, o.page.url())).toBe("/login");
          await expect(o.page.getByText(ORG_LOGIN_TEXT)).toBeVisible();
          await expectNoContent(o, row);
        });
      });

      test("wrong org's session (org B admin) → the Test Org's login with the cross-org notice", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expect.poll(() => orgPathOf(run, o.page.url())).toBe("/login");
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
            await expect.poll(() => orgPathOf(run, o.page.url())).toBe("/dashboard");
            await expect(o.page.getByText(DASHBOARD_TEXT).first()).toBeVisible();
            await expectNoContent(o, row);
          });
        });
      }

      test("admin: renders (200, text, hydrated primary control, no console/page/network errors)", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "admin", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expect.poll(() => orgPathOf(run, o.page.url())).toBe(t.rel);
          await expectRendered(o, row);
          await o.page.waitForLoadState("load");
          expect(o.problems()).toEqual([]);
        });
      });

      // External users reaching ANOTHER company's (here: an internal) project / inquiry is a KNOWN BUG pinned
      // separately below, so detail pages are reached only by the internal member here.
      const scoped = /\[(projectId|inquiryId)\]/.test(row.path);
      const others = ROLES.filter((r) => r !== "admin" && roleHas(r, row) && !(scoped && (r === "distributor" || r === "architect")));
      if (others.length) {
        test(`other allowed roles reach it: ${others.join(", ")}`, async ({ browser, run, f, as, url }) => {
          const t = await target(row, deps({ f, as, url, run }));
          for (const role of others) {
            await withPage({ browser, run }, role, undefined, async (o) => {
              const res = await o.page.goto(t.url);
              expect(res?.status(), role).toBe(200);
              await expect.poll(() => orgPathOf(run, o.page.url()), role).toBe(t.rel);
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
          await expect.poll(() => apexPathOf(o.page.url())).toBe("/controls/login");
          await expect(o.page.getByText(SA_LOGIN_TEXT)).toBeVisible();
          await expectNoContent(o, row);
        });
      });

      test("an org-user session (no SA session) → /controls/login", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "admin", undefined, async (o) => {
          await o.page.goto(t.url);
          await expect.poll(() => apexPathOf(o.page.url())).toBe("/controls/login");
          await expect(o.page.getByText(SA_LOGIN_TEXT)).toBeVisible();
          await expectNoContent(o, row);
        });
      });

      test("SuperAdmin: renders; LoadingOverlay never mounted; no global-error; no console/page/network errors", async ({ browser, run, f, as, url, sa }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "sa", sa.token, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          await expect.poll(() => apexPathOf(o.page.url())).toBe(t.rel);
          await expectRendered(o, row);
          await o.page.waitForLoadState("load");
          await expect(o.page.getByText("Something went wrong")).toHaveCount(0);
          expect(await o.overlaySeen(), "the shared LoadingOverlay mounted on a /controls page (AGENTS.md)").toBe(false);
          expect(o.problems()).toEqual([]);
        });
      });
    }

    // ── public pages ──────────────────────────────────────────────────────────
    if (row.access === "public") {
      test("unauthenticated: renders (200, text, no console/page/network errors)", async ({ browser, run, f, as, url }) => {
        const t = await target(row, deps({ f, as, url, run }));
        await withPage({ browser, run }, "anon", undefined, async (o) => {
          const res = await o.page.goto(t.url);
          expect(res?.status()).toBe(200);
          const landed = () => (isOrgPage(row) ? orgPathOf(run, o.page.url()) : apexPathOf(o.page.url()));
          await expect.poll(landed).toBe(row.landsOn?.anon ?? t.rel);
          await expectRendered(o, row);
          await o.page.waitForLoadState("load");
          if (row.path.startsWith("/controls")) {
            await expect(o.page.getByText("Something went wrong")).toHaveCount(0);
            expect(await o.overlaySeen(), "the shared LoadingOverlay mounted on a /controls page (AGENTS.md)").toBe(false);
          }
          expect(o.problems()).toEqual([]);
        });
      });

      if (row.landsOn?.signedIn) {
        const sa = row.path.startsWith("/controls");
        test(`signed in (${sa ? "SuperAdmin" : "Test-Org admin"}) → ${row.landsOn.signedIn}`, async ({ browser, run, f, as, url, sa: saClient }) => {
          const t = await target(row, deps({ f, as, url, run }));
          await withPage({ browser, run }, sa ? "sa" : "admin", sa ? saClient.token : undefined, async (o) => {
            const res = await o.page.goto(t.url);
            expect(res?.status()).toBe(200);
            await expect.poll(() => (sa ? apexPathOf(o.page.url()) : orgPathOf(run, o.page.url()))).toBe(row.landsOn!.signedIn);
            await expect(o.page.getByText(row.landsOn!.signedInText!).first()).toBeVisible();
            expect(o.problems()).toEqual([]);
          });
        });
      }

      if (isOrgPage(row)) {
        test("wrong org's session (org B admin) → /login with the cross-org notice naming org B only", async ({ browser, run, f, as, url }) => {
          const t = await target(row, deps({ f, as, url, run }));
          await withPage({ browser, run }, "orgB-admin", undefined, async (o) => {
            await o.page.goto(t.url);
            await expect.poll(() => orgPathOf(run, o.page.url())).toBe("/login");
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

// ── routing ─────────────────────────────────────────────────────────────────

test.describe("routing", () => {
  test("apex 404 guard: a non-root, non-/controls path on the apex host → 404 (subdomain hosts only)", async ({ browser, run }) => {
    if (!isSubdomain) {
      test.info().annotations.push({ type: "precondition", description: "path-mode target: the apex guard only exists on *.easeetool.com hosts (Task 3 mode log) — not exercised" });
      expect(isSubdomain).toBe(false);
      return;
    }
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      for (const p of ["/projects", "/dashboard", `/${run.testOrg.slug}/login`]) {
        const res = await o.page.goto(p);
        expect(res?.status(), p).toBe(404);
        await expect.poll(() => apexPathOf(o.page.url()), p).toBe(p);
      }
    });
  });

  test("subdomain routing: /controls is apex-only — an org subdomain 404s it (even with an SA session)", async ({ browser, run, sa }) => {
    if (!isSubdomain) {
      test.info().annotations.push({ type: "precondition", description: "path-mode target: no org subdomains — not exercised" });
      expect(isSubdomain).toBe(false);
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
});

// ── wizard gating ───────────────────────────────────────────────────────────

test.describe("wizard pills: Summary/Quotation lock until Submit Design, re-lock after a design edit", () => {
  const STEPS = ["Project Details", "Configuration", "Design", "Summary", "Quotation"] as const;

  async function pillState(o: Opened): Promise<Record<string, "open" | "locked">> {
    const nav = o.page.getByRole("navigation", { name: "Project wizard steps" });
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
        await expect.poll(() => orgPathOf(run, o.page.url()), step).toBe(`/projects/${p.id}`);
      }
      expect(o.problems()).toEqual([]);
    });
  });

  test("selection + partition → Design opens; Submit Design (UI) unlocks Summary/Quotation; a design PATCH re-locks them", async ({ browser, run, f, as, url }) => {
    test.setTimeout(180_000);
    const w = await readyWall(f, as.admin, url);
    const detail = orgTarget(run, `/projects/${w.projectId}`);
    await withPage({ browser, run }, "admin", undefined, async (o) => {
      // 1. Not submitted yet.
      await o.page.goto(detail);
      expect(await pillState(o)).toEqual({ "Project Details": "open", Configuration: "open", Design: "open", Summary: "locked", Quotation: "locked" });
      for (const step of ["summary", "quotation"]) {
        await o.page.goto(orgTarget(run, `/projects/${w.projectId}/${step}`));
        await expect.poll(() => orgPathOf(run, o.page.url()), step).toBe(`/projects/${w.projectId}`);
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
      await expect.poll(() => orgPathOf(run, o.page.url())).toBe(`/projects/${w.projectId}/summary`);
      await expect(o.page.getByText("Export PDF")).toBeVisible();

      // 3. A design edit clears designSubmittedAt (API, same as the Design canvas save) → re-locked.
      const edit = await as.admin.patch(url(`/partitions/${w.partitionId}`), {
        data: { design: { schemaVersion: 2, sections: [{ id: "s1", widthMm: 2000, cells: [{ id: "s1-c0", heightMm: 2400, selectionId: w.selectionId }] }] } },
      });
      expect(edit.status(), await edit.text()).toBe(200);
      await o.page.goto(detail);
      expect(await pillState(o)).toMatchObject({ Design: "open", Summary: "locked", Quotation: "locked" });
      await o.page.goto(orgTarget(run, `/projects/${w.projectId}/summary`));
      await expect.poll(() => orgPathOf(run, o.page.url())).toBe(`/projects/${w.projectId}`);
      expect(o.problems()).toEqual([]);
    });
  });
});

// ── KNOWN BUG / DECISION NEEDED pins (today's behaviour; the comment says what "fixed" looks like) ──

test.describe("pins", () => {
  test("KNOWN BUG: an external user opens another company's project and inquiry pages by URL (their lists hide them)", async ({ browser, run, f, as }) => {
    // KNOWN BUG — same root cause as the Task 8 API pins (inquiries #1, projects #5): GET-by-id is not scoped to
    // the external user's company. When fixed, update these expectations to the denial (likely notFound / 404).
    const p = await f.project(); // internal: no external company
    const inq = await f.inquiry();
    expect(await distributorCompanyId({ run, as })).toBeTruthy();
    await withPage({ browser, run }, "distributor", undefined, async (o) => {
      for (const [rel, text] of [
        [`/projects/${p.id}`, "Project Information"],
        [`/projects/${p.id}/edit`, "Edit Project"],
        [`/inquiries/${inq.id}`, inq.name],
        [`/inquiries/${inq.id}/edit`, "Edit Inquiry"],
      ] as const) {
        const res = await o.page.goto(orgTarget(run, rel));
        expect(res?.status(), rel).toBe(200);
        await expect.poll(() => orgPathOf(run, o.page.url()), rel).toBe(rel);
        await expect(o.page.getByText(text).first(), rel).toBeVisible();
      }
      // …while the distributor's own lists do not show them:
      await o.page.goto(orgTarget(run, `/projects?search=${encodeURIComponent(p.name)}`));
      await expect(o.page.getByText(p.name)).toHaveCount(0);
    });
  });

  test("DECISION NEEDED: /organizations is public on every host and lists every tenant (name, slug, created date)", async ({ browser, run }) => {
    // DECISION NEEDED — a Stage 1 dev listing kept "for dev convenience" (app/page.tsx), excluded from proxy.ts's
    // matcher, so it is served unauthenticated on the apex AND on every org subdomain. Same tenant-enumeration
    // concern as the backlog item for GET /api/v1/orgs. If it is removed or gated, update this pin.
    const hosts = isSubdomain ? ["/organizations", orgUrl(run.testOrg.slug, "/organizations")] : ["/organizations"];
    await withPage({ browser, run }, "anon", undefined, async (o) => {
      for (const h of hosts) {
        const res = await o.page.goto(h);
        expect(res?.status(), h).toBe(200);
        await expect(o.page.getByText(`/${run.testOrg.slug}`, { exact: true }), h).toBeVisible();
        await expect(o.page.getByText(`/${run.orgB.slug}`, { exact: true }), h).toBeVisible();
      }
    });
  });
});
