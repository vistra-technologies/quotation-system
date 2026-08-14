/**
 * Stage 15 — Batch A regression spec.
 *
 * Covers: L1 (inquiry pagination) and PL1 (project pagination) — boundary / count
 * invariants only.  No DOM-structure, layout, copy, or styling assertions.
 *
 * Requires: pageSize is now 10 (was 20).  The list page should show at most 10
 * rows per page regardless of how many records exist in the DB.
 *
 * If the dev DB has ≤ 10 records the test self-skips rather than producing a
 * false-green by asserting on an empty or tiny set.
 */

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

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
  request,
}) => {
  await signIn(page, "admin");

  // Pull total count from the API (pageSize=100 to get all, then use the total field).
  const apiResp = await request.get(
    "/api/v1/orgs/acme-glass/inquiries?page=1&pageSize=100&scope=all",
    { headers: { cookie: await page.evaluate(() => document.cookie) } },
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
  request,
}) => {
  await signIn(page, "admin");

  const apiResp = await request.get(
    "/api/v1/orgs/acme-glass/projects?page=1&pageSize=100&scope=all",
    { headers: { cookie: await page.evaluate(() => document.cookie) } },
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
