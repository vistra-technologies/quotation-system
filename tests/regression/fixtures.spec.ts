/**
 * Fixture self-check (Task 4). Not a coverage spec — it proves the factories work against the real
 * API AND that the global teardown drains everything they create:
 *   1. one test uses every factory, asserts the rows are listed, and RETURNS WITHOUT CLEANING UP;
 *   2. one test (expected to fail) creates a row then fails an assertion — proving "register before use".
 * After a run, cleanup.json must list every created row as deleted, with no strays / errors / delta.
 */
import { test, expect } from "./fixtures/test";
import type { Role } from "./fixtures/run-state";

const ROLES: Role[] = ["admin", "member", "distributor", "architect"];

test("factories: every factory creates a listed, ledgered row (no manual cleanup)", async ({ f, as, url, ledger, run }) => {
  const proj = await f.project();
  const inq = await f.inquiry();
  const co = await f.externalCompany();
  const inv = await f.inventoryItem();
  const users = [];
  for (const role of ROLES) users.push(await f.user(role));
  const wall = await f.wall();

  // GLASS selection: config verified against the Test Org's component type (same shape the e2e specs use).
  const sel = await f.selection(wall.projectId, "GLASS", { category: "Single", glassType: "ID1", thickness: "12" });
  expect(sel.id).toBeTruthy();

  const listed = async (path: string, key: string) => {
    const r = await as.admin.get(url(path));
    expect(r.status(), await r.text()).toBe(200);
    return ((await r.json()) as Record<string, { id: string }[]>)[key];
  };
  expect((await listed(`/projects?pageSize=100&search=${proj.name}`, "projects")).map((x) => x.id)).toContain(proj.id);
  expect((await listed(`/projects?pageSize=100&search=${run.prefix}`, "projects")).map((x) => x.id)).toContain(wall.projectId);
  expect((await listed(`/inquiries?pageSize=100&search=${inq.name}`, "inquiries")).map((x) => x.id)).toContain(inq.id);
  expect((await listed("/external-companies", "companies")).map((x) => x.id)).toContain(co.id);
  expect((await listed("/inventory", "items")).map((x) => x.id)).toContain(inv.id);
  const userIds = (await listed("/users", "users")).map((x) => x.id);
  for (const u of users) expect(userIds).toContain(u.id);

  // Everything above is ledgered with the run prefix BEFORE the test returned.
  const ids = new Set(ledger.load().map((e) => e.id));
  for (const id of [proj.id, inq.id, co.id, inv.id, wall.projectId, ...users.map((u) => u.id)]) expect(ids.has(id)).toBe(true);
  expect(ledger.load().filter((e) => e.label.startsWith(run.prefix) && !e.label.startsWith(`${run.prefix}admin`)).length).toBeGreaterThan(8);
  // deliberately NOT cleaned up here — global teardown must remove every row.
});

test("register-before-use: a failing assertion after a factory call still leaves the row ledgered", async ({ f, ledger }) => {
  test.fail(true, "expected failure: proves rows created before a failing assertion are still cleaned up by teardown");
  const p = await f.project();
  expect(ledger.load().some((e) => e.id === p.id)).toBe(true); // registered
  expect(true, "deliberate failure after the factory call").toBe(false);
});
