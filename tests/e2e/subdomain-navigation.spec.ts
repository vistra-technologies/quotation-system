/**
 * Subdomain navigation regression spec — intensive coverage across the whole app.
 *
 * Purpose: every list→detail→back, sidebar link, wizard breadcrumb step, and
 * create-entry-point button must navigate correctly under subdomain routing
 * (vistra.test.easeetool.com) — the only mode where bugs-2.md Bug 1 and Bug 2
 * can manifest. The existing specs (subdomain-routing.spec.ts, subdomain-url-hygiene.spec.ts)
 * only cover top-level org resolution and do not drill into in-app navigation.
 *
 * What we guard against:
 *   Bug 1 — orgHref(orgSlug, "") returned "/" in subdomain mode, so `${base}/inquiries`
 *            became "//inquiries" (protocol-relative URL, browser treats as external host).
 *            Back links on all ~23 pages were broken. Fixed by removing the `|| "/"` fallback.
 *   Bug 2 — List page row links and action buttons hardcoded `/${orgSlug}/...` hrefs,
 *            leaking the org slug into the URL bar on subdomain hosts.
 *   Bug 3 — sidebar.tsx and top-bar-actions.tsx used `useOrgHref` (client hook reading
 *            window.location.hostname), producing incorrect hrefs in the SSR HTML.  React
 *            corrected the hrefs after client hydration so navigation worked in practice,
 *            but the server-rendered HTML was wrong.  Fixed by forwarding `isSubdomain` as
 *            a server-computed prop from layout.tsx (detectIsSubdomain()) so the correct
 *            href is rendered from the first SSR paint — no hydration mismatch.
 *
 * Seed data available in vistra org (from prisma/seed.ts):
 *   4 roles (Admin, Company Member, Distributor, Architectural Firm)
 *   2 external companies (Dist Co, Arch Firm)
 *   4 users (admin, member, distributor, architect)
 *   12 catalog items with prices (WT-001, GL-001, …)
 *   3 component types (GLASS, DOOR, PROFILE_STOP)
 * Projects and inquiries are created via API within the tests.
 *
 * All tests hit https://vistra.test.easeetool.com — the staging branch's stable
 * alias. Feature-branch previews have no *.test.easeetool.com alias; this spec
 * passes once the fix is merged to staging.
 *
 * Design:
 *   - One shared authenticated browser context (sign in once in beforeAll).
 *   - Each test creates its own page from that context.
 *   - Serial mode to respect better-auth's per-IP rate limiter.
 *
 * Runnable as:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
 *   npx playwright test subdomain-navigation
 */

import { test, expect, type BrowserContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const BASE = "https://vistra.test.easeetool.com";
const LOGIN = `${BASE}/login`;
const DASHBOARD = `${BASE}/dashboard`;

// Shared authenticated browser context — sign in once for the whole file.
let ctx: BrowserContext;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  const setup = await ctx.newPage();
  await setup.goto(LOGIN);
  await expect(setup.locator('input[autocomplete="username"]')).toBeVisible({
    timeout: 20_000,
  });
  await setup.getByLabel("User ID").fill("admin");
  await setup.getByLabel("Password", { exact: true }).fill(
    process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!",
  );
  await setup.getByRole("button", { name: /Sign in/i }).click();
  await setup.waitForURL(/vistra.*\/dashboard/, { timeout: 30_000 });
  await setup.close();
});

test.afterAll(async () => {
  await ctx.close();
});

/**
 * Assert that `url` has no /{orgSlug}/ path prefix leak (Bug 2 guard) and
 * contains the expected path segment.
 */
function assertCleanSubdomainUrl(url: string, expectedPathSegment: string) {
  expect(url, `URL must not contain /vistra/ path prefix, got: "${url}"`).not.toMatch(
    /\/vistra\//,
  );
  expect(
    url,
    `URL must contain "${expectedPathSegment}", got: "${url}"`,
  ).toContain(expectedPathSegment);
}

// ---------------------------------------------------------------------------
// A. Sidebar navigation — all links, starting from dashboard
// ---------------------------------------------------------------------------

test("sidebar: EaseeTool logo → dashboard (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  // The logo mark + wordmark is a Link to /dashboard.
  await page.getByRole("link", { name: "EaseeTool" }).click();
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/dashboard");
  await expect(page.getByRole("heading", { name: /Welcome/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

test("sidebar: Inquiries link → inquiries list (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);

  // Assert the href attribute of the sidebar Inquiries link directly — this
  // guards against Bug 3 (SSR/hydration mismatch).
  //
  // With the server-prop fix (isSubdomain forwarded from layout.tsx) the href
  // is correct from the very first SSR paint so expect() succeeds immediately.
  //
  // Against unfixed staging (useOrgHref client-side detection) the SSR HTML
  // has href="/vistra/inquiries"; React corrects it to "/inquiries" during
  // hydration.  toHaveAttribute() polls with retries so it naturally waits for
  // hydration to settle without needing waitForLoadState("networkidle") (which
  // hangs on apps with persistent connections).
  const inquiriesLink = page.getByRole("link", { name: "Inquiries" });
  await expect(inquiriesLink).toHaveAttribute("href", "/inquiries", {
    timeout: 10_000,
  });

  await inquiriesLink.click();
  await page.waitForURL(`${BASE}/inquiries`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/inquiries");
  await expect(page.getByRole("heading", { name: /Inquiries/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

test("sidebar: Orders link → orders placeholder (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("link", { name: "Orders" }).click();
  await page.waitForURL(`${BASE}/orders`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/orders");
  // Orders is a placeholder; just assert the page rendered without crashing.
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });
  await page.close();
});

test("sidebar: Projects link → projects list (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.waitForURL(`${BASE}/projects`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/projects");
  await expect(page.getByRole("heading", { name: /Projects/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

test("sidebar admin flyout: Users link → admin/users (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  // Hover the Admin button to open the CSS flyout, then click the Users link.
  await page.getByRole("button", { name: "Admin" }).hover();
  const usersLink = page.getByRole("link", { name: "Users" });
  await expect(usersLink).toBeVisible({ timeout: 5_000 });
  await usersLink.click();
  await page.waitForURL(`${BASE}/admin/users`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/users");
  // Page h1 = "User Management" (t("pageTitle") in users namespace)
  await expect(page.getByRole("heading", { name: /User Management/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

test("sidebar admin flyout: External Companies link → admin/external-companies (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("button", { name: "Admin" }).hover();
  const ecLink = page.getByRole("link", { name: "External Companies" });
  await expect(ecLink).toBeVisible({ timeout: 5_000 });
  await ecLink.click();
  await page.waitForURL(`${BASE}/admin/external-companies`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/external-companies");
  await expect(
    page.getByRole("heading", { name: /External Companies/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.close();
});

test("sidebar admin flyout: Pricing link → /pricing (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("button", { name: "Admin" }).hover();
  const pricingLink = page.getByRole("link", { name: "Pricing" });
  await expect(pricingLink).toBeVisible({ timeout: 5_000 });
  await pricingLink.click();
  await page.waitForURL(`${BASE}/pricing`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/pricing");
  await expect(page.getByRole("heading", { name: /Pricing/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

// NOTE (Stage 16 Batch F): Roles and Permissions flyout link tests removed.
// Those sidebar links are gone — roles/permissions admin moved to /controls/roles.

// NOTE (Stage 19 Batch 5): Component Types flyout link test removed.
// The sidebar flyout no longer contains a Component Types entry — management moved
// to /controls/component-types (SuperAdmin console).

// ---------------------------------------------------------------------------
// B. List → detail → back-link flows
// (Inquiries flow already covered in subdomain-routing.spec.ts tests 9-10)
// ---------------------------------------------------------------------------

test("projects: list row link + back-link navigate with clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  // Create a project via API so the test is self-contained.
  const createRes = await page.request.post(
    `${BASE}/api/v1/orgs/vistra/projects`,
    {
      data: {
        name: "Subdomain nav regression — projects",
        destinationCountry: "SG",
        currency: "SGD",
      },
    },
  );
  expect(createRes.status()).toBe(201);
  const { project } = (await createRes.json()) as { project: { id: string } };

  // Navigate to projects list — row link href must have no /{orgSlug}/ prefix.
  await page.goto(`${BASE}/projects`);
  await expect(page.getByRole("heading", { name: /Projects/i })).toBeVisible({
    timeout: 15_000,
  });
  const rowLink = page.locator(`a[href="/projects/${project.id}"]`);
  await expect(rowLink).toBeVisible({ timeout: 10_000 });
  const href = await rowLink.getAttribute("href");
  expect(href, `Project row link must not contain /vistra/ prefix`).not.toMatch(
    /^\/vistra\//,
  );
  expect(href).toBe(`/projects/${project.id}`);

  // Click the row link — must navigate without hanging.
  await rowLink.click();
  await page.waitForURL(`${BASE}/projects/${project.id}`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), `/projects/${project.id}`);
  await expect(
    page.getByRole("heading", { name: /Project Details/i }),
  ).toBeVisible({ timeout: 10_000 });

  // NOTE (Stage 19 Batch 4 / test-fix batch 1): the "Back to Projects" link
  // (both the top-of-page link and the card footer link) was deliberately
  // removed from every wizard step, including the project-details page —
  // this was the Bug-1 regression guard for a link that no longer exists.
  // Navigate back via the URL bar instead, to keep this test's remaining
  // "clean subdomain URL" coverage of the projects list page intact.
  await page.goto(`${BASE}/projects`);
  assertCleanSubdomainUrl(page.url(), "/projects");
  await expect(page.getByRole("heading", { name: /Projects/i })).toBeVisible({
    timeout: 10_000,
  });

  await page.close();
});

test("admin users: Actions link + back-link navigate with clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  await page.goto(`${BASE}/admin/users`);
  // Page h1 = "User Management"
  await expect(page.getByRole("heading", { name: /User Management/i })).toBeVisible({
    timeout: 15_000,
  });

  // Stage 14 Batch D: "Actions" text link replaced by icon-only Edit link (aria-label="Edit").
  // The seeded "admin" user is always present; use the first Edit link.
  const actionsLink = page.getByRole("link", { name: "Edit" }).first();
  await expect(actionsLink).toBeVisible({ timeout: 10_000 });
  const href = await actionsLink.getAttribute("href");
  expect(
    href,
    `User detail link must not contain /vistra/ prefix`,
  ).not.toMatch(/^\/vistra\//);
  expect(href).toMatch(/^\/admin\/users\//);

  await actionsLink.click();
  await page.waitForURL(/vistra\.test\.easeetool\.com\/admin\/users\/[^/]+$/, {
    timeout: 15_000,
  });
  assertCleanSubdomainUrl(page.url(), "/admin/users/");
  // User detail page must render (any h1 suffices — page title varies by user).
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Back link: "← Back to Users"
  const backLink = page.getByRole("link", { name: /Back to Users/i });
  await expect(backLink).toBeVisible({ timeout: 5_000 });
  const backHref = await backLink.getAttribute("href");
  expect(
    backHref,
    `Back link href must be "/admin/users", got: "${backHref}"`,
  ).toBe("/admin/users");
  await backLink.click();
  await page.waitForURL(`${BASE}/admin/users`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/users");
  await expect(page.getByRole("heading", { name: /User Management/i })).toBeVisible({
    timeout: 10_000,
  });

  await page.close();
});

// NOTE (Stage 16 Batch F): "admin roles: Role Permissions link + back-link" test removed.
// The org-admin roles route is gone — roles/permissions admin moved to /controls/roles.

// NOTE (Stage 19 Batch 5): "admin component types: Edit link + back-link" test replaced.
// The old /admin/components route is deleted. Component Type management moved to
// /controls/component-types (SuperAdmin console). The new test verifies the
// SuperAdmin navigation at /controls/component-types (covered by
// superadmin-component-types.spec.ts — "controls component types: navigate to edit").

test("pricing: Edit Prices link + back-link navigate with clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  await page.goto(`${BASE}/pricing`);
  await expect(page.getByRole("heading", { name: /Pricing/i })).toBeVisible({
    timeout: 15_000,
  });

  // "Edit Prices" is the link text for catalog item rows (t("editPageTitle") in pricing namespace).
  // 12 catalog items are seeded; use the first.
  const editLink = page.getByRole("link", { name: /Edit Prices/i }).first();
  await expect(editLink).toBeVisible({ timeout: 10_000 });
  const href = await editLink.getAttribute("href");
  expect(
    href,
    `Pricing item link must not contain /vistra/ prefix`,
  ).not.toMatch(/^\/vistra\//);
  expect(href).toMatch(/^\/pricing\//);

  await editLink.click();
  await page.waitForURL(/vistra\.test\.easeetool\.com\/pricing\/[^/]+$/, {
    timeout: 15_000,
  });
  assertCleanSubdomainUrl(page.url(), "/pricing/");
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Back link: "← Back to Pricing"
  const backLink = page.getByRole("link", { name: /Back to Pricing/i });
  await expect(backLink).toBeVisible({ timeout: 5_000 });
  const backHref = await backLink.getAttribute("href");
  expect(
    backHref,
    `Back link href must be "/pricing", got: "${backHref}"`,
  ).toBe("/pricing");
  await backLink.click();
  await page.waitForURL(`${BASE}/pricing`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/pricing");

  await page.close();
});

// ---------------------------------------------------------------------------
// C. Project wizard breadcrumb — all 5 steps
// ---------------------------------------------------------------------------

test("project wizard: all 5 breadcrumb steps navigate with clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  // Create a project to test the wizard breadcrumb on.
  const createRes = await page.request.post(
    `${BASE}/api/v1/orgs/vistra/projects`,
    {
      data: {
        name: "Wizard breadcrumb subdomain regression",
        destinationCountry: "MY",
        currency: "MYR",
      },
    },
  );
  expect(createRes.status()).toBe(201);
  const { project } = (await createRes.json()) as { project: { id: string } };
  const pid = project.id;

  // Stage 19 Batch 4 introduced sequential step-gating: Design locks until the
  // project has ≥1 Selection, and Summary/Quotation lock until it has ≥1
  // Partition. Locked steps render as <span aria-disabled> rather than <a>, so
  // a fresh project only has 2 real links (Project Details, Configuration) in
  // the breadcrumb — seed a Selection + Partition first (same shape as
  // stage19.spec.ts's "project with Selections and Partitions" test) so all 5
  // steps are unlocked <a> tags, matching this test's own intent (exercising
  // clean-URL navigation across all 5 steps, not the gating itself — that's
  // covered separately in stage19.spec.ts).
  const ctRes = await page.request.get(`${BASE}/api/v1/orgs/vistra/component-types`);
  expect(ctRes.status()).toBe(200);
  const { componentTypes } = (await ctRes.json()) as { componentTypes: { id: string }[] };
  expect(componentTypes.length).toBeGreaterThan(0);

  const selRes = await page.request.post(`${BASE}/api/v1/orgs/vistra/selections`, {
    data: {
      projectId: pid,
      componentTypeId: componentTypes[0].id,
      label: "Wizard breadcrumb selection",
      config: {},
      orderIndex: 0,
    },
  });
  expect(selRes.status()).toBe(201);

  const floorRes = await page.request.post(`${BASE}/api/v1/orgs/vistra/floors`, {
    data: { projectId: pid, label: "Wizard breadcrumb floor" },
  });
  expect(floorRes.status()).toBe(201);
  const { floor: { id: floorId } } = (await floorRes.json()) as { floor: { id: string } };

  const roomRes = await page.request.post(`${BASE}/api/v1/orgs/vistra/rooms`, {
    data: { floorId, label: "Wizard breadcrumb room" },
  });
  expect(roomRes.status()).toBe(201);
  const { room: { id: roomId } } = (await roomRes.json()) as { room: { id: string } };

  // isClosed: false — a single-side open run bypasses the ≥3-sides validation
  // that applies only to closed rooms (Stage 18 §2).
  const sidesRes = await page.request.patch(`${BASE}/api/v1/orgs/vistra/rooms/${roomId}/sides`, {
    data: {
      isClosed: false,
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: "Wizard breadcrumb wall", heightMm: 2400, widthMm: 1200 },
      ],
    },
  });
  expect(sidesRes.status()).toBe(200);

  // Navigate to project detail (Step 1 — Project Details).
  await page.goto(`${BASE}/projects/${pid}`);
  await expect(page.getByRole("heading", { name: /Project Details/i })).toBeVisible({
    timeout: 15_000,
  });
  assertCleanSubdomainUrl(page.url(), `/projects/${pid}`);

  // Assert all 5 breadcrumb hrefs are clean before clicking any.
  // The breadcrumb is an <ol aria-label="Project wizard steps"> with <li><a> for each step.
  const breadcrumbLinks = await page
    .locator("nav[aria-label='Project wizard steps'] a")
    .all();
  expect(breadcrumbLinks.length, "Expected 5 wizard breadcrumb steps").toBe(5);

  for (const link of breadcrumbLinks) {
    const linkHref = (await link.getAttribute("href")) ?? "";
    expect(
      linkHref,
      `Breadcrumb href must not contain /vistra/ prefix: "${linkHref}"`,
    ).not.toMatch(/^\/vistra\//);
    expect(
      linkHref,
      `Breadcrumb href must not be a protocol-relative URL (//...): "${linkHref}"`,
    ).not.toMatch(/^\/\//);
    expect(
      linkHref,
      `Breadcrumb href must be rooted under /projects/${pid}: "${linkHref}"`,
    ).toMatch(new RegExp(`^/projects/${pid}`));
  }

  // Scope all breadcrumb clicks to the nav element — other pages have action
  // buttons (e.g. "Next: Configuration →") that also match the step names and
  // would cause Playwright strict-mode "ambiguous locator" errors.
  const breadcrumbNav = page.locator("nav[aria-label='Project wizard steps']");

  // Step 2: Configuration
  await breadcrumbNav.getByRole("link", { name: /Configuration/i }).click();
  await page.waitForURL(`${BASE}/projects/${pid}/configuration`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), `/projects/${pid}/configuration`);

  // Step 3: Design (placeholder — just verify navigation succeeds, not content)
  await breadcrumbNav.getByRole("link", { name: /Design/i }).click();
  await page.waitForURL(`${BASE}/projects/${pid}/design`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), `/projects/${pid}/design`);

  // Step 4: Summary
  await breadcrumbNav.getByRole("link", { name: /Summary/i }).click();
  await page.waitForURL(`${BASE}/projects/${pid}/summary`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), `/projects/${pid}/summary`);

  // Step 5: Quotation
  await breadcrumbNav.getByRole("link", { name: /Quotation/i }).click();
  await page.waitForURL(`${BASE}/projects/${pid}/quotation`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), `/projects/${pid}/quotation`);

  // Navigate back to Step 1 (Project Details) to confirm round-trip.
  await breadcrumbNav.getByRole("link", { name: /Project Details/i }).click();
  await page.waitForURL(`${BASE}/projects/${pid}`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), `/projects/${pid}`);

  await page.close();
});

// ---------------------------------------------------------------------------
// D. "New / Create" entry-point buttons — all list pages
// ---------------------------------------------------------------------------

test("new-entry-point buttons across all list pages navigate to clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  // Helper: navigate to a list page, click its primary "New X" button,
  // assert the resulting URL is clean, then go back for the next check.
  async function checkNewButton(
    listUrl: string,
    listHeadingPattern: RegExp,
    newButtonPattern: RegExp,
    expectedNewUrl: string,
  ) {
    await page.goto(listUrl);
    await expect(page.getByRole("heading").filter({ hasText: listHeadingPattern })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("link", { name: newButtonPattern }).click();
    await page.waitForURL(expectedNewUrl, { timeout: 15_000 });
    assertCleanSubdomainUrl(page.url(), new URL(expectedNewUrl).pathname);
  }

  // + New Inquiry
  await checkNewButton(
    `${BASE}/inquiries`,
    /Inquiries/i,
    /New Inquiry/i,
    `${BASE}/inquiries/new`,
  );

  // + New Project
  await checkNewButton(
    `${BASE}/projects`,
    /Projects/i,
    /New Project/i,
    `${BASE}/projects/new`,
  );

  // + Create User (admin users list — page h1 is "User Management", button = t("createUser") = "Create User")
  await checkNewButton(
    `${BASE}/admin/users`,
    /User Management/i,
    /Create User/i,
    `${BASE}/admin/users/new`,
  );

  // NOTE (Stage 16 Batch F): admin/roles and admin/permissions checkNewButton calls removed.
  // Those routes are deleted — roles/permissions admin moved to /controls/roles.

  // + Create Company (admin external-companies list — button text is t("createCompany") = "Create Company")
  await checkNewButton(
    `${BASE}/admin/external-companies`,
    /External Companies/i,
    /Create Company/i,
    `${BASE}/admin/external-companies/new`,
  );

  // NOTE (Stage 19 Batch 5): /admin/components create-button check removed.
  // The route is deleted — Component Types management moved to /controls/component-types.

  await page.close();
});
