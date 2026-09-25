/**
 * E2E coverage for hotfix-2026-09-25 (H-1, H-2, H-3, H-5, H-6).
 *
 * Tests added per review-1.md MINOR-3: new API routes and DAL paths from
 * deleteFormulaSet, resetProject, and updateUserInOrg have no prior coverage.
 *
 * Verification strategy:
 *   All tests hit the API directly via Playwright's `request` context — no
 *   browser navigation except where noted. Set PLAYWRIGHT_BASE_URL to the
 *   hotfix branch's Vercel preview URL.
 *
 * Test Org (CLAUDE.md rule 9):
 *   Slug `e2e-testorg`. Created in beforeAll if it doesn't already exist in
 *   the dev DB. A single persistent org — not re-created per run.
 *
 * SuperAdmin creds:
 *   devadmin / SUPERADMIN_DEVADMIN_PASSWORD
 *   (pulled via `vercel env pull --environment=development`, never committed)
 *
 * FLAG-SA: All tests requiring a SuperAdmin session skip when
 *          TEST_SA_USERNAME / TEST_SA_PASSWORD are absent.
 *
 * Data hygiene:
 *   - Formula sets created here use the `e2e-hf25-<ts>` name prefix and are
 *     deleted in afterAll (SA DELETE). Any set still in use after cleanup
 *     is listed in the report — requires manual removal.
 *   - Projects use the same prefix and are deleted in afterAll.
 *   - Test users: no DELETE endpoint exists for users; test users are
 *     deactivated in afterAll (PATCH active=false) and their username is
 *     prefixed `e2e-hf25-` for identification. Flagged in the test report.
 *   - e2e-testorg.activeFormulaSetId is reverted to its original value in
 *     a try/finally inside the H-1 in-use test.
 *
 * H-6 (UI wizard pills): BLOCKED on this ad-hoc branch preview — the
 *   BETTER_AUTH_URL/cross-subdomain cookie bug prevents browser login on
 *   *.vercel.app preview URLs (see AGENTS.md). Skipped with explanation.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=devadmin TEST_SA_PASSWORD=<val> \
 *   npx playwright test hotfix-2026-09-25 --workers=1
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn, getSeededFormulaSetId } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// ── Environment probes ───────────────────────────────────────────────────────

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

/**
 * Persistent test org slug (CLAUDE.md rule 9 — single Test Org, created if missing).
 * Password is fixed so any run can sign in as admin regardless of when the org was created.
 */
const TEST_ORG_SLUG = "e2e-testorg";
const TEST_ORG_ADMIN_PASSWORD = "TestE2E1234!";

const RUN = Date.now();
const PREFIX = `e2e-hf25-${RUN}`;

// ── Shared state ─────────────────────────────────────────────────────────────

let saToken = "";
let testOrgCtx: BrowserContext;
let testOrgPage: Page;
let testOrgId = "";
let testOrgRoleId = "";
let testOrgOriginalFormulaSetId = "";

/** Formula sets created here — deleted in afterAll. */
const formulaSetsToDelete: string[] = [];
/** Projects created here — deleted in afterAll. */
const projectsToDelete: string[] = [];
/** User IDs created here — deactivated in afterAll (no delete route). */
const usersToDeactivate: string[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsSuperAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) {
    throw new Error(`SA login failed: HTTP ${res.status()}: ${await res.text()}`);
  }
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token not found in login response");
  return match[1];
}

function saHeaders() {
  return { Cookie: `qs-sa-token=${saToken}` };
}

/** Org-scoped API URL shorthand for the Test Org. */
const A = (path: string) => apiUrl(TEST_ORG_SLUG, `/api/v1/orgs/${TEST_ORG_SLUG}${path}`);

/** Minimal valid FormulaSet body. */
const VALID_FS_BODY = { slots: { GLASS: { role: "glass" } } };

// ── beforeAll ─────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser, request }) => {
  if (!hasBootstrapCreds) return;

  // ── SA login ──────────────────────────────────────────────────────────────
  saToken = await loginAsSuperAdmin(request);

  // ── Ensure Test Org exists (create if missing — CLAUDE.md rule 9) ─────────
  const orgsRes = await request.get("/api/v1/superadmin/orgs", { headers: saHeaders() });
  expect(orgsRes.status(), "SA orgs list").toBe(200);
  const orgsBody = (await orgsRes.json()) as {
    orgs: Array<{ id: string; slug: string; activeFormulaSetId?: string | null }>;
  };
  let testOrg = orgsBody.orgs.find((o) => o.slug === TEST_ORG_SLUG);

  if (!testOrg) {
    // Create the persistent Test Org.
    // Use the seeded formula set (glass-partition-standard or any stable one).
    const formulaSetId = await getSeededFormulaSetId(request, saToken);
    const createRes = await request.post("/api/v1/superadmin/orgs", {
      headers: saHeaders(),
      data: {
        name: "E2E Test Org",
        slug: TEST_ORG_SLUG,
        adminPassword: TEST_ORG_ADMIN_PASSWORD,
        formulaSetId,
      },
    });
    expect(createRes.status(), `create test org ${TEST_ORG_SLUG}`).toBe(201);
    // Fetch the newly created org to get its id.
    const afterCreateRes = await request.get("/api/v1/superadmin/orgs", { headers: saHeaders() });
    expect(afterCreateRes.status()).toBe(200);
    const afterBody = (await afterCreateRes.json()) as {
      orgs: Array<{ id: string; slug: string; activeFormulaSetId?: string | null }>;
    };
    testOrg = afterBody.orgs.find((o) => o.slug === TEST_ORG_SLUG);
    expect(testOrg, `${TEST_ORG_SLUG} must exist after creation`).toBeTruthy();
  }

  testOrgId = testOrg!.id;
  testOrgOriginalFormulaSetId = testOrg!.activeFormulaSetId ?? "";

  // ── org-level session for the Test Org ───────────────────────────────────
  testOrgCtx = await browser.newContext();
  testOrgPage = await testOrgCtx.newPage();
  await apiSignIn(testOrgPage, TEST_ORG_SLUG, "admin", TEST_ORG_ADMIN_PASSWORD);

  // ── Get a role from the Test Org for H-5 user-create/patch tests ─────────
  const usersListRes = await request.get(
    `/api/v1/superadmin/orgs/${testOrgId}/users`,
    { headers: saHeaders() },
  );
  expect(usersListRes.status(), "SA users list for Test Org").toBe(200);
  const ul = (await usersListRes.json()) as {
    users: Array<{ id: string; role: { id: string } }>;
  };
  expect(ul.users.length, "Test Org has at least one user (admin, auto-created)").toBeGreaterThan(0);
  testOrgRoleId = ul.users[0].role.id;
});

// ── afterAll ──────────────────────────────────────────────────────────────────

test.afterAll(async ({ request }) => {
  if (!hasBootstrapCreds) return;

  // Delete test formula sets.
  for (const id of formulaSetsToDelete) {
    const r = await request
      .delete(`/api/v1/superadmin/formula-sets/${id}`, { headers: saHeaders() })
      .catch(() => null);
    if (!r || r.status() !== 200) {
      console.warn(`afterAll: could not delete formula set ${id} (may still be in use)`);
    }
  }

  // Deactivate test users (no delete endpoint — user rows persist; flagged in report).
  for (const id of usersToDeactivate) {
    await request
      .patch(`/api/v1/superadmin/orgs/${testOrgId}/users/${id}`, {
        headers: saHeaders(),
        data: { active: false },
      })
      .catch(() => {});
  }

  // Delete test projects.
  for (const id of projectsToDelete) {
    await testOrgPage.request
      .delete(A(`/projects/${id}`))
      .catch(() => {});
  }

  await testOrgCtx?.close();
});

// ─── H-1: DELETE formula set (SuperAdmin) ─────────────────────────────────────

test("H-1-auth: DELETE /superadmin/formula-sets/[setId] without SA cookie → 401", async ({
  request,
}) => {
  const res = await request.delete(
    "/api/v1/superadmin/formula-sets/00000000-0000-0000-0000-000000000000",
  );
  expect(res.status()).toBe(401);
});

test("H-1-happy: create formula set → DELETE → 200 + { id }; then GET → 404", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // Create a fresh, unlocked formula set.
  const createRes = await request.post("/api/v1/superadmin/formula-sets", {
    headers: saHeaders(),
    data: { name: `${PREFIX}-h1del`, body: VALID_FS_BODY },
  });
  expect(createRes.status(), "create formula set").toBe(201);
  const created = (await createRes.json()) as { formulaSet: { id: string } };
  const setId = created.formulaSet.id;
  // Not registered in formulaSetsToDelete — this test deletes it inline.

  // DELETE → 200.
  const delRes = await request.delete(`/api/v1/superadmin/formula-sets/${setId}`, {
    headers: saHeaders(),
  });
  expect(delRes.status(), `DELETE formula-set ${setId}`).toBe(200);
  expect(((await delRes.json()) as { id: string }).id).toBe(setId);

  // GET → 404 (no longer exists).
  const getRes = await request.get(`/api/v1/superadmin/formula-sets/${setId}`, {
    headers: saHeaders(),
  });
  expect(getRes.status(), "GET deleted formula set → 404").toBe(404);
});

test("H-1-inuse: set assigned to Test Org → DELETE → 409 + inUseBy; set still accessible after", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // Create a fresh formula set.
  const createRes = await request.post("/api/v1/superadmin/formula-sets", {
    headers: saHeaders(),
    data: { name: `${PREFIX}-h1inuse`, body: VALID_FS_BODY },
  });
  expect(createRes.status(), "create formula set for in-use test").toBe(201);
  const created = (await createRes.json()) as { formulaSet: { id: string } };
  const setId = created.formulaSet.id;
  formulaSetsToDelete.push(setId); // register so afterAll can clean up

  // Assign it to the Test Org, reverting in all exit paths.
  try {
    const assignRes = await request.patch(`/api/v1/superadmin/orgs/${testOrgId}`, {
      headers: saHeaders(),
      data: { formulaSetId: setId },
    });
    expect(assignRes.status(), `assign formula set ${setId} to Test Org`).toBe(200);

    // Now the set is in use by Test Org → DELETE must return 409.
    const delRes = await request.delete(`/api/v1/superadmin/formula-sets/${setId}`, {
      headers: saHeaders(),
    });
    expect(delRes.status(), "DELETE in-use formula set → 409").toBe(409);
    const body = (await delRes.json()) as {
      error: string;
      inUseBy: { orgCount: number };
    };
    expect(body.error).toMatch(/in use/i);
    expect(body.inUseBy.orgCount, "orgCount ≥ 1").toBeGreaterThan(0);

    // The set must still be accessible (was NOT deleted).
    const getRes = await request.get(`/api/v1/superadmin/formula-sets/${setId}`, {
      headers: saHeaders(),
    });
    expect(getRes.status(), "in-use set still exists after failed DELETE").toBe(200);
  } finally {
    // Revert Test Org to its original formula set — global state, must be restored.
    if (testOrgOriginalFormulaSetId) {
      const revertRes = await request
        .patch(`/api/v1/superadmin/orgs/${testOrgId}`, {
          headers: saHeaders(),
          data: { formulaSetId: testOrgOriginalFormulaSetId },
        })
        .catch((err) => {
          console.error("H-1-inuse: FAILED to revert Test Org formula set — manual cleanup required", err);
          return null;
        });
      if (revertRes && revertRes.status() !== 200) {
        console.error(
          `H-1-inuse: revert returned ${revertRes.status()} — Test Org may still point at ${setId}`,
        );
      }
    }
  }
  // After revert, setId is no longer assigned to any org — afterAll can delete it.
});

// ─── H-2: DELETE DRAFT project ───────────────────────────────────────────────

test("H-2-happy: create DRAFT project → DELETE → 200 → GET → 404", async () => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const createRes = await testOrgPage.request.post(A("/projects"), {
    data: { name: `${PREFIX}-h2del`, currency: "AED" },
  });
  expect(createRes.status(), "create project for H-2 delete test").toBe(201);
  const projectId = ((await createRes.json()) as { project: { id: string } }).project.id;
  // Not registered in projectsToDelete — deleted inline.

  // DELETE → 200.
  const delRes = await testOrgPage.request.delete(A(`/projects/${projectId}`));
  expect(delRes.status(), "DELETE project → 200").toBe(200);

  // GET → 404.
  const getRes = await testOrgPage.request.get(A(`/projects/${projectId}`));
  expect(getRes.status(), "GET deleted project → 404").toBe(404);
});

// ─── H-3: Reset DRAFT project ─────────────────────────────────────────────────

test("H-3-unauth: POST reset without auth → 401", async ({ request }) => {
  // 401 happens before any DB lookup, so a fake project ID is fine.
  const res = await request.post(
    apiUrl(
      TEST_ORG_SLUG,
      `/api/v1/orgs/${TEST_ORG_SLUG}/projects/00000000-0000-0000-0000-000000000000/reset`,
    ),
  );
  expect(res.status()).toBe(401);
});

test("H-3-notfound: POST reset on non-existent project → 404", async () => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const res = await testOrgPage.request.post(
    A("/projects/00000000-0000-0000-0000-000000000099/reset"),
  );
  expect(res.status(), "reset non-existent project → 404").toBe(404);
});

test("H-3-happy: project + floor + selection → reset → 200; state cleared, project preserved, designSubmittedAt null", async () => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // ── Create DRAFT project ─────────────────────────────────────────────────
  const createRes = await testOrgPage.request.post(A("/projects"), {
    data: { name: `${PREFIX}-h3reset`, currency: "AED" },
  });
  expect(createRes.status(), "create project for H-3 test").toBe(201);
  const proj = (await createRes.json()) as { project: { id: string; name: string } };
  const projectId = proj.project.id;
  const projectName = proj.project.name;
  projectsToDelete.push(projectId);

  // ── Add a Floor ──────────────────────────────────────────────────────────
  const floorRes = await testOrgPage.request.post(A("/floors"), {
    data: { projectId, label: `${PREFIX}-floor` },
  });
  expect(floorRes.status(), "create floor").toBe(201);

  // ── Add a Selection (needs a GLASS component type from Test Org) ─────────
  const typesRes = await testOrgPage.request.get(A("/component-types"));
  expect(typesRes.status(), "get component-types").toBe(200);
  const typesBody = (await typesRes.json()) as {
    componentTypes: Array<{ id: string; code: string }>;
  };
  const glassType = typesBody.componentTypes.find((t) => t.code === "GLASS");

  if (glassType) {
    // Test Org has a GLASS type — add a selection.
    const selRes = await testOrgPage.request.post(A("/selections"), {
      data: {
        projectId,
        componentTypeId: glassType.id,
        label: `${PREFIX}-sel`,
        config: {},
        orderIndex: 0,
      },
    });
    expect(selRes.status(), "create selection").toBe(201);
  } else {
    console.warn("H-3: Test Org has no GLASS ComponentType — skipping selection creation (floor-only reset test)");
  }

  // ── Confirm state before reset ───────────────────────────────────────────
  const floorsBeforeRes = await testOrgPage.request.get(A(`/floors?projectId=${projectId}`));
  expect(floorsBeforeRes.status()).toBe(200);
  const floorsBefore = (await floorsBeforeRes.json()) as { floors: unknown[] };
  expect(floorsBefore.floors.length, "floors before reset ≥ 1").toBeGreaterThan(0);

  // ── POST reset ───────────────────────────────────────────────────────────
  const resetRes = await testOrgPage.request.post(A(`/projects/${projectId}/reset`));
  expect(resetRes.status(), "POST reset → 200").toBe(200);
  expect(((await resetRes.json()) as { id: string }).id).toBe(projectId);

  // ── Floors must be empty after reset ─────────────────────────────────────
  const floorsAfterRes = await testOrgPage.request.get(A(`/floors?projectId=${projectId}`));
  expect(floorsAfterRes.status()).toBe(200);
  const floorsAfter = (await floorsAfterRes.json()) as { floors: unknown[] };
  expect(floorsAfter.floors.length, "floors after reset = 0").toBe(0);

  // ── Selections must be empty after reset ─────────────────────────────────
  const selsAfterRes = await testOrgPage.request.get(A(`/selections?projectId=${projectId}`));
  expect(selsAfterRes.status()).toBe(200);
  const selsAfter = (await selsAfterRes.json()) as { selections: unknown[] };
  expect(selsAfter.selections.length, "selections after reset = 0").toBe(0);

  // ── Project still exists with same name ──────────────────────────────────
  const projAfterRes = await testOrgPage.request.get(A(`/projects/${projectId}`));
  expect(projAfterRes.status(), "project still exists after reset").toBe(200);
  const projAfter = (await projAfterRes.json()) as {
    project: { id: string; name: string; designSubmittedAt: string | null };
  };
  expect(projAfter.project.id).toBe(projectId);
  expect(projAfter.project.name).toBe(projectName);
  expect(projAfter.project.designSubmittedAt, "designSubmittedAt cleared by reset").toBeNull();
});

// ─── H-5: SuperAdmin user PATCH ───────────────────────────────────────────────

test("H-5-unauth: PATCH user without SA cookie → 401", async ({ request }) => {
  const res = await request.patch(
    `/api/v1/superadmin/orgs/00000000-0000-0000-0000-000000000000/users/00000000-0000-0000-0000-000000000000`,
    { data: { firstName: "Test" } },
  );
  expect(res.status()).toBe(401);
});

test("H-5-username: username in PATCH body → 400", async ({ request }) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const res = await request.patch(
    `/api/v1/superadmin/orgs/${testOrgId}/users/00000000-0000-0000-0000-000000000000`,
    {
      headers: saHeaders(),
      data: { username: "new-username-attempt" },
    },
  );
  expect(res.status(), "username in PATCH body → 400").toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/username/i);
});

test("H-5-crossorg-role: PATCH user with non-existent roleId → 400", async ({ request }) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // Create a temporary user so we have a real userId in the Test Org.
  const username = `${PREFIX}-h5role`.slice(0, 40).replace(/[^a-z0-9-]/g, "-");
  const createRes = await request.post(`/api/v1/superadmin/orgs/${testOrgId}/users`, {
    headers: saHeaders(),
    data: {
      firstName: "E2E",
      lastName: "RoleCheck",
      username,
      roleId: testOrgRoleId,
      password: "TestPass1234!",
    },
  });
  expect(createRes.status(), "create user for cross-org-role test").toBe(201);
  const userId = ((await createRes.json()) as { user: { id: string } }).user.id;
  usersToDeactivate.push(userId);

  // A fake roleId that does not belong to the Test Org → 400.
  const patchRes = await request.patch(
    `/api/v1/superadmin/orgs/${testOrgId}/users/${userId}`,
    {
      headers: saHeaders(),
      data: { roleId: "00000000-0000-0000-0000-000000000099" },
    },
  );
  expect(patchRes.status(), "PATCH with non-existent roleId → 400").toBe(400);
});

test("H-5-happy: create user → PATCH firstName + active → 200; GET users reflects change", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const username = `${PREFIX}-h5edit`.slice(0, 40).replace(/[^a-z0-9-]/g, "-");

  // Create a test user in the Test Org.
  const createRes = await request.post(`/api/v1/superadmin/orgs/${testOrgId}/users`, {
    headers: saHeaders(),
    data: {
      firstName: "E2E",
      lastName: "Hotfix",
      username,
      roleId: testOrgRoleId,
      password: "TestPass1234!",
    },
  });
  expect(createRes.status(), "create test user for H-5").toBe(201);
  const created = (await createRes.json()) as { user: { id: string } };
  const userId = created.user.id;
  usersToDeactivate.push(userId);

  // PATCH: update firstName and deactivate.
  const patchRes = await request.patch(
    `/api/v1/superadmin/orgs/${testOrgId}/users/${userId}`,
    {
      headers: saHeaders(),
      data: { firstName: "Updated", active: false },
    },
  );
  expect(patchRes.status(), "PATCH user → 200").toBe(200);
  const patchBody = (await patchRes.json()) as {
    user: { id: string };
    changedFields: string[];
  };
  expect(patchBody.user.id).toBe(userId);
  expect(patchBody.changedFields).toContain("firstName");
  expect(patchBody.changedFields).toContain("active");
  expect(patchBody.changedFields, "username must not appear in changedFields").not.toContain("username");

  // GET users and verify the change is reflected.
  const listRes = await request.get(`/api/v1/superadmin/orgs/${testOrgId}/users`, {
    headers: saHeaders(),
  });
  expect(listRes.status(), "GET users after PATCH").toBe(200);
  const listBody = (await listRes.json()) as {
    users: Array<{ id: string; firstName: string; active: boolean }>;
  };
  const updated = listBody.users.find((u) => u.id === userId);
  expect(updated, "updated user present in users list").toBeTruthy();
  expect(updated!.firstName, "firstName updated").toBe("Updated");
  expect(updated!.active, "user deactivated").toBe(false);
});

// ─── H-6: Wizard pills UI (BLOCKED on ad-hoc preview) ────────────────────────

test("H-6-wizard-pills-ui: BLOCKED — cookie bug on ad-hoc branch preview", async ({
  page,
}) => {
  // BLOCKED: browser sign-in fails on ad-hoc *.vercel.app previews because
  // BETTER_AUTH_URL is set to test.easeetool.com. The Set-Cookie Domain
  // attribute (.easeetool.com) doesn't match the preview host (.vercel.app)
  // so the browser silently drops the session cookie (RFC 6265 §5.3).
  // This is the known structural bug documented in AGENTS.md — do not re-diagnose.
  //
  // What this test WOULD assert (on test.easeetool.com post-merge):
  //   1. Visit a project that has at least one Selection created (wizard step 2 unlocked).
  //   2. Navigate to the Design page (wizard step 3).
  //   3. The Configuration pill (step 2) shows light green + ✓ (was previously
  //      only green when step 2 was BEFORE the current step; H-6 makes it green
  //      for ANY unlocked, non-current step).
  //   4. The Design pill (step 3, current) shows primary/active.
  //   5. The Summary and Quotation pills (steps 4–5, locked) remain muted.
  //
  // This test is intentionally skipped and documented here so the assertion
  // is tracked as pending coverage, not silently omitted.
  test.skip(
    true,
    "BLOCKED: BETTER_AUTH_URL cross-subdomain cookie bug prevents browser login on ad-hoc *.vercel.app preview (AGENTS.md). Run on test.easeetool.com after merge to staging.",
  );
  void page;
});
