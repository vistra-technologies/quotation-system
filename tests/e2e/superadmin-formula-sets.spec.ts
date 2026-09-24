/**
 * SuperAdmin Formula Sets API spec (Stage 25 Batch 3).
 *
 * Verification strategy — Tier 1 (API-only, same pattern as
 * superadmin-component-types.spec.ts):
 *
 * All tests hit the /api/v1/superadmin/formula-sets surface directly via
 * Playwright's request fixture. No browser navigation required; PLAYWRIGHT_BASE_URL
 * is the only env var needed for the base address.
 *
 * FLAG-SA (SuperAdmin creds not set): All tests that require a valid SuperAdmin
 * session skip when TEST_SA_USERNAME / TEST_SA_PASSWORD are absent.
 * T1 (auth gate — no cookie needed) runs unconditionally.
 *
 * E2E state: created sets accumulate in the dev DB across runs. All test sets
 * are named with a `e2e-fs-<timestamp>` prefix to avoid collisions and to make
 * them identifiable as test data.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=... TEST_SA_PASSWORD=... \
 *   npx playwright test superadmin-formula-sets
 */

import { test, expect } from "@playwright/test";
import { readOrgActiveFormulaSet } from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// ── Environment probes ───────────────────────────────────────────────────────

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

// ── Shared test state (serial mode — each test can rely on prior tests' writes) ──

/** SA session token; populated in T2 and reused by all subsequent tests. */
let saToken = "";

/** The setId created in T3; used by T4, T7, T8, T10. */
let createdSetId = "";

/**
 * A name unique to this test run. T3 creates it as v1 (no version sent —
 * auto-computed); T10's new-version call will produce v2 after T8 has not
 * changed the version. T4a/T4b use completely separate name families to avoid
 * conflicting with T8 (which tests a PATCH on the T3 set).
 */
const TEST_SET_NAME = `e2e-fs-${Date.now()}`;

/** Minimal valid v1 FormulaSetBody — passes validateFormulaSetBody(). */
const VALID_BODY = { slots: { GLASS: { role: "glass" } } };

// ── Helper: log in as SuperAdmin and return the qs-sa-token cookie value ─────

async function loginAsSuperAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) {
    throw new Error(`SuperAdmin login failed: HTTP ${res.status()}`);
  }
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token cookie not found in login response");
  return match[1];
}

// ─── T1: Auth gate ────────────────────────────────────────────────────────────

test("T1: GET /formula-sets without SA cookie → 401", async ({ request }) => {
  const res = await request.get("/api/v1/superadmin/formula-sets");
  expect(res.status()).toBe(401);
});

test("T1b: POST /formula-sets without SA cookie → 401", async ({ request }) => {
  const res = await request.post("/api/v1/superadmin/formula-sets", {
    data: { name: "test", version: 1, body: VALID_BODY },
  });
  expect(res.status()).toBe(401);
});

test("T1c: GET /formula-sets/[setId] without SA cookie → 401", async ({ request }) => {
  const res = await request.get(
    "/api/v1/superadmin/formula-sets/00000000-0000-0000-0000-000000000000",
  );
  expect(res.status()).toBe(401);
});

test("T1d: PATCH /formula-sets/[setId] without SA cookie → 401", async ({ request }) => {
  const res = await request.patch(
    "/api/v1/superadmin/formula-sets/00000000-0000-0000-0000-000000000000",
    { data: { version: 2 } },
  );
  expect(res.status()).toBe(401);
});

test("T1e: POST /formula-sets/[setId]/version without SA cookie → 401", async ({ request }) => {
  const res = await request.post(
    "/api/v1/superadmin/formula-sets/00000000-0000-0000-0000-000000000000/version",
  );
  expect(res.status()).toBe(401);
});

// ─── T2: List ─────────────────────────────────────────────────────────────────

test("T2: GET /formula-sets with SA session → 200, formulaSets array", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }
  saToken = await loginAsSuperAdmin(request);

  const res = await request.get("/api/v1/superadmin/formula-sets", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { formulaSets: unknown[] };
  expect(Array.isArray(body.formulaSets)).toBe(true);
  // The seeded cloisons set should be present.
  expect(body.formulaSets.length).toBeGreaterThan(0);
  // Spot-check the list item shape (no `body` field in list).
  const first = body.formulaSets[0] as Record<string, unknown>;
  expect(typeof first.id).toBe("string");
  expect(typeof first.name).toBe("string");
  expect(typeof first.version).toBe("number");
  expect(typeof first.locked).toBe("boolean");
  expect(first.inUseBy).toBeTruthy();
  expect(first.body).toBeUndefined(); // body omitted from list
});

// ─── T3: Create ───────────────────────────────────────────────────────────────

test("T3: POST /formula-sets valid body (no version field) → 201, version=1", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  // Note: no `version` field in the request — version is auto-computed by the DAL.
  const res = await request.post("/api/v1/superadmin/formula-sets", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: {
      name: TEST_SET_NAME,
      body: VALID_BODY,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { formulaSet: Record<string, unknown> };
  expect(body.formulaSet).toBeTruthy();
  expect(typeof body.formulaSet.id).toBe("string");
  expect(body.formulaSet.name).toBe(TEST_SET_NAME);
  expect(body.formulaSet.version).toBe(1); // auto-computed: new name → v1
  expect(typeof body.formulaSet.body).toBe("object");
  expect(body.formulaSet.locked).toBe(false);
  expect((body.formulaSet.inUseBy as Record<string, unknown>).orgCount).toBe(0);
  // Save for subsequent tests.
  createdSetId = body.formulaSet.id as string;
});

// ─── T4a: New name auto-assigned v1 ──────────────────────────────────────────
//
// Replacing the old T4 "same name+version → 409" test. The client no longer
// supplies version; these tests verify the auto-version logic instead.
//
// T4a/T4b use SEPARATE name families to avoid interfering with TEST_SET_NAME,
// which is used by T7/T8/T10 with no version collision.

test("T4a: POST /formula-sets brand-new name → version=1 automatically", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  const newName = `${TEST_SET_NAME}-v1check`;
  const res = await request.post("/api/v1/superadmin/formula-sets", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { name: newName, body: VALID_BODY },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { formulaSet: Record<string, unknown> };
  expect(body.formulaSet.name).toBe(newName);
  expect(body.formulaSet.version).toBe(1); // new name → always v1
});

// ─── T4b: Existing name auto-increments to next version ──────────────────────

test("T4b: POST /formula-sets existing name → version auto-increments to v2", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  // Use a separate name family so this doesn't affect TEST_SET_NAME's version count.
  const incrName = `${TEST_SET_NAME}-incr`;

  // First create → v1.
  const res1 = await request.post("/api/v1/superadmin/formula-sets", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { name: incrName, body: VALID_BODY },
  });
  expect(res1.status()).toBe(201);
  const b1 = (await res1.json()) as { formulaSet: Record<string, unknown> };
  expect(b1.formulaSet.version).toBe(1);

  // Second create with same name → v2.
  const res2 = await request.post("/api/v1/superadmin/formula-sets", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { name: incrName, body: VALID_BODY },
  });
  expect(res2.status()).toBe(201);
  const b2 = (await res2.json()) as { formulaSet: Record<string, unknown> };
  expect(b2.formulaSet.name).toBe(incrName);
  expect(b2.formulaSet.version).toBe(2); // auto-incremented
});

// ─── T5: Invalid body content → 400 + validationErrors ───────────────────────

test("T5: POST /formula-sets invalid body content → 400 + validationErrors", async ({
  request,
}) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  // `slots` must be an object — sending a string violates the schema.
  const invalidBody = { slots: "not-an-object" };

  const res = await request.post("/api/v1/superadmin/formula-sets", {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: {
      name: `${TEST_SET_NAME}-invalid`,
      version: 1,
      body: invalidBody,
    },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: string; validationErrors: string[] };
  expect(body.error).toBe("Validation failed");
  expect(Array.isArray(body.validationErrors)).toBe(true);
  expect(body.validationErrors.length).toBeGreaterThan(0);
});

// ─── T6: Malformed JSON body → 400 ───────────────────────────────────────────

test("T6: POST /formula-sets malformed JSON → 400, never 500", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  const res = await request.post("/api/v1/superadmin/formula-sets", {
    headers: {
      Cookie: `qs-sa-token=${saToken}`,
      "Content-Type": "application/json",
    },
    data: "{not valid json",
  });
  expect(res.status()).toBe(400);
  expect(res.status()).not.toBe(500);
});

// ─── T7: Get detail ───────────────────────────────────────────────────────────

test("T7: GET /formula-sets/[setId] → 200, includes body + locked=false", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  const res = await request.get(`/api/v1/superadmin/formula-sets/${createdSetId}`, {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { formulaSet: Record<string, unknown> };
  expect(body.formulaSet.id).toBe(createdSetId);
  expect(body.formulaSet.name).toBe(TEST_SET_NAME);
  expect(typeof body.formulaSet.body).toBe("object"); // body present in detail
  expect(body.formulaSet.body).toBeTruthy();
  expect(body.formulaSet.locked).toBe(false);
  expect(body.formulaSet.updatedAt).toBeTruthy(); // updatedAt present in detail (not in list)
});

// ─── T8: Patch unlocked set ───────────────────────────────────────────────────

test("T8: PATCH /formula-sets/[setId] (unlocked) → 200", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  const res = await request.patch(`/api/v1/superadmin/formula-sets/${createdSetId}`, {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { version: 2 },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { formulaSet: Record<string, unknown> };
  expect(body.formulaSet.id).toBe(createdSetId);
  expect(body.formulaSet.version).toBe(2); // patched to 2
  expect(body.formulaSet.name).toBe(TEST_SET_NAME); // unchanged
});

// ─── T9: Patch locked set → 409 + inUseBy ────────────────────────────────────

test("T9: PATCH locked set (org's activeFormulaSetId) → 409 + inUseBy", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  // Find the seeded formula set assigned to the cloisons org (always in use, locked).
  const activeSetId = await readOrgActiveFormulaSet("cloisons");
  if (!activeSetId) {
    console.warn("T9: cloisons org has no activeFormulaSetId — skipping lock test");
    test.skip();
    return;
  }

  // Attempting to edit a locked set must return 409 with inUseBy.
  const res = await request.patch(`/api/v1/superadmin/formula-sets/${activeSetId}`, {
    headers: { Cookie: `qs-sa-token=${saToken}` },
    data: { version: 999 },
  });
  expect(res.status()).toBe(409);
  const body = (await res.json()) as {
    error: string;
    inUseBy: { orgCount: number; projectCount: number; calculationCount: number };
  };
  expect(body.error).toContain("in use");
  expect(body.inUseBy).toBeTruthy();
  expect(body.inUseBy.orgCount).toBeGreaterThan(0); // cloisons org is assigned to it
});

// ─── T10: New version ─────────────────────────────────────────────────────────

test("T10: POST /formula-sets/[setId]/version → 201, version=N+1", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  // After T8 patched createdSetId to version=2, new version should be 3.
  const res = await request.post(`/api/v1/superadmin/formula-sets/${createdSetId}/version`, {
    headers: { Cookie: `qs-sa-token=${saToken}` },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { formulaSet: Record<string, unknown> };
  expect(body.formulaSet.name).toBe(TEST_SET_NAME);
  expect(body.formulaSet.version).toBe(3); // max was 2 after T8, so new = 3
  expect(body.formulaSet.locked).toBe(false); // new row, not in use
});

// ─── T11: Get nonexistent → 404 ──────────────────────────────────────────────

test("T11: GET /formula-sets/nonexistent-id → 404", async ({ request }) => {
  if (!hasBootstrapCreds) {
    test.skip();
    return;
  }

  const res = await request.get(
    "/api/v1/superadmin/formula-sets/00000000-0000-0000-0000-000000000000",
    { headers: { Cookie: `qs-sa-token=${saToken}` } },
  );
  expect(res.status()).toBe(404);
});
