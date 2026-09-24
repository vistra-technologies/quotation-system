/**
 * Stage 25 Batch 7 — Inventory create/update API spec.
 *
 * Verification strategy — Tier 1 (API-only, same pattern as
 * superadmin-formula-sets.spec.ts and stage23-wiring.spec.ts):
 *
 * All tests hit /api/v1/orgs/[orgSlug]/inventory surface directly via
 * Playwright's request fixture. No browser navigation required; PLAYWRIGHT_BASE_URL
 * is the only env var needed (beyond seeded credentials).
 *
 * Covers:
 *   T1  — POST /inventory without session → 401
 *   T2  — PATCH /inventory/[itemId] without session → 401
 *   T3  — POST /inventory as distributor (no MANAGE_PRICING) → 403
 *   T4  — PATCH /inventory/[itemId] as distributor (no MANAGE_PRICING) → 403
 *   T5  — POST missing required field (code) → 400
 *   T6  — POST missing required field (measurementUnit) → 400
 *   T7  — POST valid body → 201 + item in response
 *   T8  — POST same code again (duplicate within org) → 409
 *   T9  — PATCH update name and active → 200 + updated item
 *   T10 — Cross-org: nordic-walls admin PATCHes acme-glass item → 404
 *   T11 — Cross-org: nordic-walls admin GETs acme-glass item → 404
 *
 * Uses seeded credentials (password "Seed1234!" for all users).
 * Test items are prefixed "e2e-inv-<timestamp>" to avoid collisions with seed data.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   npx playwright test inventory-api
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// ── Constants ────────────────────────────────────────────────────────────────

const ACME = "acme-glass";
const NORDIC = "nordic-walls";

/** Unique prefix for test data created in this run — avoids collisions across runs. */
const RUN_PREFIX = `e2e-inv-${Date.now()}`;

/** A minimal valid InventoryItem payload (POST body). */
const VALID_ITEM = {
  code: `${RUN_PREFIX}-T7`,
  name: "E2E Test Item",
  measurementUnit: "sqm",
  perUnitQuantity: 1,
  active: true,
};

// ── Shared session state (serial — tests rely on prior writes) ────────────────

let acmeCtx: BrowserContext;
let nordicCtx: BrowserContext;
let anonCtx: BrowserContext;
let acme: Page;
let nordic: Page;
let anon: Page;

/** Item ID created in T7 — used by T8, T9, T10, T11. */
let createdItemId = "";

/** Helper: build a /inventory URL scoped to acme-glass. */
const A = (suffix = "") =>
  apiUrl(ACME, `/api/v1/orgs/${ACME}/inventory${suffix}`);
/** Helper: build a /inventory URL scoped to nordic-walls. */
const N = (suffix = "") =>
  apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/inventory${suffix}`);

test.beforeAll(async ({ browser }) => {
  // Acme-glass admin — has MANAGE_PRICING via the admin role.
  acmeCtx = await browser.newContext();
  acme = await acmeCtx.newPage();
  await apiSignIn(acme, ACME, "admin");

  // Nordic-walls admin — for cross-org tests.
  nordicCtx = await browser.newContext();
  nordic = await nordicCtx.newPage();
  await apiSignIn(nordic, NORDIC, "admin");

  // Unauthenticated context — for 401 tests.
  anonCtx = await browser.newContext();
  anon = await anonCtx.newPage();
});

test.afterAll(async () => {
  await acmeCtx.close();
  await nordicCtx.close();
  await anonCtx.close();
});

// ─── T1: POST /inventory without session → 401 ───────────────────────────────

test("T1: POST /inventory without session → 401", async () => {
  const res = await anon.request.post(A(), { data: VALID_ITEM });
  expect(res.status()).toBe(401);
});

// ─── T2: PATCH /inventory/[itemId] without session → 401 ─────────────────────

test("T2: PATCH /inventory/[nonexistent] without session → 401", async () => {
  const res = await anon.request.patch(A("/00000000-0000-0000-0000-000000000000"), {
    data: { name: "Updated" },
  });
  expect(res.status()).toBe(401);
});

// ─── T3: POST as distributor (no MANAGE_PRICING) → 403 ───────────────────────

test("T3: POST /inventory as distributor (no MANAGE_PRICING) → 403", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  try {
    // Rate-limit pacing: brief delay before this sign-in to avoid 429.
    await new Promise((r) => setTimeout(r, 7_000));
    await apiSignIn(pg, ACME, "distributor");
    const res = await pg.request.post(A(), { data: VALID_ITEM });
    expect(res.status()).toBe(403);
  } finally {
    await ctx.close();
  }
});

// ─── T4: PATCH as distributor (no MANAGE_PRICING) → 403 ─────────────────────

test("T4: PATCH /inventory/[id] as distributor (no MANAGE_PRICING) → 403", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  try {
    await new Promise((r) => setTimeout(r, 7_000));
    await apiSignIn(pg, ACME, "distributor");
    const res = await pg.request.patch(
      A("/00000000-0000-0000-0000-000000000000"),
      { data: { name: "Updated" } },
    );
    expect(res.status()).toBe(403);
  } finally {
    await ctx.close();
  }
});

// ─── T5: POST with missing `code` → 400 ──────────────────────────────────────

test("T5: POST /inventory with missing code → 400", async () => {
  const res = await acme.request.post(A(), {
    data: { name: "Item Without Code", measurementUnit: "sqm" },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/code/i);
});

// ─── T6: POST with missing `measurementUnit` → 400 ───────────────────────────

test("T6: POST /inventory with missing measurementUnit → 400", async () => {
  const res = await acme.request.post(A(), {
    data: { code: `${RUN_PREFIX}-T6`, name: "Item Without Unit" },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/measurementUnit/i);
});

// ─── T7: POST valid item → 201 ───────────────────────────────────────────────

test("T7: POST /inventory valid body → 201 + item returned", async () => {
  const res = await acme.request.post(A(), { data: VALID_ITEM });
  expect(res.status(), await res.text()).toBe(201);

  const body = (await res.json()) as { item: { id: string; code: string; name: string; measurementUnit: string; active: boolean } };
  expect(body.item).toBeDefined();
  expect(body.item.code).toBe(VALID_ITEM.code);
  expect(body.item.name).toBe(VALID_ITEM.name);
  expect(body.item.measurementUnit).toBe(VALID_ITEM.measurementUnit);
  expect(body.item.active).toBe(true);
  expect(typeof body.item.id).toBe("string");

  // Persist the ID for subsequent tests.
  createdItemId = body.item.id;
});

// ─── T8: POST same code again → 409 ──────────────────────────────────────────

test("T8: POST /inventory with duplicate code within org → 409", async () => {
  // T7 must have run first (serial mode guarantees this).
  expect(createdItemId).toBeTruthy();

  const res = await acme.request.post(A(), {
    data: { ...VALID_ITEM, name: "Duplicate Code Item" },
  });
  expect(res.status()).toBe(409);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/already exists/i);
});

// ─── T9: PATCH update name and active → 200 ──────────────────────────────────

test("T9: PATCH /inventory/[itemId] → 200 + updated item", async () => {
  expect(createdItemId).toBeTruthy();

  const res = await acme.request.patch(A(`/${createdItemId}`), {
    data: { name: "Updated E2E Test Item", active: false },
  });
  expect(res.status(), await res.text()).toBe(200);

  const body = (await res.json()) as { item: { id: string; name: string; active: boolean } };
  expect(body.item).toBeDefined();
  expect(body.item.id).toBe(createdItemId);
  expect(body.item.name).toBe("Updated E2E Test Item");
  expect(body.item.active).toBe(false);
});

// ─── T10: Cross-org PATCH — nordic-walls cannot update acme-glass item → 404 ─

test("T10: nordic-walls admin tries to PATCH an acme-glass item → 404", async () => {
  expect(createdItemId).toBeTruthy();

  // Nordic-walls session addressing the acme-glass item via the nordic-walls org URL.
  // The route resolves nordic-walls' session, then looks up the item by ID scoped
  // to nordic-walls' organizationId — finds nothing → 404.
  const res = await nordic.request.patch(N(`/${createdItemId}`), {
    data: { name: "Should Not Work" },
  });
  expect(res.status()).toBe(404);
});

// ─── T11: Cross-org GET — nordic-walls cannot read acme-glass item → 404 ─────

test("T11: nordic-walls admin tries to GET an acme-glass item → 404", async () => {
  expect(createdItemId).toBeTruthy();

  const res = await nordic.request.get(N(`/${createdItemId}`));
  expect(res.status()).toBe(404);
});
