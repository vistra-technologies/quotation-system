/**
 * Hotfix 2026-10-02 — SuperAdmin audit-log page (/controls/audit-log) and GET /api/v1/superadmin/audit-log.
 *
 * Needs SuperAdmin credentials (TEST_SA_USERNAME / TEST_SA_PASSWORD) — skipped when absent.
 *
 * Isolation: all data this spec creates is named `e2e-sa-<run>-<n>` — throwaway SuperAdmin accounts, plus (when the
 * dedicated Test Org `e2e-testorg` exists) one throwaway user inside it. Everything is deleted in afterAll, together
 * with the audit rows about / by those names (test-only DB helper; the audit log has no delete path in app code).
 * No other org, no global setting, and no non-`e2e-sa-` SuperAdmin is modified. The log is only ever READ except for
 * the rows our own mutations generate.
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { purgeE2eSuperAdminAudit } from "./db-helpers";

const SA_USERNAME = process.env.TEST_SA_USERNAME ?? "";
const SA_PASSWORD = process.env.TEST_SA_PASSWORD ?? "";
const hasCreds = Boolean(SA_USERNAME && SA_PASSWORD);
const TEST_ORG_SLUG = "e2e-testorg";

const RUN = Date.now().toString(36);
let counter = 0;
const newName = () => `e2e-sa-${RUN}-${++counter}`;
const PW = "E2e-Pass-1234!";

type Entry = {
  id: string; createdAt: string; by: { username: string | null; deleted: boolean };
  verb: "INSERT" | "UPDATE" | "DELETE"; item: string; entity: string | null; summary: string; action: string;
  org: { id: string; slug: string | null } | null; targetType: string; targetId: string; details: unknown;
};
type Page = {
  entries: Entry[]; total: number; page: number; pageSize: number;
  facets: { orgs: { id: string; slug: string | null }[]; admins: { username: string; deleted: boolean }[]; items: string[] };
};

const cookie = (token: string) => ({ Cookie: `qs-sa-token=${token}` });

async function login(request: APIRequestContext, username: string, password: string) {
  const res = await request.post("/api/v1/superadmin/login", { data: { username, password } });
  return { status: res.status(), token: /qs-sa-token=([^;]+)/.exec(res.headers()["set-cookie"] ?? "")?.[1] };
}

async function getLog(request: APIRequestContext, token: string, query: Record<string, string | number> = {}): Promise<Page> {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  const res = await request.get(`/api/v1/superadmin/audit-log${qs ? `?${qs}` : ""}`, { headers: cookie(token) });
  expect(res.status(), qs).toBe(200);
  return (await res.json()) as Page;
}

test.describe.configure({ mode: "serial" });

let token = "";
const adminIds: string[] = [];
let testOrg: { id: string } | null = null;
let userCleanup: { orgId: string; userId: string } | null = null;

test.beforeAll(async ({ request }) => {
  if (!hasCreds) return;
  const r = await login(request, SA_USERNAME, SA_PASSWORD);
  if (r.status !== 200 || !r.token) throw new Error(`SuperAdmin login failed: HTTP ${r.status}`);
  token = r.token;
});

test.afterAll(async ({ request }) => {
  if (!hasCreds || !token) return;
  if (userCleanup) {
    await request.delete(`/api/v1/superadmin/orgs/${userCleanup.orgId}/users/${userCleanup.userId}`, { headers: cookie(token) });
  }
  for (const id of adminIds) await request.delete(`/api/v1/superadmin/admins/${id}`, { headers: cookie(token) });
  const res = await request.get("/api/v1/superadmin/admins", { headers: cookie(token) });
  if (res.ok()) {
    for (const a of ((await res.json()) as { admins: { id: string; username: string }[] }).admins) {
      if (a.username.startsWith(`e2e-sa-${RUN}-`)) await request.delete(`/api/v1/superadmin/admins/${a.id}`, { headers: cookie(token) });
    }
  }
  await purgeE2eSuperAdminAudit();
});

// ── Auth + validation ───────────────────────────────────────────────────────

test("GET → 401 without a session, and with a bogus token", async ({ request }) => {
  expect((await request.get("/api/v1/superadmin/audit-log")).status()).toBe(401);
  expect((await request.get("/api/v1/superadmin/audit-log", { headers: cookie("nope") })).status()).toBe(401);
});

test("the route is read-only: POST / PATCH / DELETE are not allowed", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  for (const method of ["post", "patch", "put", "delete"] as const) {
    const res = await request[method]("/api/v1/superadmin/audit-log", { headers: cookie(token), data: {} });
    expect(res.status(), method).toBe(405);
  }
});

test("bad filter values → 400 with a message (nothing is returned)", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const bad = [
    "scope=everything", "orgId=x", "scope=platform&orgId=x", "verb=insert", "verb=UPSERT", "item=Widget",
    "from=2026-13-01", "from=2026-02-30", "to=yesterday", "from=2026-10-05&to=2026-10-01",
    "page=0", "page=-1", "page=1.5", "page=abc", "pageSize=0", "pageSize=101", "pageSize=x",
  ];
  for (const q of bad) {
    const res = await request.get(`/api/v1/superadmin/audit-log?${q}`, { headers: cookie(token) });
    expect(res.status(), q).toBe(400);
    expect(((await res.json()) as { error: string }).error.length, q).toBeGreaterThan(0);
  }
});

test("response shape: entries are newest-first, carry the display triple, and never leak secrets", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const res = await request.get("/api/v1/superadmin/audit-log?pageSize=100", { headers: cookie(token) });
  expect(res.status()).toBe(200);
  const raw = await res.text();
  expect(raw).not.toMatch(/passwordHash|"password"|newPassword|\$2[aby]\$|scrypt/i);
  const body = JSON.parse(raw) as Page;
  expect(body.page).toBe(1);
  expect(body.pageSize).toBe(100);
  expect(body.total).toBeGreaterThanOrEqual(body.entries.length);
  expect(body.facets.items).toEqual(expect.arrayContaining(["Organization", "User", "Role", "Formula set", "Component type", "SuperAdmin"]));
  for (let i = 1; i < body.entries.length; i++) {
    expect(body.entries[i - 1].createdAt >= body.entries[i].createdAt).toBe(true);
  }
  for (const e of body.entries) {
    expect(["INSERT", "UPDATE", "DELETE"]).toContain(e.verb);
    expect(e.item.length).toBeGreaterThan(0);
    expect(e.summary.length).toBeGreaterThan(0);
    expect(e.action).toMatch(/^[A-Za-z]+\.[A-Za-z_]+$/);
  }
});

// ── Filters against rows we create ──────────────────────────────────────────

let accountA = { id: "", username: "" };
let accountB = { id: "", username: "" };

test("a new SuperAdmin shows up as INSERT · SuperAdmin · <name> in the platform scope, attributed to the caller", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const a = newName();
  const res = await request.post("/api/v1/superadmin/admins", { headers: cookie(token), data: { username: a, password: PW } });
  expect(res.status()).toBe(201);
  accountA = ((await res.json()) as { admin: { id: string; username: string } }).admin;
  adminIds.push(accountA.id);

  const log = await getLog(request, token, { scope: "platform", item: "SuperAdmin", verb: "INSERT", by: SA_USERNAME, pageSize: 100 });
  const row = log.entries.find((e) => e.entity === a);
  expect(row, "created account row").toBeTruthy();
  expect(row).toMatchObject({ verb: "INSERT", item: "SuperAdmin", action: "superadmin.create", org: null, by: { username: SA_USERNAME, deleted: false } });
  expect(row!.summary).toBe("New SuperAdmin account");
  // Every filter result honours every filter.
  for (const e of log.entries) {
    expect(e).toMatchObject({ verb: "INSERT", item: "SuperAdmin", org: null });
    expect(e.by.username).toBe(SA_USERNAME);
  }
});

test("verb filter: password change is UPDATE, and INSERT/UPDATE/DELETE partition the log with no overlap", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const pw = await request.patch(`/api/v1/superadmin/admins/${accountA.id}`, { headers: cookie(token), data: { newPassword: "E2e-Other-5678!" } });
  expect(pw.status()).toBe(200);

  const upd = await getLog(request, token, { verb: "UPDATE", item: "SuperAdmin", by: SA_USERNAME, pageSize: 100 });
  const row = upd.entries.find((e) => e.entity === accountA.username && e.action === "superadmin.password_change");
  expect(row).toMatchObject({ verb: "UPDATE", item: "SuperAdmin" });
  expect(row!.summary).toMatch(/^Password changed/);
  expect(JSON.stringify(row)).not.toMatch(/E2e-Other-5678|E2e-Pass-1234/); // never the password

  const [ins, up, del, all] = await Promise.all(
    (["INSERT", "UPDATE", "DELETE"] as const).map((verb) => getLog(request, token, { verb, pageSize: 1 }))
      .concat(getLog(request, token, { pageSize: 1 })),
  );
  expect(ins.total + up.total + del.total).toBe(all.total);
  for (const [verb, page] of [["INSERT", ins], ["UPDATE", up], ["DELETE", del]] as const) {
    for (const e of page.entries) expect(e.verb).toBe(verb);
  }
});

test("item filter narrows to that item only; unknown combos return an empty page, not an error", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const log = await getLog(request, token, { item: "SuperAdmin", pageSize: 100 });
  expect(log.entries.length).toBeGreaterThan(0);
  for (const e of log.entries) expect(e.item).toBe("SuperAdmin");
  const none = await getLog(request, token, { item: "SuperAdmin", verb: "INSERT", by: "no-such-admin-xyz" });
  expect(none).toMatchObject({ total: 0, entries: [] });
});

test("date filter: today includes our rows, a past range excludes them, from==to is one day", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const today = new Date().toISOString().slice(0, 10);
  const inToday = await getLog(request, token, { from: today, to: today, by: SA_USERNAME, item: "SuperAdmin", pageSize: 100 });
  expect(inToday.entries.some((e) => e.entity === accountA.username)).toBe(true);
  for (const e of inToday.entries) expect(e.createdAt.slice(0, 10)).toBe(today);
  const past = await getLog(request, token, { from: "2000-01-01", to: "2000-12-31" });
  expect(past.total).toBe(0);
  const future = await getLog(request, token, { from: "2999-01-01" });
  expect(future.total).toBe(0);
});

test("paging: pageSize/page slice the same ordered list; total is stable; pages past the end are empty", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const p1 = await getLog(request, token, { pageSize: 2, page: 1 });
  const p2 = await getLog(request, token, { pageSize: 2, page: 2 });
  expect(p1.entries).toHaveLength(2);
  expect(p2.total).toBeGreaterThanOrEqual(p1.total); // new rows may only add
  const ids1 = p1.entries.map((e) => e.id);
  for (const e of p2.entries) expect(ids1).not.toContain(e.id);
  const beyond = await getLog(request, token, { pageSize: 50, page: 100000 });
  expect(beyond.entries).toEqual([]);
  expect(beyond.total).toBeGreaterThan(0);
});

test("a deleted SuperAdmin keeps its history: shown as (deleted) in rows and in the By facet; By filter still finds it", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  // B is created BY account A (so A authors an audit row), then A is deleted by the caller.
  const aLogin = await login(request, accountA.username, "E2e-Other-5678!");
  expect(aLogin.token).toBeTruthy();
  const bName = newName();
  const bRes = await request.post("/api/v1/superadmin/admins", { headers: cookie(aLogin.token!), data: { username: bName, password: PW } });
  expect(bRes.status()).toBe(201);
  accountB = ((await bRes.json()) as { admin: { id: string; username: string } }).admin;
  adminIds.push(accountB.id);

  expect((await request.delete(`/api/v1/superadmin/admins/${accountA.id}`, { headers: cookie(token) })).status()).toBe(200);

  const log = await getLog(request, token, { by: accountA.username, pageSize: 100 });
  expect(log.total).toBeGreaterThanOrEqual(1);
  for (const e of log.entries) expect(e.by).toEqual({ username: accountA.username, deleted: true });
  expect(log.facets.admins).toContainEqual({ username: accountA.username, deleted: true });
  expect(log.facets.admins).toContainEqual({ username: SA_USERNAME, deleted: false });

  // The delete itself is a DELETE · SuperAdmin · <A> row, still named after the (now gone) target.
  const del = await getLog(request, token, { verb: "DELETE", item: "SuperAdmin", by: SA_USERNAME, pageSize: 100 });
  const row = del.entries.find((e) => e.entity === accountA.username);
  expect(row).toMatchObject({ verb: "DELETE", action: "superadmin.delete", summary: "SuperAdmin account deleted" });
});

// ── Organization scope (needs the dedicated Test Org) ───────────────────────

test("org scope: a user created in the Test Org appears as INSERT · User · <name> under that org, and not in the platform scope", async ({ request }) => {
  test.skip(!hasCreds, "creds not set");
  const orgs = await request.get("/api/v1/superadmin/orgs", { headers: cookie(token) });
  expect(orgs.status()).toBe(200);
  testOrg = ((await orgs.json()) as { orgs: { id: string; slug: string }[] }).orgs.find((o) => o.slug === TEST_ORG_SLUG) ?? null;
  test.skip(!testOrg, `Test Org "${TEST_ORG_SLUG}" does not exist on this environment`);

  const rolesRes = await request.get(`/api/v1/superadmin/roles?orgId=${testOrg!.id}`, { headers: cookie(token) });
  const roles = ((await rolesRes.json()) as { roles: { id: string; isInternalRole: boolean }[] }).roles;
  const role = roles.find((r) => r.isInternalRole) ?? roles[0];
  test.skip(!role, "Test Org has no roles");

  const username = newName();
  const created = await request.post(`/api/v1/superadmin/orgs/${testOrg!.id}/users`, {
    headers: cookie(token),
    data: { firstName: "E2E", lastName: "Audit", username, roleId: role.id, password: PW },
  });
  expect(created.status()).toBe(201);
  userCleanup = { orgId: testOrg!.id, userId: ((await created.json()) as { user: { id: string } }).user.id };

  const inOrg = await getLog(request, token, { scope: "org", orgId: testOrg!.id, item: "User", verb: "INSERT", pageSize: 100 });
  const row = inOrg.entries.find((e) => e.entity === username);
  expect(row, "org-scoped row").toBeTruthy();
  expect(row).toMatchObject({ verb: "INSERT", item: "User", action: "user.create", org: { id: testOrg!.id, slug: TEST_ORG_SLUG }, summary: "New user" });
  for (const e of inOrg.entries) expect(e.org?.id).toBe(testOrg!.id); // org filter never leaks another org

  const anyOrg = await getLog(request, token, { scope: "org", pageSize: 100 });
  for (const e of anyOrg.entries) expect(e.org).not.toBeNull();
  expect(anyOrg.entries.some((e) => e.entity === username)).toBe(true);
  const platform = await getLog(request, token, { scope: "platform", pageSize: 100 });
  for (const e of platform.entries) expect(e.org).toBeNull();
  expect(platform.entries.some((e) => e.entity === username)).toBe(false);
  expect(inOrg.facets.orgs).toContainEqual({ id: testOrg!.id, slug: TEST_ORG_SLUG });
});

test("org scope: deleting that user is DELETE · User · <name> (name survives the delete) under the same org", async ({ request }) => {
  test.skip(!hasCreds || !userCleanup, "no user created in the previous test");
  const before = await getLog(request, token, { scope: "org", orgId: userCleanup!.orgId, item: "User", pageSize: 100 });
  const username = before.entries.find((e) => e.action === "user.create" && e.targetId === userCleanup!.userId)?.entity;
  expect(username).toBeTruthy();

  const { orgId, userId } = userCleanup!;
  const del = await request.delete(`/api/v1/superadmin/orgs/${orgId}/users/${userId}`, { headers: cookie(token) });
  expect(del.status()).toBe(200);
  userCleanup = null;

  const after = await getLog(request, token, { scope: "org", orgId, verb: "DELETE", item: "User", pageSize: 100 });
  const row = after.entries.find((e) => e.entity === username);
  expect(row).toMatchObject({ verb: "DELETE", item: "User", action: "user.delete", summary: "User deleted" });
});

// ── UI ──────────────────────────────────────────────────────────────────────

test("UI: sidebar link, table, scope switch, row expand, filter via URL, bad-query message", async ({ page }) => {
  test.skip(!hasCreds, "creds not set");
  const baseURL = test.info().project.use.baseURL ?? "http://localhost:3000";
  await page.context().addCookies([{ name: "qs-sa-token", value: token, url: baseURL }]);

  await page.goto("/controls/users");
  await page.getByRole("link", { name: "Audit Log" }).click();
  await expect(page).toHaveURL(/\/controls\/audit-log$/);
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();

  const rows = page.getByTestId("audit-row");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId("audit-count")).toContainText(/\d+ entr/);

  // Row shows the Action / Item / Entity triple and expands to a sentence + raw action.
  const first = rows.first();
  await expect(first.locator("span", { hasText: /^(INSERT|UPDATE|DELETE)$/ })).toBeVisible();
  await first.click();
  const detail = page.getByTestId("audit-detail").first();
  await expect(detail).toContainText("What happened");
  await expect(detail).toContainText("Raw action");
  await first.click();
  await expect(page.getByTestId("audit-detail")).toHaveCount(0);

  // Org select is locked until the Organization scope is chosen.
  const orgSelect = page.getByRole("combobox").first(); // Organization is the first select
  await expect(orgSelect).toBeDisabled();
  await page.getByRole("button", { name: "Organization", exact: true }).click();
  await expect(page).toHaveURL(/scope=org/);
  await expect(orgSelect).toBeEnabled();
  await page.getByRole("button", { name: "SuperAdmin console" }).click();
  await expect(page).toHaveURL(/scope=platform/);
  for (const cell of await page.getByTestId("audit-row").locator("td:last-child").allInnerTexts()) {
    expect(cell.trim()).toBe("SuperAdmin console");
  }

  // Filters live in the URL: a DELETE-only view shows only DELETE badges, and Reset clears it.
  await page.goto("/controls/audit-log?verb=DELETE");
  for (const badge of await page.getByTestId("audit-row").locator("td:nth-child(4)").allInnerTexts()) {
    expect(badge.trim()).toBe("DELETE");
  }
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page).toHaveURL(/\/controls\/audit-log$/);

  // A hand-edited bad query shows a message instead of crashing.
  await page.goto("/controls/audit-log?verb=BOGUS");
  // Next.js also renders its own role="alert" route announcer, so match ours by its text.
  await expect(page.getByRole("alert").filter({ hasText: "verb must be one of" })).toBeVisible();
});

test("UI: the page redirects to the SuperAdmin login without a session", async ({ page }) => {
  await page.goto("/controls/audit-log");
  await expect(page).toHaveURL(/\/controls\/login/);
});
