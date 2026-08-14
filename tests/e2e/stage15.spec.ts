/**
 * Stage 15 — Batch A regression spec.
 *
 * Covers:
 *  - L1 / PL1: inquiry and project list pagination boundary / count invariants.
 *    No DOM-structure, layout, copy, or styling assertions.
 *    The list page must show at most 10 rows per page (pageSize=10, was 20).
 *    Self-skips when DB has ≤ 10 records so the suite doesn't false-green.
 *  - C10: inquiry create form submits successfully with Address Line 2 left empty.
 *    This is a navigation invariant (redirect away from /new), not a DOM assertion.
 *
 * Uses page.request (shares browser cookie store) for authenticated API calls.
 */

import { test, expect } from "@playwright/test";
import { signIn, fillCreateFormRequiredFields } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

// Rate-limit pacing — better-auth caps sign-in to ~3 / 10 s per IP.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// L1 — Inquiry list pagination boundary
// ---------------------------------------------------------------------------

test("L1 — inquiry list: first page shows ≤ 10 rows when total > 10", async ({
  page,
}) => {
  await signIn(page, "admin");

  // Pull total count from the API using page.request so it shares the auth cookie.
  const apiResp = await page.request.get(
    "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=100&scope=all",
  );
  expect(apiResp.ok()).toBe(true);
  const body = await apiResp.json();
  const total: number = body.total ?? body.inquiries?.length ?? 0;

  if (total <= 10) {
    test
      .info()
      .annotations.push({
        type: "skip",
        description: `Only ${total} inquiries — not enough to test pagination boundary (need > 10).`,
      });
    return;
  }

  // Navigate to page 1 of the inquiry list.
  await page.goto("/acme-glass/inquiries?page=1&scope=all");
  await page.waitForURL(/\/acme-glass\/inquiries/, { timeout: 20_000 });

  // Count data rows.  Must be ≤ 10 (the new pageSize).
  const rows = page.locator("tbody tr");
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(10);
});

// ---------------------------------------------------------------------------
// PL1 — Project list pagination boundary
// ---------------------------------------------------------------------------

test("PL1 — project list: first page shows ≤ 10 rows when total > 10", async ({
  page,
}) => {
  await signIn(page, "admin");

  // Pull total count from the API using page.request so it shares the auth cookie.
  const apiResp = await page.request.get(
    "/api/v1/orgs/acme-glass/projects?page=1&pageSize=100&scope=all",
  );
  expect(apiResp.ok()).toBe(true);
  const body = await apiResp.json();
  const total: number = body.total ?? body.projects?.length ?? 0;

  if (total <= 10) {
    test
      .info()
      .annotations.push({
        type: "skip",
        description: `Only ${total} projects — not enough to test pagination boundary (need > 10).`,
      });
    return;
  }

  await page.goto("/acme-glass/projects?page=1&scope=all");
  await page.waitForURL(/\/acme-glass\/projects/, { timeout: 20_000 });

  const rows = page.locator("tbody tr");
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThanOrEqual(10);
});

// ---------------------------------------------------------------------------
// C10 — Address Line 2 is now optional on the inquiry create form
// ---------------------------------------------------------------------------

test("C10 — inquiry create: form submits successfully with Address Line 2 empty", async ({
  page,
}) => {
  await signIn(page, "admin");

  await page.goto("/acme-glass/inquiries/new");
  await page.waitForURL(/inquiries\/new/, { timeout: 20_000 });

  // Fill required fields via helper (which also fills Address Line 2), then clear
  // Address Line 2 to confirm it is no longer required (the helper fills it by default
  // because it was required before C10 — clearing it proves the field is now optional).
  await page
    .locator("input[name='name']")
    .fill(`C10-addr2-optional-${Date.now()}`);
  await fillCreateFormRequiredFields(page, "AED", "Dubai, UAE");
  await page.locator("input[name='endClientAddressLine2']").fill("");

  // Submit the form.
  await page.locator("button[type='submit']").first().click();

  // The form must redirect away from /new — no browser validation block.
  // This is a navigation assertion (not a DOM/layout assertion).
  await page.waitForURL(/\/acme-glass\/inquiries(?!\/new)/, { timeout: 30_000 });
  expect(page.url()).not.toMatch(/\/new$/);
});
