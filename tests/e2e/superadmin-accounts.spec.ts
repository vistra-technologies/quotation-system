/**
 * Hotfix 2026-10-02 — SuperAdmin accounts managed from /controls/users.
 *
 * Covers /api/v1/superadmin/admins (list / create / change password / delete) and the new
 * "SuperAdmins" section of the Users page.
 *
 * Needs SuperAdmin credentials (TEST_SA_USERNAME / TEST_SA_PASSWORD) — skipped when absent, like the
 * other superadmin-* specs (CLAUDE.md: "~27 tests skip silently without them" — set them).
 *
 * Isolation: every account this spec creates is named `e2e-sa-<ts>-<n>`, tracked, and removed in
 * afterAll — plus the audit rows about/by those accounts (test-only DB helper; the audit log has no
 * delete path in app code). No org, global setting, or non-`e2e-sa-` SuperAdmin is modified.
 * The seeded `devadmin` is only ever probed with requests that MUST be refused (delete → 403).
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { readSuperAdminAuditRows, purgeE2eSuperAdminAudit } from "./db-helpers";

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasCreds = Boolean(SA_USERNAME && SA_PASSWORD);

const RUN = Date.now().toString(36);
let counter = 0;
const newName = () => `e2e-sa-${RUN}-${++counter}`;
const PW1 = "E2e-Pass-1234!";
const PW2 = "E2e-Pass-5678!";

type Admin = { id: string; username: string; createdAt: string; protected: boolean; isSelf: boolean };

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post("/api/v1/superadmin/login", { data: { username, password } });
  const token = /qs-sa-token=([^;]+)/.exec(res.headers()["set-cookie"] ?? "")?.[1];
  return { status: res.status(), token };
}
const cookie = (token: string) => ({ Cookie: `qs-sa-token=${token}` });

async function listAdmins(request: APIRequestContext, token: string): Promise<Admin[]> {
  const res = await request.get("/api/v1/superadmin/admins", { headers: cookie(token) });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { admins: Admin[] }).admins;
}

async function createAdmin(request: APIRequestContext, token: string, username: string, password = PW1) {
  return request.post("/api/v1/superadmin/admins", { headers: cookie(token), data: { username, password } });
}

test.describe.configure({ mode: "serial" });

let token = "";
const createdIds: string[] = [];

test.beforeAll(async ({ request }) => {
  if (!hasCreds) return;
  const r = await login(request, SA_USERNAME, SA_PASSWORD);
  if (r.status !== 200 || !r.token) throw new Error(`SuperAdmin login failed: HTTP ${r.status}`);
  token = r.token;
});

test.afterAll(async ({ request }) => {
  if (!hasCreds || !token) return;
  // Delete every account we made (ignore 404 — tests may have deleted it already), then its audit rows.
  for (const id of createdIds) {
    await request.delete(`/api/v1/superadmin/admins/${id}`, { headers: cookie(token) });
  }
  const leftovers = (await listAdmins(request, token)).filter((a) => a.username.startsWith(`e2e-sa-${RUN}-`));
  for (const a of leftovers) {
    await request.delete(`/api/v1/superadmin/admins/${a.id}`, { headers: cookie(token) });
  }
  await purgeE2eSuperAdminAudit();
});

// ── Unauthenticated ─────────────────────────────────────────────────────────

test("all four verbs → 401 without a SuperAdmin session", async ({ request }) => {
  expect((await request.get("/api/v1/superadmin/admins")).status()).toBe(401);
  expect((await request.post("/api/v1/superadmin/admins", { data: { username: "x1", password: PW1 } })).status()).toBe(401);
  expect((await request.patch("/api/v1/superadmin/admins/nope", { data: { newPassword: PW1 } })).status()).toBe(401);
  expect((await request.delete("/api/v1/superadmin/admins/nope")).status()).toBe(401);
});

test("a bogus qs-sa-token cookie → 401", async ({ request }) => {
  const res = await request.get("/api/v1/superadmin/admins", { headers: cookie("not-a-real-token") });
  expect(res.status()).toBe(401);
});

// ── List ────────────────────────────────────────────────────────────────────

test("GET lists SuperAdmins: never leaks hashes; marks devadmin protected and the caller isSelf", async ({ request }) => {
  test.skip(!hasCreds, "TEST_SA_USERNAME/TEST_SA_PASSWORD not set");
  const res = await request.get("/api/v1/superadmin/admins", { headers: cookie(token) });
  expect(res.status()).toBe(200);
  const raw = await res.text();
  expect(raw).not.toMatch(/passwordHash|password/i);
  const admins = (JSON.parse(raw) as { admins: Admin[] }).admins;
  expect(admins.length).toBeGreaterThanOrEqual(1);
  expect(admins.filter((a) => a.isSelf)).toHaveLength(1);
  expect(admins.find((a) => a.isSelf)!.username).toBe(SA_USERNAME);
  for (const a of admins) expect(a.protected).toBe(a.username === "devadmin");
});

// ── Create ──────────────────────────────────────────────────────────────────

test("POST validation: bad JSON, non-object, missing fields, bad username, short password → 400", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const h = { ...cookie(token), "Content-Type": "application/json" };
  expect((await request.post("/api/v1/superadmin/admins", { headers: h, data: "{not json" })).status()).toBe(400);
  expect((await request.post("/api/v1/superadmin/admins", { headers: h, data: "[]" })).status()).toBe(400);
  expect((await createAdmin(request, token, "")).status()).toBe(400);
  expect((await request.post("/api/v1/superadmin/admins", { headers: cookie(token), data: { username: "ok-name" } })).status()).toBe(400);
  for (const bad of ["a", "has space", "-lead", "a".repeat(33), "UPPER_ok?"]) {
    const res = await createAdmin(request, token, bad);
    expect(res.status(), bad).toBe(400);
  }
  const short = await createAdmin(request, token, newName(), "short");
  expect(short.status()).toBe(400);
  // Nothing was created by any rejected request.
  expect((await listAdmins(request, token)).filter((a) => a.username.startsWith(`e2e-sa-${RUN}-`))).toHaveLength(0);
});

let accountA = { id: "", username: "" };

test("POST creates a SuperAdmin (201); the new account can log in; duplicate → 409; username is normalised", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const username = newName();
  const res = await createAdmin(request, token, `  ${username.toUpperCase()}  `);
  expect(res.status()).toBe(201);
  const { admin } = (await res.json()) as { admin: { id: string; username: string } };
  createdIds.push(admin.id);
  expect(admin.username).toBe(username); // trimmed + lowercased
  accountA = admin;

  const loginRes = await login(request, username, PW1);
  expect(loginRes.status).toBe(200);
  expect(loginRes.token).toBeTruthy();

  expect((await createAdmin(request, token, username)).status()).toBe(409);
  const listed = (await listAdmins(request, token)).find((a) => a.id === admin.id);
  expect(listed).toMatchObject({ username, protected: false, isSelf: false });
});

// ── Change password ─────────────────────────────────────────────────────────

test("PATCH validation: short / missing / non-string newPassword → 400; unknown id → 404", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const url = `/api/v1/superadmin/admins/${accountA.id}`;
  expect((await request.patch(url, { headers: cookie(token), data: { newPassword: "short" } })).status()).toBe(400);
  expect((await request.patch(url, { headers: cookie(token), data: {} })).status()).toBe(400);
  expect((await request.patch(url, { headers: cookie(token), data: { newPassword: 12345678 } })).status()).toBe(400);
  expect((await request.patch("/api/v1/superadmin/admins/does-not-exist", { headers: cookie(token), data: { newPassword: PW2 } })).status()).toBe(404);
  // The failed attempts changed nothing: the original password still works.
  expect((await login(request, accountA.username, PW1)).status).toBe(200);
});

test("PATCH changes another admin's password: old rejected, new accepted, their sessions revoked", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const before = await login(request, accountA.username, PW1);
  expect(before.token).toBeTruthy();
  expect((await request.get("/api/v1/superadmin/admins", { headers: cookie(before.token!) })).status()).toBe(200);

  const res = await request.patch(`/api/v1/superadmin/admins/${accountA.id}`, {
    headers: cookie(token),
    data: { newPassword: PW2 },
  });
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { sessionsRevoked: number }).sessionsRevoked).toBeGreaterThanOrEqual(1);

  expect((await login(request, accountA.username, PW1)).status).toBe(401);
  expect((await login(request, accountA.username, PW2)).status).toBe(200);
  // The pre-change session of that account is gone.
  expect((await request.get("/api/v1/superadmin/admins", { headers: cookie(before.token!) })).status()).toBe(401);
  // The caller's own session is untouched.
  expect((await request.get("/api/v1/superadmin/admins", { headers: cookie(token) })).status()).toBe(200);
});

test("PATCH on your own account keeps the current session and revokes your other sessions", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  // Use throwaway account B so the real SuperAdmin's password is never touched.
  const username = newName();
  const created = await createAdmin(request, token, username);
  expect(created.status()).toBe(201);
  const b = ((await created.json()) as { admin: { id: string } }).admin;
  createdIds.push(b.id);

  const s1 = (await login(request, username, PW1)).token!;
  const s2 = (await login(request, username, PW1)).token!;
  const res = await request.patch(`/api/v1/superadmin/admins/${b.id}`, { headers: cookie(s1), data: { newPassword: PW2 } });
  expect(res.status()).toBe(200);
  expect((await request.get("/api/v1/superadmin/admins", { headers: cookie(s1) })).status()).toBe(200); // kept
  expect((await request.get("/api/v1/superadmin/admins", { headers: cookie(s2) })).status()).toBe(401); // revoked
  expect((await login(request, username, PW2)).status).toBe(200);
});

// ── Delete guards ───────────────────────────────────────────────────────────

test("DELETE devadmin → 403 (protected) and the account is still there; password change is NOT blocked by the guard", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const admins = await listAdmins(request, token);
  const dev = admins.find((a) => a.username === "devadmin");
  test.skip(!dev, "no seeded devadmin on this DB");
  const res = await request.delete(`/api/v1/superadmin/admins/${dev!.id}`, { headers: cookie(token) });
  expect(res.status()).toBe(403);
  expect((await listAdmins(request, token)).some((a) => a.username === "devadmin")).toBe(true);
  // (We deliberately do NOT PATCH devadmin's real password here — that would lock the shared account
  //  out of its existing credentials. The PATCH route has no protected-account check; it is covered
  //  by the "another admin" case above, which goes through the identical code path.)
});

test("DELETE yourself → 400; DELETE unknown id → 404", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const me = (await listAdmins(request, token)).find((a) => a.isSelf)!;
  // If the caller IS devadmin the protected rule (403) takes precedence over self (400).
  const res = await request.delete(`/api/v1/superadmin/admins/${me.id}`, { headers: cookie(token) });
  expect(res.status()).toBe(me.username === "devadmin" ? 403 : 400);
  expect((await listAdmins(request, token)).some((a) => a.id === me.id)).toBe(true);
  expect((await request.delete("/api/v1/superadmin/admins/does-not-exist", { headers: cookie(token) })).status()).toBe(404);
});

// ── Delete + audit ──────────────────────────────────────────────────────────

test("DELETE removes the account and its sessions; its audit history survives with a null link", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  // A (already exists) acts as an actor: log in as A and create B so A authors an audit row.
  const aSession = (await login(request, accountA.username, PW2)).token!;
  const bName = newName();
  const bRes = await createAdmin(request, aSession, bName);
  expect(bRes.status()).toBe(201);
  createdIds.push(((await bRes.json()) as { admin: { id: string } }).admin.id);

  const before = await readSuperAdminAuditRows(accountA.username);
  expect(before.some((r) => r.action === "superadmin.create" && r.superAdminId === accountA.id)).toBe(true);

  const del = await request.delete(`/api/v1/superadmin/admins/${accountA.id}`, { headers: cookie(token) });
  expect(del.status()).toBe(200);
  expect(await del.json()).toEqual({ deleted: true });

  expect((await listAdmins(request, token)).some((a) => a.id === accountA.id)).toBe(false);
  expect((await login(request, accountA.username, PW2)).status).toBe(401);
  expect((await request.get("/api/v1/superadmin/admins", { headers: cookie(aSession) })).status()).toBe(401);
  expect((await request.delete(`/api/v1/superadmin/admins/${accountA.id}`, { headers: cookie(token) })).status()).toBe(404);

  // History kept: same rows, link nulled, username snapshot intact.
  const after = await readSuperAdminAuditRows(accountA.username);
  expect(after.length).toBe(before.length);
  for (const r of after) {
    expect(r.superAdminId).toBeNull();
    expect(r.superAdminUsername).toBe(accountA.username);
  }
});

test("every mutation above wrote its audit row (create, password_change, delete) attributed to the caller", async () => {
  test.skip(!hasCreds, "creds not set");
  const rows = await readSuperAdminAuditRows(SA_USERNAME);
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ["superadmin.create", "superadmin.password_change", "superadmin.delete"]) {
    expect(actions.has(a), a).toBe(true);
  }
  for (const r of rows.filter((x) => x.action.startsWith("superadmin."))) expect(r.targetType).toBe("SuperAdmin");
});

// ── UI ──────────────────────────────────────────────────────────────────────

test("UI: SuperAdmins section lists accounts; devadmin has no delete button; add + change-password + delete flow works", async ({ page, request }) => {
  test.skip(!hasCreds, "creds not set");
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "qs-sa-token", value: token, url: baseURL }]);
  await page.goto("/controls/users");

  const section = page.getByRole("region", { name: "SuperAdmins" });
  await expect(section).toBeVisible();
  const table = section.getByRole("table", { name: "SuperAdmins" });
  await expect(table.getByText("You", { exact: true })).toBeVisible();
  const devRow = table.getByRole("row").filter({ hasText: "devadmin" });
  if (await devRow.count()) {
    await expect(devRow.getByText("Protected")).toBeVisible();
    await expect(devRow.getByRole("button", { name: /Delete SuperAdmin/ })).toHaveCount(0);
    await expect(devRow.getByRole("button", { name: /Change password for devadmin/ })).toBeVisible();
  }

  // Add — mismatched confirm is rejected, matching one succeeds.
  const name = newName();
  await section.getByRole("button", { name: "Add SuperAdmin" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add SuperAdmin" });
  await addDialog.getByLabel("Username").fill(name);
  await addDialog.getByLabel("Password", { exact: true }).fill(PW1);
  await addDialog.getByLabel("Confirm password").fill(PW1 + "x");
  await addDialog.getByRole("button", { name: "Create SuperAdmin" }).click();
  await expect(addDialog.getByText("Passwords do not match")).toBeVisible();
  await addDialog.getByLabel("Confirm password").fill(PW1);
  await addDialog.getByRole("button", { name: "Create SuperAdmin" }).click();
  await expect(addDialog).toBeHidden();
  const row = table.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  const created = (await listAdmins(request, token)).find((a) => a.username === name)!;
  createdIds.push(created.id);

  // Change password via the popup, then confirm via the API that the new one logs in.
  await row.getByRole("button", { name: `Change password for ${name}` }).click();
  const pwDialog = page.getByRole("dialog", { name: "Change password" });
  await pwDialog.getByLabel("New password").fill(PW2);
  await pwDialog.getByLabel("Confirm password").fill(PW2);
  await pwDialog.getByRole("button", { name: "Save password" }).click();
  await expect(pwDialog).toBeHidden();
  expect((await login(request, name, PW1)).status).toBe(401);
  expect((await login(request, name, PW2)).status).toBe(200);

  // Delete via the confirm dialog.
  await row.getByRole("button", { name: `Delete SuperAdmin ${name}` }).click();
  await page.getByRole("dialog", { name: `Delete ${name}` }).getByRole("button", { name: "Delete" }).click();
  await expect(table.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  expect((await listAdmins(request, token)).some((a) => a.username === name)).toBe(false);
});
