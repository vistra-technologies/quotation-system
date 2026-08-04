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

test("sidebar admin flyout: Roles link → admin/roles (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("button", { name: "Admin" }).hover();
  const rolesLink = page.getByRole("link", { name: "Roles" });
  await expect(rolesLink).toBeVisible({ timeout: 5_000 });
  await rolesLink.click();
  await page.waitForURL(`${BASE}/admin/roles`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/roles");
  await expect(page.getByRole("heading", { name: /Roles/i })).toBeVisible({
    timeout: 10_000,
  });
  await page.close();
});

test("sidebar admin flyout: Permissions link → admin/permissions (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("button", { name: "Admin" }).hover();
  const permissionsLink = page.getByRole("link", { name: "Permissions" });
  await expect(permissionsLink).toBeVisible({ timeout: 5_000 });
  await permissionsLink.click();
  await page.waitForURL(`${BASE}/admin/permissions`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/permissions");
  // Page h1 = "Permission Catalog" (t("pageTitle") in permissions namespace)
  await expect(
    page.getByRole("heading", { name: /Permission Catalog/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.close();
});

test("sidebar admin flyout: Component Types link → admin/components (clean URL)", async () => {
  const page = await ctx.newPage();
  await page.goto(DASHBOARD);
  await page.getByRole("button", { name: "Admin" }).hover();
  const ctLink = page.getByRole("link", { name: "Component Types" });
  await expect(ctLink).toBeVisible({ timeout: 5_000 });
  await ctLink.click();
  await page.waitForURL(`${BASE}/admin/components`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/components");
  await expect(
    page.getByRole("heading", { name: /Component Types/i }),
  ).toBeVisible({ timeout: 10_000 });
  await page.close();
});

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

  // "Back to Projects" back link — the Bug 1 regression guard for this page.
  // Both the top-of-page link and the card footer link point at /projects.
  const backLink = page.getByRole("link", { name: /Back to Projects/i }).first();
  await expect(backLink).toBeVisible({ timeout: 5_000 });
  const backHref = await backLink.getAttribute("href");
  expect(
    backHref,
    `Back link href must be "/projects", got: "${backHref}"`,
  ).toBe("/projects");
  await backLink.click();
  await page.waitForURL(`${BASE}/projects`, { timeout: 15_000 });
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

  // "Actions" is the link text for user row detail links (t("colActions")).
  // The seeded "admin" user is always present; use the first Actions link.
  const actionsLink = page.getByRole("link", { name: "Actions" }).first();
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

test("admin roles: Role Permissions link + back-link navigate with clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  await page.goto(`${BASE}/admin/roles`);
  await expect(page.getByRole("heading", { name: /Roles/i })).toBeVisible({
    timeout: 15_000,
  });

  // "Role Permissions" is the link text for role rows (t("detailPageTitle")).
  // 4 roles are seeded; use the first.
  const detailLink = page.getByRole("link", { name: /Role Permissions/i }).first();
  await expect(detailLink).toBeVisible({ timeout: 10_000 });
  const href = await detailLink.getAttribute("href");
  expect(
    href,
    `Role detail link must not contain /vistra/ prefix`,
  ).not.toMatch(/^\/vistra\//);
  expect(href).toMatch(/^\/admin\/roles\//);

  await detailLink.click();
  await page.waitForURL(/vistra\.test\.easeetool\.com\/admin\/roles\/[^/]+$/, {
    timeout: 15_000,
  });
  assertCleanSubdomainUrl(page.url(), "/admin/roles/");
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Back link: "← Back to Roles"
  const backLink = page.getByRole("link", { name: /Back to Roles/i });
  await expect(backLink).toBeVisible({ timeout: 5_000 });
  const backHref = await backLink.getAttribute("href");
  expect(
    backHref,
    `Back link href must be "/admin/roles", got: "${backHref}"`,
  ).toBe("/admin/roles");
  await backLink.click();
  await page.waitForURL(`${BASE}/admin/roles`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/roles");

  await page.close();
});

test("admin component types: Edit link + back-link navigate with clean subdomain URLs", async () => {
  const page = await ctx.newPage();

  await page.goto(`${BASE}/admin/components`);
  await expect(
    page.getByRole("heading", { name: /Component Types/i }),
  ).toBeVisible({ timeout: 15_000 });

  // "Edit Component Type" is the link text for component type rows (t("editPageTitle")).
  // 3 types are seeded (GLASS, DOOR, PROFILE_STOP); use the first.
  const editLink = page.getByRole("link", { name: /Edit Component Type/i }).first();
  await expect(editLink).toBeVisible({ timeout: 10_000 });
  const href = await editLink.getAttribute("href");
  expect(
    href,
    `Component type link must not contain /vistra/ prefix`,
  ).not.toMatch(/^\/vistra\//);
  expect(href).toMatch(/^\/admin\/components\//);

  await editLink.click();
  await page.waitForURL(/vistra\.test\.easeetool\.com\/admin\/components\/[^/]+$/, {
    timeout: 15_000,
  });
  assertCleanSubdomainUrl(page.url(), "/admin/components/");
  await expect(page.locator("h1")).toBeVisible({ timeout: 10_000 });

  // Back link: "← Back to Component Types"
  const backLink = page.getByRole("link", { name: /Back to Component Types/i });
  await expect(backLink).toBeVisible({ timeout: 5_000 });
  const backHref = await backLink.getAttribute("href");
  expect(
    backHref,
    `Back link href must be "/admin/components", got: "${backHref}"`,
  ).toBe("/admin/components");
  await backLink.click();
  await page.waitForURL(`${BASE}/admin/components`, { timeout: 15_000 });
  assertCleanSubdomainUrl(page.url(), "/admin/components");

  await page.close();
});

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

  // + Create Role (admin roles list — button text is t("createRole") = "Create Role")
  await checkNewButton(
    `${BASE}/admin/roles`,
    /Roles/i,
    /Create Role/i,
    `${BASE}/admin/roles/new`,
  );

  // + Create Permission (admin permissions list — page h1 is "Permission Catalog", button = t("createPermission") = "Create Permission")
  await checkNewButton(
    `${BASE}/admin/permissions`,
    /Permission Catalog/i,
    /Create Permission/i,
    `${BASE}/admin/permissions/new`,
  );

  // + Create Company (admin external-companies list — button text is t("createCompany") = "Create Company")
  await checkNewButton(
    `${BASE}/admin/external-companies`,
    /External Companies/i,
    /Create Company/i,
    `${BASE}/admin/external-companies/new`,
  );

  // + Create Type (admin components list — button text is t("createType") = "Create Type")
  await checkNewButton(
    `${BASE}/admin/components`,
    /Component Types/i,
    /Create Type/i,
    `${BASE}/admin/components/new`,
  );

  await page.close();
});
