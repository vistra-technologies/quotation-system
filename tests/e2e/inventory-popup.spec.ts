/**
 * Stage 25 Batch 8 — Inventory create/edit popup e2e spec.
 *
 * Verification strategy — Tier 2 (browser UI, full round-trip):
 *
 * Signs in as `member` (has MANAGE_PRICING) on acme-glass, navigates to the
 * /inventory page, and exercises the create + edit modal flows end-to-end via
 * the browser. API-level auth/permission/409 paths are covered by
 * inventory-api.spec.ts (Batch 7); this spec covers the UI interaction layer
 * added in Batch 8.
 *
 * Covers:
 *   B8-1  Create — "New item" button opens modal with blank form
 *   B8-2  Create — client-side required-field error (code missing)
 *   B8-3  Create — successful create; new item appears in the list
 *   B8-4  Duplicate code — inline 409 error banner + code field error shown
 *   B8-5  Edit — per-row "Edit" button opens modal pre-filled
 *   B8-6  Edit — successful update; list reflects changed name
 *   B8-7  Create modal closes on Escape key
 *
 * Uses seeded credentials (password "Seed1234!" for all users, org "acme-glass").
 * Test items are prefixed "b8pop-<timestamp>" to avoid collisions with seed data.
 * Serial mode — tests build on prior state (created item is edited in B8-5/6).
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://<preview-url> npx playwright test inventory-popup
 */

import { test, expect } from "@playwright/test";
import { orgUrl, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const RUN_PREFIX = `b8pop-${Date.now()}`;
const ORG = "acme-glass";

/** Item created in B8-3; shared across B8-4, B8-5, B8-6 via serial execution. */
let createdItemCode = "";
let createdItemName = "";

// Rate-limit pacing — better-auth limits 3 sign-ins per 10 s.
test.beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 7_000));
});

// ─── B8-1: "New item" button opens blank modal ────────────────────────────────

test("B8-1: New item button opens blank create modal", async ({ page }) => {
  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "New item" }).click();

  // Dialog is visible with the correct title.
  await expect(
    page.getByRole("dialog").getByText("New inventory item"),
  ).toBeVisible({ timeout: 5_000 });

  // Code field is blank.
  await expect(page.locator("#item-form-code")).toHaveValue("");
  // Active toggle defaults to checked (aria-checked="true").
  await expect(page.getByRole("switch", { name: "Active" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

// ─── B8-2: Client-side required-field validation ─────────────────────────────

test("B8-2: Client-side required-field error when code is blank", async ({
  page,
}) => {
  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "New item" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

  // Fill name + unit but leave code blank.
  await page.locator("#item-form-name").fill("E2E No Code Item");
  await page.locator("#item-form-uom").fill("m²");

  await page.getByRole("button", { name: "Save item" }).click();

  // Inline error message for code field should appear.
  await expect(page.getByRole("alert").filter({ hasText: "Code is required" })).toBeVisible({
    timeout: 5_000,
  });

  // Dialog should remain open (no navigation).
  await expect(page.getByRole("dialog")).toBeVisible();
});

// ─── B8-3: Successful create — new item appears in the list ──────────────────

test("B8-3: Successful create — new item appears in the inventory list", async ({
  page,
}) => {
  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "New item" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

  createdItemCode = `${RUN_PREFIX}-T3`;
  createdItemName = "B8 E2E Create Item";

  await page.locator("#item-form-code").fill(createdItemCode);
  await page.locator("#item-form-name").fill(createdItemName);
  await page.locator("#item-form-uom").fill("m²");

  await page.getByRole("button", { name: "Save item" }).click();

  // Dialog closes after successful save.
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

  // New item appears in the list table.
  await expect(page.getByRole("cell", { name: createdItemName })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("cell", { name: createdItemCode }),
  ).toBeVisible();
});

// ─── B8-4: Duplicate code → inline 409 error shown ───────────────────────────

test("B8-4: Duplicate code shows inline 409 error in the modal", async ({
  page,
}) => {
  // createdItemCode must exist from B8-3 (serial mode guarantees order).
  expect(createdItemCode).toBeTruthy();

  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "New item" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

  // Use the same code as the item created in B8-3.
  await page.locator("#item-form-code").fill(createdItemCode);
  await page.locator("#item-form-name").fill("Duplicate Name");
  await page.locator("#item-form-uom").fill("m");

  await page.getByRole("button", { name: "Save item" }).click();

  // 409 inline banner must appear inside the dialog — check for the error text.
  await expect(
    page.getByRole("dialog").getByText(/already exists/i),
  ).toBeVisible({ timeout: 15_000 });

  // Per-field error on the code input.
  await expect(
    page.getByRole("alert").filter({ hasText: "already in use" }),
  ).toBeVisible();

  // Dialog stays open so the user can correct the code.
  await expect(page.getByRole("dialog")).toBeVisible();
});

// ─── B8-5: Per-row Edit button opens pre-filled modal ────────────────────────

test("B8-5: Edit button opens pre-filled modal for the created item", async ({
  page,
}) => {
  expect(createdItemCode).toBeTruthy();

  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  // Find the row for the created item and click its Edit button.
  const row = page.getByRole("row").filter({ hasText: createdItemName });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

  // Title says "Edit inventory item".
  await expect(
    page.getByRole("dialog").getByText("Edit inventory item"),
  ).toBeVisible();

  // Fields pre-populated from the row.
  await expect(page.locator("#item-form-code")).toHaveValue(createdItemCode);
  await expect(page.locator("#item-form-name")).toHaveValue(createdItemName);
});

// ─── B8-6: Successful edit — list reflects updated name ──────────────────────

test("B8-6: Successful edit — list reflects the updated item name", async ({
  page,
}) => {
  expect(createdItemCode).toBeTruthy();

  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  const row = page.getByRole("row").filter({ hasText: createdItemName });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

  // Change the name field.
  const updatedName = `${createdItemName} UPDATED`;
  await page.locator("#item-form-name").fill(updatedName);

  await page.getByRole("button", { name: "Save item" }).click();

  // Dialog closes.
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

  // Updated name is visible in the list.
  await expect(page.getByRole("cell", { name: updatedName })).toBeVisible({
    timeout: 15_000,
  });

  // Old name is gone.
  await expect(
    page.getByRole("cell", { name: createdItemName, exact: true }),
  ).not.toBeVisible();
});

// ─── B8-7: Escape key closes the create modal ────────────────────────────────

test("B8-7: Escape key closes the create modal without saving", async ({
  page,
}) => {
  await signIn(page, "member", undefined, ORG);
  await page.goto(orgUrl(ORG, "/inventory"));
  await expect(page.getByRole("heading", { name: "Inventory Management" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "New item" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });

  // Fill a name so we can confirm it doesn't appear in the list.
  await page.locator("#item-form-name").fill("Should Not Be Saved");

  await page.keyboard.press("Escape");

  // Dialog closes.
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 5_000 });

  // The un-saved name must not appear in the list.
  await expect(
    page.getByRole("cell", { name: "Should Not Be Saved" }),
  ).not.toBeVisible();
});
