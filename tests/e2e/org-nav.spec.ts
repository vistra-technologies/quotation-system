/**
 * Org-navigation regression spec (Items 7, 9, 11, 12).
 *
 * Exercises the real-browser flows that prior curl-only passes could not reach:
 *   - Apex page org-selector link destinations (no localhost hardcode)
 *   - Path-based org routing: known slug → login page, unknown slug → 404
 *   - Full sign-in → dashboard → sign-out flow
 *   - Cross-org session-replay guard (path-based routing, shared cookie jar)
 *
 * Run against the stable preview deployment:
 *   PLAYWRIGHT_BASE_URL=https://v-quote-test.vercel.app \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> \
 *   npx playwright test org-nav
 *
 * When VERCEL_AUTOMATION_BYPASS_SECRET is set, playwright.config.ts injects
 * x-vercel-protection-bypass and x-vercel-set-bypass-cookie headers on every
 * request so Vercel's SSO wall is bypassed without repeated header injection.
 */

import { test, expect } from "@playwright/test";

// Run this file serially — auth-flow tests are flaky under concurrent Turbopack
// compilation load on local dev. (On a pre-built Vercel preview this is not needed,
// but serial is safe everywhere.)
test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Helper — extract org links from the apex org-selector page
// ---------------------------------------------------------------------------
async function getOrgLinks(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Quotation System" }),
  ).toBeVisible();

  // Collect all org <a> elements in the nav (exclude the dev-tools links)
  const nav = page.locator("nav");
  const links = await nav.locator("a").all();
  const result: { name: string; href: string }[] = [];
  for (const link of links) {
    const name = (await link.textContent()) ?? "";
    const href = (await link.getAttribute("href")) ?? "";
    result.push({ name: name.trim(), href });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Item 12-a  Org links on the apex page must NOT point at localhost
// ---------------------------------------------------------------------------
test("apex org-selector links point at the deployed origin, not localhost", async ({
  page,
  baseURL,
}) => {
  const links = await getOrgLinks(page);

  // Must have at least the 4 seeded orgs
  expect(links.length).toBeGreaterThanOrEqual(4);

  for (const { name, href } of links) {
    // Each href must not contain 'localhost' in any form
    expect(
      href,
      `Org "${name.replace(/\s+/g, " ")}" link href contains localhost`,
    ).not.toContain("localhost");

    // Under path-based routing org links are relative paths like /{slug}/login.
    // Allow relative paths (no host) or absolute URLs on the same deployed origin
    // — but never a different host entirely.
    if (href.startsWith("http://") || href.startsWith("https://")) {
      const url = new URL(href, baseURL ?? "https://v-quote-test.vercel.app");
      expect(
        url.hostname,
        `Org "${name.replace(/\s+/g, " ")}" link points at unexpected host: ${url.hostname}`,
      ).not.toBe("localhost");
    }
  }
});

// ---------------------------------------------------------------------------
// Item 12-b  Clicking an org link stays on the deployed domain
// ---------------------------------------------------------------------------
test("clicking an org link stays on the deployed domain, not localhost", async ({
  page,
  baseURL,
}) => {
  // This assertion is only meaningful against a deployed environment.
  // When baseURL is localhost the final URL will always contain "localhost" — a
  // false failure, not a real regression.  The Stage 2 bug it guards (hardcoded
  // localhost in org link hrefs) is already caught by the href-inspection test
  // above, which passes correctly on localhost.
  test.skip(
    !baseURL || baseURL.includes("localhost"),
    "Skipped on localhost — test targets deployed environments only (always false-fails locally).",
  );

  const links = await getOrgLinks(page);
  expect(links.length).toBeGreaterThanOrEqual(1);

  const firstLinkText = links[0].name;
  const firstLinkHref = links[0].href;

  // Navigate via click
  let navigationError: Error | null = null;
  let finalUrl = "";

  try {
    await Promise.all([
      page.waitForURL(/.+/, { timeout: 10_000 }),
      page.locator("nav a").first().click(),
    ]);
    finalUrl = page.url();
  } catch (err) {
    navigationError = err as Error;
    finalUrl = page.url();
  }

  expect(
    finalUrl,
    `After clicking org "${firstLinkText}" (href="${firstLinkHref}"), browser ended up at an unexpected URL`,
  ).not.toContain("localhost");

  if (!navigationError) {
    const landed = new URL(finalUrl);
    expect(
      landed.hostname,
      `Browser navigated to the wrong host: ${landed.hostname}`,
    ).not.toBe("localhost");
  }
});

// ---------------------------------------------------------------------------
// Item 9 (path-based)  Unknown org slug → 404 JSON from proxy
// ---------------------------------------------------------------------------
test("unknown org slug in URL returns 404", async ({ page }) => {
  // The proxy checks the first path segment against the DB on every org-scoped
  // request.  An unrecognised slug must return 404 — not a login redirect or 200.
  const response = await page.goto("/nonexistent-org-slug/login", {
    waitUntil: "commit",
  });

  expect(response?.status()).toBe(404);

  // The proxy returns a JSON error body
  const body = await response?.text();
  expect(body).toContain("Organization not found");
});

// ---------------------------------------------------------------------------
// Item 9 / 11 (path-based)  Known org slug, unauthenticated → login page
// ---------------------------------------------------------------------------
test("unauthenticated request to /{orgSlug}/dashboard redirects to /{orgSlug}/login", async ({
  page,
}) => {
  // Open in a fresh context with no session cookies.
  // The Server Component calls getSession() → null (no cookie) → redirect.
  const response = await page.goto("/vistra/dashboard");

  // After following redirects, we must be on the login page
  expect(page.url()).toMatch(/\/vistra\/login/);

  // The login form heading must be visible
  await expect(
    page.getByRole("heading", { name: /Sign in to/i }),
  ).toBeVisible();

  // The response chain must have included a redirect (not a 200 straight through)
  // Playwright follows redirects automatically; final response is 200 on the login page.
  expect(response?.ok()).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Item 12 (full flow)  Apex → org login → sign in → dashboard → sign out
// ---------------------------------------------------------------------------
test("full flow: apex org link → login page → sign in → dashboard → sign out", async ({
  page,
  baseURL,
}) => {
  // Step 1: Load apex
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Quotation System" }),
  ).toBeVisible();

  // Step 2: Inspect the href — record it before clicking
  const firstLink = page.locator("nav a").first();
  const orgHref = await firstLink.getAttribute("href");

  // If the href points at localhost, the flow is broken — fail immediately with a clear description
  if (orgHref?.includes("localhost")) {
    throw new Error(
      `REGRESSION (Item 12): Org link href is "${orgHref}" — hardcoded to localhost. ` +
        `In production this takes the user to the local dev server, not to the deployed org login page. ` +
        `Root cause: app/page.tsx builds href with localhost instead of a relative path.`,
    );
  }

  // Step 3: Click and wait for the login page
  // Under path-based routing the proxy resolves the org from the first URL path
  // segment (/{orgSlug}/login) and injects x-org-id — no subdomain needed.
  await Promise.all([
    page.waitForURL(/\/[^/]+\/login/, { timeout: 10_000 }),
    firstLink.click(),
  ]);

  await expect(
    page.getByRole("heading", { name: /Sign in to/i }),
  ).toBeVisible({ timeout: 5_000 });

  // Extract org slug from the URL we've landed on (e.g. /vistra/login → "vistra")
  const loginUrl = new URL(page.url());
  const orgSlug = loginUrl.pathname.split("/")[1];

  // Step 4: Sign in with the org's admin credentials
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("Seed1234!");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Step 5: Dashboard must render with correct identity
  await page.waitForURL(new RegExp(`/${orgSlug}/dashboard`), {
    timeout: 10_000,
  });
  await expect(
    page.getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible();

  // Username must be visible on the dashboard
  // Use the dt/dd label-anchored locator so that the case-insensitive value
  // "Admin" (role) does not ambiguously match the username "admin".
  const usernameLocator = page.locator("dt", { hasText: "Username" }).locator("+ dd");
  await expect(usernameLocator).toHaveText("admin");
  // Org name must be visible (the display name, e.g. "Vistra Partitions")
  const orgNameLocator = page.locator("dt", { hasText: "Organization" }).locator("+ dd");
  await expect(orgNameLocator).not.toBeEmpty();
  // Role must be visible
  const roleLocator = page.locator("dt", { hasText: "Role" }).locator("+ dd");
  await expect(roleLocator).toHaveText("Admin");

  // Step 6: Sign out and confirm redirect back to /{orgSlug}/login
  await page.getByRole("button", { name: /Sign out/i }).click();
  await page.waitForURL(new RegExp(`/${orgSlug}/login`), { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /Sign in to/i }),
  ).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// Item 7  Cross-org session-replay guard (path-based)
// ---------------------------------------------------------------------------
test("cross-org session replay: vistra session rejected on acme-glass dashboard", async ({
  page,
}) => {
  // Sign in as vistra admin
  await page.goto("/vistra/login");
  await expect(
    page.getByRole("heading", { name: /Sign in to/i }),
  ).toBeVisible();
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("Seed1234!");
  await page.getByRole("button", { name: /Sign in/i }).click();

  // Confirm we're on vistra dashboard
  await page.waitForURL(/\/vistra\/dashboard/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // Now navigate to a DIFFERENT org's dashboard using the same session cookie.
  // The cross-org guard in lib/session.ts checks x-org-id (injected by proxy
  // from the URL path segment) against session.organizationId.  Mismatch → null
  // session → redirect to /{orgSlug}/login.
  await page.goto("/acme-glass/dashboard");

  // Must redirect to acme-glass login — NOT render the dashboard with vistra's data
  await page.waitForURL(/\/acme-glass\/login/, { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /Sign in to/i }),
  ).toBeVisible({ timeout: 5_000 });
});
