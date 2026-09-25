/**
 * E2E coverage for hotfix-2026-09-25 (H-1, H-2, H-3, H-5, H-6).
 *
 * Tests added per review-1.md MINOR-3: new API routes and DAL paths from
 * deleteFormulaSet, resetProject, and updateUserInOrg have no prior coverage.
 *
 * Verification strategy:
 *   All tests hit the API directly via Playwright's `request` context — no
 *   browser navigation except where explicitly noted.  Set PLAYWRIGHT_BASE_URL to
 *   the hotfix branch's Vercel preview URL.
 *
 * Test Org: acme-glass (the single shared test org per CLAUDE.md rule 9).
 * SuperAdmin creds: devadmin / SUPERADMIN_DEVADMIN_PASSWORD (from
 *   `vercel env pull --environment=development`, never committed).
 *
 * FLAG-SA: All SA tests skip when TEST_SA_USERNAME / TEST_SA_PASSWORD are absent.
 *
 * Data hygiene:
 *   - Formula sets created here use the `e2e-hf25-<ts>` name prefix and are
 *     deleted in afterAll (SA DELETE or marked as unable to delete if cleanup
 *     fails — see afterAll).
 *   - Projects use the same prefix and are deleted in afterAll.
 *   - Test users: the `POST /api/v1/superadmin/orgs/[orgId]/users` endpoint has
 *     no matching DELETE; test users are deactivated (PATCH active=false) and
 *     their username is prefixed `e2e-hf25-` so they can be identified.
 *     This is flagged in the test report as a cleanup gap.
 *   - acme-glass's activeFormulaSetId is reverted to its original value in a
 *     try/finally inside the H-1 in-use test.
 *
 * H-6 (UI wizard pills): BLOCKED on this ad-hoc branch preview — the
 *   BETTER_AUTH_URL / cross-subdomain cookie bug prevents browser login on
 *   *.vercel.app preview URLs (see AGENTS.md). Marked with a test.skip.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://quotation-system-<hash>-vistra-indias-projects.vercel.app \
 *   TEST_SA_USERNAME=devadmin TEST_SA_PASSWORD=<val> \
 *   npx playwright test hotfix-2026-09-25 --workers=1
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, apiSignIn } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

// ── Environment probes ───────────────────────────────────────────────────────

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasBootstrapCreds = Boolean(SA_USERNAME && SA_PASSWORD);

const TEST_ORG = "acme-glass";
const RUN = Date.now();
const PREFIX = `e2e-hf25-${RUN}`;

// ── Shared state ─────────────────────────────────────────────────────────────

let saToken = "";
let acmeCtx: BrowserContext;
let acmePage: Page;
let acmeOrgId = "";
let acmeRoleId = "";
let acmeOriginalFormulaSetId = "";

/** Formula sets created during H-1 tests — deleted in afterAll. */
const formulaSetsToDelete: string[] = [];

/** Projects created during H-2/H-3 tests — deleted in afterAll. */
const projectsToDelete: string[] = [];

/** User IDs created during H-5 tests — deactivated in afterAll (no delete route). */
const usersToDeactivate: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAsSuperAdmin(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const res = await request.post("/api/v1/superadmin/login", {
    data: { username: SA_USERNAME, password: SA_PASSWORD },
  });
  if (res.status() !== 200) {
    throw new Error(`SuperAdmin login failed: HTTP ${res.status()}: ${await res.text()}`);
  }
  const setCookie = res.headers()["set-cookie"] ?? "";
  const match = setCookie.match(/qs-sa-token=([^;]+)/);
  if (!match) throw new Error("qs-sa-token cookie not found in login response");
  return match[1];
}

/** Convenience wrapper — SA request with cookie attached. */
function saHeaders() {
  return { Cookie: `qs-sa-token=${saToken}` };
}

/** Org-scoped API URL helper shorthand. */
const A = (path: string) => apiUrl(TEST_ORG, `/api/v1/orgs/${TEST_ORG}${path}`);

/** Minimal valid FormulaSet body. */
const VALID_FS_BODY = { slots: { GLASS: { role: "glass" } } };

// ── beforeAll / afterAll ──────────────────────────────────────────────────────

test.beforeAll(async ({ browser, request }) => {
  if (!hasBootstrapCreds) return;

  // SA login.
  saToken = await loginAsSuperAdmin(request);

  // acme-glass org session (API-level, bypasses the BETTER_AUTH_URL cookie bug).
  acmeCtx = await browser.newContext();
  acmePage = await acmeCtx.newPage();
  await apiSignIn(acmePage, TEST_ORG, "admin");

  // Get acme-glass orgId from the SA orgs list.
  const orgsRes = await request.get("/api/v1/superadmin/orgs", { headers: saHeaders() });
  expect(orgsRes.status(), "SA orgs list").toBe(200);
  const orgsBody = (await orgsRes.json()) as { orgs: Array<{ id: string; slug: string }> };
  const acmeOrg = orgsBody.orgs.find((o) => o.slug === TEST_ORG);
  expect(acmeOrg, `${TEST_ORG} org must exist in dev DB`).toBeTruthy();
  acmeOrgId = acmeOrg!.id;

  // Get the current activeFormulaSetId for acme-glass so we can revert it if H-1 changes it.
  const orgDetailRes = await request.get(`/api/v1/superadmin/orgs/${acmeOrgId}`, {
    headers: saHeaders(),
  });
  // The SA GET /orgs/[orgId] endpoint returns org + mismatch warnings (Stage 25 Batch 5).
  if (orgDetailRes.status() === 200) {
    const od = (await orgDetailRes.json()) as {
      org?: { activeFormulaSetId?: string | null };
    };
    acmeOriginalFormulaSetId = od.org?.activeFormulaSetId ?? "";
  }

  // Get a role from acme-glass (needed for H-5 create-user and PATCH tests).
  // SA users GET returns users with their roles; we can also fetch via the org users list.
  const usersListRes = await request.get(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users`,
    { headers: saHeaders() },
  );
  expect(usersListRes.status(), "SA users list for acme-glass").toBe(200);
  const ul = (await usersListRes.json()) as {
    users: Array<{ id: string; role: { id: string } }>;
  };
  expect(ul.users.length, "acme-glass has at least one user").toBeGreaterThan(0);
  acmeRoleId = ul.users[0].role.id;
});

test.afterAll(async ({ request }) => {
  if (!hasBootstrapCreds) return;

  // Delete test formula sets.
  for (const id of formulaSetsToDelete) {
    await request
      .delete(`/api/v1/superadmin/formula-sets/${id}`, { headers: saHeaders() })
      .catch(() => {});
  }

  // Deactivate test users (no delete endpoint — flagged in test report).
  for (const id of usersToDeactivate) {
    await request
      .patch(`/api/v1/superadmin/orgs/${acmeOrgId}/users/${id}`, {
        headers: saHeaders(),
        data: { active: false },
      })
      .catch(() => {});
  }

  // Delete test projects.
  for (const id of projectsToDelete) {
    await acmePage.request
      .delete(A(`/projects/${id}`))
      .catch(() => {});
  }

  await acmeCtx?.close();
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

test("H-1-happy: create formula set → DELETE → 200, { id }; then GET → 404", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // Create a fresh formula set.
  const createRes = await request.post("/api/v1/superadmin/formula-sets", {
    headers: saHeaders(),
    data: { name: `${PREFIX}-h1del`, body: VALID_FS_BODY },
  });
  expect(createRes.status(), "create formula set").toBe(201);
  const created = (await createRes.json()) as { formulaSet: { id: string } };
  const setId = created.formulaSet.id;
  // Don't push to formulaSetsToDelete — we're deleting it in this test.

  // DELETE → 200 with the id.
  const delRes = await request.delete(`/api/v1/superadmin/formula-sets/${setId}`, {
    headers: saHeaders(),
  });
  expect(delRes.status(), `DELETE formula-set ${setId}`).toBe(200);
  const delBody = (await delRes.json()) as { id: string };
  expect(delBody.id).toBe(setId);

  // GET → 404 (set no longer exists).
  const getRes = await request.get(`/api/v1/superadmin/formula-sets/${setId}`, {
    headers: saHeaders(),
  });
  expect(getRes.status(), "GET deleted formula set").toBe(404);
});

test("H-1-inuse: formula set assigned to Test Org → DELETE → 409; set still exists after", async ({
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
  formulaSetsToDelete.push(setId); // register for cleanup in case this test fails mid-way

  // Assign it to acme-glass so the set becomes "in use".
  // Revert acme-glass's active formula set to the original value in all exit paths.
  try {
    const assignRes = await request.patch(`/api/v1/superadmin/orgs/${acmeOrgId}`, {
      headers: saHeaders(),
      data: { formulaSetId: setId },
    });
    expect(
      assignRes.status(),
      `assign formula set ${setId} to ${TEST_ORG}`,
    ).toBe(200);

    // Now the set is in use by acme-glass → DELETE must return 409.
    const delRes = await request.delete(`/api/v1/superadmin/formula-sets/${setId}`, {
      headers: saHeaders(),
    });
    expect(delRes.status(), "DELETE in-use formula set → 409").toBe(409);
    const delBody = (await delRes.json()) as {
      error: string;
      inUseBy: { orgCount: number };
    };
    expect(delBody.error).toMatch(/in use/i);
    expect(delBody.inUseBy.orgCount).toBeGreaterThan(0);

    // Confirm GET still returns 200 — the set was NOT deleted.
    const getRes = await request.get(`/api/v1/superadmin/formula-sets/${setId}`, {
      headers: saHeaders(),
    });
    expect(getRes.status(), "in-use set still exists after failed DELETE").toBe(200);
  } finally {
    // Always revert acme-glass to its original formula set (global data — must be restored).
    if (acmeOriginalFormulaSetId) {
      await request
        .patch(`/api/v1/superadmin/orgs/${acmeOrgId}`, {
          headers: saHeaders(),
          data: { formulaSetId: acmeOriginalFormulaSetId },
        })
        .catch((err) => {
          console.error("H-1-inuse: FAILED to revert acme-glass formula set — manual cleanup required", err);
        });
    }
  }
  // At this point the set is no longer assigned to acme-glass, so it can be deleted in afterAll.
});

// ─── H-2: DELETE project (DRAFT) ─────────────────────────────────────────────

test("H-2-happy: create DRAFT project → DELETE → 200 → GET → 404", async () => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // Create a DRAFT project in acme-glass.
  const createRes = await acmePage.request.post(A("/projects"), {
    data: { name: `${PREFIX}-h2del`, currency: "AED" },
  });
  expect(createRes.status(), "create project for H-2 delete test").toBe(201);
  const projectId = ((await createRes.json()) as { project: { id: string } }).project.id;
  // Don't add to projectsToDelete — we delete it in this test.

  // DELETE the project → 200.
  const delRes = await acmePage.request.delete(A(`/projects/${projectId}`));
  expect(delRes.status(), "DELETE project → 200").toBe(200);

  // GET the project → 404 (permanently gone).
  const getRes = await acmePage.request.get(A(`/projects/${projectId}`));
  expect(getRes.status(), "GET deleted project → 404").toBe(404);
});

// ─── H-3: Reset project ────────────────────────────────────────────────────────

test("H-3-unauth: POST reset without auth → 401", async ({ request }) => {
  // Use a fake project ID — the 401 happens before any DB lookup.
  const res = await request.post(
    apiUrl(TEST_ORG, `/api/v1/orgs/${TEST_ORG}/projects/00000000-0000-0000-0000-000000000000/reset`),
  );
  expect(res.status()).toBe(401);
});

test("H-3-notfound: POST reset on non-existent project → 404", async () => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const res = await acmePage.request.post(
    A("/projects/00000000-0000-0000-0000-000000000099/reset"),
  );
  expect(res.status(), "reset non-existent project → 404").toBe(404);
});

test("H-3-happy: create project + floor + selection → reset → 200; floors/selections cleared, project preserved, designSubmittedAt null", async () => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // ── Create a DRAFT project. ──────────────────────────────────────────────
  const createRes = await acmePage.request.post(A("/projects"), {
    data: { name: `${PREFIX}-h3reset`, currency: "AED" },
  });
  expect(createRes.status(), "create project for H-3 test").toBe(201);
  const proj = (await createRes.json()) as { project: { id: string; name: string } };
  const projectId = proj.project.id;
  const projectName = proj.project.name;
  projectsToDelete.push(projectId);

  // ── Add a Floor. ──────────────────────────────────────────────────────────
  const floorRes = await acmePage.request.post(A("/floors"), {
    data: { projectId, label: `${PREFIX}-floor` },
  });
  expect(floorRes.status(), "create floor").toBe(201);

  // ── Add a Selection. ─────────────────────────────────────────────────────
  // Fetch the GLASS component type for acme-glass.
  const typesRes = await acmePage.request.get(A("/component-types"));
  expect(typesRes.status(), "get component-types").toBe(200);
  const typesBody = (await typesRes.json()) as {
    componentTypes: Array<{ id: string; code: string }>;
  };
  const glassType = typesBody.componentTypes.find((t) => t.code === "GLASS");
  expect(glassType, "acme-glass has a GLASS ComponentType").toBeTruthy();

  const selRes = await acmePage.request.post(A("/selections"), {
    data: {
      projectId,
      componentTypeId: glassType!.id,
      label: `${PREFIX}-sel`,
      config: {},
      orderIndex: 0,
    },
  });
  expect(selRes.status(), "create selection").toBe(201);

  // ── Verify project has floors and selections before reset. ──────────────
  const floorsBeforeRes = await acmePage.request.get(A(`/floors?projectId=${projectId}`));
  expect(floorsBeforeRes.status()).toBe(200);
  const floorsBefore = (await floorsBeforeRes.json()) as { floors: unknown[] };
  expect(floorsBefore.floors.length, "floors before reset").toBeGreaterThan(0);

  const selsBeforeRes = await acmePage.request.get(
    A(`/selections?projectId=${projectId}`),
  );
  expect(selsBeforeRes.status()).toBe(200);
  const selsBefore = (await selsBeforeRes.json()) as { selections: unknown[] };
  expect(selsBefore.selections.length, "selections before reset").toBeGreaterThan(0);

  // ── POST reset. ──────────────────────────────────────────────────────────
  const resetRes = await acmePage.request.post(A(`/projects/${projectId}/reset`));
  expect(resetRes.status(), "POST reset → 200").toBe(200);
  const resetBody = (await resetRes.json()) as { id: string };
  expect(resetBody.id).toBe(projectId);

  // ── After reset: floors must be empty. ──────────────────────────────────
  const floorsAfterRes = await acmePage.request.get(A(`/floors?projectId=${projectId}`));
  expect(floorsAfterRes.status()).toBe(200);
  const floorsAfter = (await floorsAfterRes.json()) as { floors: unknown[] };
  expect(floorsAfter.floors.length, "floors after reset should be 0").toBe(0);

  // ── After reset: selections must be empty. ───────────────────────────────
  const selsAfterRes = await acmePage.request.get(
    A(`/selections?projectId=${projectId}`),
  );
  expect(selsAfterRes.status()).toBe(200);
  const selsAfter = (await selsAfterRes.json()) as { selections: unknown[] };
  expect(selsAfter.selections.length, "selections after reset should be 0").toBe(0);

  // ── After reset: project still exists with same name. ───────────────────
  const projAfterRes = await acmePage.request.get(A(`/projects/${projectId}`));
  expect(projAfterRes.status(), "project still exists after reset").toBe(200);
  const projAfter = (await projAfterRes.json()) as {
    project: { id: string; name: string; designSubmittedAt: string | null };
  };
  expect(projAfter.project.id).toBe(projectId);
  expect(projAfter.project.name).toBe(projectName);
  expect(projAfter.project.designSubmittedAt, "designSubmittedAt cleared by reset").toBeNull();
});

// ─── H-5: SuperAdmin user PATCH ────────────────────────────────────────────────

test("H-5-unauth: PATCH user without SA cookie → 401", async ({ request }) => {
  const res = await request.patch(
    `/api/v1/superadmin/orgs/00000000-0000-0000-0000-000000000000/users/00000000-0000-0000-0000-000000000000`,
    { data: { firstName: "Test" } },
  );
  expect(res.status()).toBe(401);
});

test("H-5-username: PATCH user with username in body → 400", async ({ request }) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const res = await request.patch(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users/00000000-0000-0000-0000-000000000000`,
    {
      headers: saHeaders(),
      data: { username: "should-not-be-editable" },
    },
  );
  expect(res.status(), "username in PATCH body → 400").toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/username/i);
});

test("H-5-crossorg-role: PATCH with roleId from non-existent/different org → 400", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  // First create a user to patch (we need a real userId in acme-glass).
  const username = `${PREFIX}-h5roleck`.slice(0, 40).replace(/[^a-z0-9-]/g, "-");
  const createRes = await request.post(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users`,
    {
      headers: saHeaders(),
      data: {
        firstName: "E2E",
        lastName: "RoleCheck",
        username,
        roleId: acmeRoleId,
        password: "TestPass1234!",
      },
    },
  );
  expect(createRes.status(), "create user for cross-org-role test").toBe(201);
  const userId = ((await createRes.json()) as { user: { id: string } }).user.id;
  usersToDeactivate.push(userId);

  // Fake roleId (not in acme-glass) → should return 400.
  const patchRes = await request.patch(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users/${userId}`,
    {
      headers: saHeaders(),
      data: { roleId: "00000000-0000-0000-0000-000000000099" },
    },
  );
  expect(patchRes.status(), "PATCH with cross-org roleId → 400").toBe(400);
});

test("H-5-happy: create user → PATCH firstName + active → 200; GET users reflects change", async ({
  request,
}) => {
  test.skip(!hasBootstrapCreds, "FLAG-SA: TEST_SA_USERNAME/TEST_SA_PASSWORD not set");

  const username = `${PREFIX}-h5edit`.slice(0, 40).replace(/[^a-z0-9-]/g, "-");

  // Create a test user in acme-glass.
  const createRes = await request.post(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users`,
    {
      headers: saHeaders(),
      data: {
        firstName: "E2E",
        lastName: "Hotfix",
        username,
        roleId: acmeRoleId,
        password: "TestPass1234!",
      },
    },
  );
  expect(createRes.status(), "create test user for H-5").toBe(201);
  const created = (await createRes.json()) as { user: { id: string; username: string } };
  const userId = created.user.id;
  usersToDeactivate.push(userId); // register for cleanup

  // PATCH the user — update firstName and deactivate.
  const patchRes = await request.patch(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users/${userId}`,
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
  // Username must never appear in changedFields.
  expect(patchBody.changedFields).not.toContain("username");

  // GET users for the org and verify the change is reflected.
  const listRes = await request.get(
    `/api/v1/superadmin/orgs/${acmeOrgId}/users`,
    { headers: saHeaders() },
  );
  expect(listRes.status(), "GET users after PATCH").toBe(200);
  const listBody = (await listRes.json()) as {
    users: Array<{ id: string; firstName: string; active: boolean }>;
  };
  const updatedUser = listBody.users.find((u) => u.id === userId);
  expect(updatedUser, "updated user present in users list").toBeTruthy();
  expect(updatedUser!.firstName, "firstName changed").toBe("Updated");
  expect(updatedUser!.active, "user is deactivated").toBe(false);
});

// ─── H-6: Wizard pills UI (BLOCKED on ad-hoc preview) ────────────────────────

test("H-6-wizard-pills-ui: BLOCKED — cookie bug on ad-hoc branch preview", async ({
  page,
}) => {
  // BLOCKED: browser login fails on ad-hoc *.vercel.app previews because
  // BETTER_AUTH_URL is set to test.easeetool.com, so the Set-Cookie Domain
  // attribute (.easeetool.com) doesn't match the preview host (.vercel.app)
  // and the browser silently drops the session cookie (RFC 6265 §5.3).
  // This is the known structural bug documented in AGENTS.md — not a new issue.
  //
  // What this test WOULD assert (on test.easeetool.com post-merge):
  //   - Visit a project that has at least one Selection (wizard step 2 unlocked).
  //   - All unlocked steps that are not the current step show the light-green
  //     ✓ state (H-6 spec: "every step that is unlocked and not current shows
  //     light green + ✓; the current step stays primary").
  //   - e.g. on the Design page: Configuration pill shows ✓ green, Design pill
  //     is active/primary, Summary + Quotation pills are muted (locked).
  //
  // This test is intentionally skipped and documented here so the behavior is
  // tracked as pending coverage, not silently omitted.
  test.skip(true, "BLOCKED: BETTER_AUTH_URL cross-subdomain cookie bug — browser login unavailable on ad-hoc branch preview (AGENTS.md). Run on test.easeetool.com post-merge.");
  // Keep the page param to avoid unused-var lint error.
  void page;
});
