/**
 * Stage 15 Batch G — User Management regression spec.
 *
 * Covers behavior-level invariants for U3 and U4.
 * UI structure, layout, and copy are NOT asserted (wireframe stage).
 *
 * U3 — External Company conditional on role (isInternalRole flag):
 *   - External role (Distributor) + no company → server rejects with 400
 *   - External role (Distributor) + company → server accepts (201)
 *   - Internal role (Admin) + no company → server accepts (201)
 *
 * U4 — Profile endpoint behavior:
 *   - RBAC gate: user without MANAGE_USERS gets 403 on PUT /profile
 *   - Tenancy: userId from another org returns 404 (not 200)
 *   - Data correctness: after a valid PUT, the GET response reflects the changes
 *
 * See also: admin-stage4.spec.ts for the existing CRUD coverage.
 * Do NOT duplicate tests from that file here.
 */

import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// Rate-limit pacing: better-auth limits sign-in to 3 per 10 seconds per IP.
test.beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 7_000));
});

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the first role matching `name` from GET /api/v1/orgs/acme-glass/roles.
 * Returns { id, name, isInternalRole }.
 */
async function getRoleByName(
  page: import("@playwright/test").Page,
  name: string,
): Promise<{ id: string; name: string; isInternalRole: boolean }> {
  const resp = await page.request.get("/api/v1/orgs/acme-glass/roles");
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as {
    roles: Array<{ id: string; name: string; isInternalRole: boolean }>;
  };
  const role = body.roles.find((r) => r.name === name);
  if (!role) throw new Error(`Role "${name}" not found in org acme-glass`);
  return role;
}

/**
 * Fetch the first external company from GET /api/v1/orgs/acme-glass/external-companies.
 */
async function getFirstExternalCompany(
  page: import("@playwright/test").Page,
): Promise<{ id: string; name: string }> {
  const resp = await page.request.get("/api/v1/orgs/acme-glass/external-companies");
  expect(resp.status()).toBe(200);
  const body = (await resp.json()) as { companies: Array<{ id: string; name: string }> };
  if (!body.companies.length) throw new Error("No external companies in org acme-glass");
  return body.companies[0];
}

/**
 * Create a test user via POST /api/v1/orgs/acme-glass/users.
 * Returns the created username string, or null on expected failure.
 */
async function createTestUser(
  page: import("@playwright/test").Page,
  opts: {
    username: string;
    roleId: string;
    externalCompanyId?: string | null;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await page.request.post("/api/v1/orgs/acme-glass/users", {
    data: {
      username: opts.username,
      firstName: "E2E",
      lastName: "Test",
      password: "TestPass1!",
      roleId: opts.roleId,
      externalCompanyId: opts.externalCompanyId ?? null,
    },
  });
  const body = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status(), body };
}

/**
 * Delete a test user by username (cleanup helper).
 * Uses the users list to find the id, then DELETE /api/v1/orgs/acme-glass/users/[id].
 */
async function deleteUserByUsername(
  page: import("@playwright/test").Page,
  username: string,
): Promise<void> {
  const listResp = await page.request.get("/api/v1/orgs/acme-glass/users");
  if (!listResp.ok()) return;
  const body = (await listResp.json()) as {
    users: Array<{ id: string; username: string }>;
  };
  const user = body.users.find((u) => u.username === username);
  if (!user) return;
  await page.request.delete(`/api/v1/orgs/acme-glass/users/${user.id}`);
}

// ---------------------------------------------------------------------------
// U3: External Company conditional on role
// ---------------------------------------------------------------------------

test.describe("U3 — External Company required for external roles", () => {
  test("external role (Distributor) with no company is rejected 400", async ({ page }) => {
    await signIn(page, "admin");

    const distributorRole = await getRoleByName(page, "Distributor");
    expect(distributorRole.isInternalRole).toBe(false);

    const result = await createTestUser(page, {
      username: `e2e_u3_ext_${Date.now()}`,
      roleId: distributorRole.id,
      externalCompanyId: null,
    });
    expect(result.status).toBe(400);
  });

  test("external role (Distributor) with a company is accepted 201", async ({ page }) => {
    await signIn(page, "admin");

    const distributorRole = await getRoleByName(page, "Distributor");
    const company = await getFirstExternalCompany(page);

    const username = `e2e_u3_ext_ok_${Date.now()}`;
    const result = await createTestUser(page, {
      username,
      roleId: distributorRole.id,
      externalCompanyId: company.id,
    });
    expect(result.status).toBe(201);

    // Cleanup
    await deleteUserByUsername(page, username);
  });

  test("internal role (Admin) with no company is accepted 201", async ({ page }) => {
    await signIn(page, "admin");

    const adminRole = await getRoleByName(page, "Admin");
    expect(adminRole.isInternalRole).toBe(true);

    const username = `e2e_u3_int_${Date.now()}`;
    const result = await createTestUser(page, {
      username,
      roleId: adminRole.id,
      externalCompanyId: null,
    });
    expect(result.status).toBe(201);

    // Cleanup
    await deleteUserByUsername(page, username);
  });
});

// ---------------------------------------------------------------------------
// U4: Profile endpoint — RBAC, tenancy, data correctness
// ---------------------------------------------------------------------------

test.describe("U4 — Profile endpoint behavior", () => {
  test("PUT /profile returns 403 for a user without MANAGE_USERS", async ({ page }) => {
    // Sign in as a Distributor (no MANAGE_USERS) and attempt to update a user's profile.
    // The request will fail because: (a) the distributor can't find any userId without
    // the user list permission, but more fundamentally (b) the endpoint requires MANAGE_USERS.
    // We directly call the API — we just need any userId placeholder; the RBAC check fires first.
    await signIn(page, "distributor");

    // Use any plausible UUID; RBAC check fires before tenancy/existence check.
    const resp = await page.request.put(
      "/api/v1/orgs/acme-glass/users/00000000-0000-0000-0000-000000000001/profile",
      { data: { firstName: "Should", lastName: "Fail" } },
    );
    expect(resp.status()).toBe(403);
  });

  test("PUT /profile for a userId from another org returns 404", async ({ page }) => {
    // Signed in as admin of acme-glass; attempt to update a user in nordic-walls.
    // The route handler's getApiSession enforces the orgSlug — so the URL already
    // restricts to acme-glass. But we test with a valid acme-glass session
    // against a userId that doesn't exist in acme-glass (cross-org ID).
    //
    // Strategy: get a userId from nordic-walls by signing in there first,
    // then switch session to acme-glass and attempt the update.
    await signIn(page, "admin", "Seed1234!", "nordic-walls");
    const nordListResp = await page.request.get("/api/v1/orgs/nordic-walls/users");
    expect(nordListResp.ok()).toBe(true);
    const nordBody = (await nordListResp.json()) as {
      users: Array<{ id: string; username: string }>;
    };
    const nordAdmin = nordBody.users.find((u) => u.username === "admin");
    if (!nordAdmin) {
      test.skip(); // seed user not found — skip rather than fail
      return;
    }

    // Now switch to acme-glass session.
    await signIn(page, "admin", "Seed1234!", "acme-glass");

    const resp = await page.request.put(
      `/api/v1/orgs/acme-glass/users/${nordAdmin.id}/profile`,
      { data: { firstName: "Cross", lastName: "OrgAttack" } },
    );
    // userId exists in nordic-walls but NOT in acme-glass → 404
    expect(resp.status()).toBe(404);
  });

  test("PUT /profile updates the user's first and last name", async ({ page }) => {
    // Create a temp user, update their profile, verify the change is visible in GET.
    await signIn(page, "admin");

    const adminRole = await getRoleByName(page, "Admin");
    const username = `e2e_u4_prof_${Date.now()}`;
    const createResult = await createTestUser(page, {
      username,
      roleId: adminRole.id,
    });
    expect(createResult.status).toBe(201);

    // Get the new user's id.
    const listResp = await page.request.get("/api/v1/orgs/acme-glass/users");
    const listBody = (await listResp.json()) as {
      users: Array<{ id: string; username: string }>;
    };
    const newUser = listBody.users.find((u) => u.username === username);
    expect(newUser).toBeTruthy();
    if (!newUser) return;

    // Update the profile.
    const updateResp = await page.request.put(
      `/api/v1/orgs/acme-glass/users/${newUser.id}/profile`,
      { data: { firstName: "Updated", lastName: "Name" } },
    );
    expect(updateResp.status()).toBe(200);

    // Verify the change.
    const getResp = await page.request.get(
      `/api/v1/orgs/acme-glass/users/${newUser.id}`,
    );
    expect(getResp.status()).toBe(200);
    const getBody = (await getResp.json()) as {
      user: { firstName: string; lastName: string };
    };
    expect(getBody.user.firstName).toBe("Updated");
    expect(getBody.user.lastName).toBe("Name");

    // Cleanup.
    await deleteUserByUsername(page, username);
  });
});
