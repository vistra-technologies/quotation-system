/**
 * Projects: list/create, get/patch/delete, reset, config-update (GET/POST), submit-design, recompute,
 * calculation.
 *
 * Gates (route source): every verb is "any authenticated org member" — no permission. List visibility
 * (lib/data/projects.ts listProjectsPaginated): scope=mine → creator; scope=all → external users see only
 * their company's projects. DRAFT-only: PATCH, DELETE, reset, recompute, config-update GET/POST.
 *
 * Test-Org projects come from `f.project` / `f.wall` or `createLedgered` (ledgered kind `project`; the
 * DRAFT-only DELETE is how teardown removes them, so every setProjectStatus is reverted in a finally).
 * Org-B projects (foreign-id probes) go with org B at teardown.
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { SaClient, createAllowance, type Guarded } from "../fixtures/clients";
import { globalStateFailuresFile, withRecordedGlobalState } from "../fixtures/global-state";
import type { Factories } from "../fixtures/factories";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import {
  orgApi,
  tag,
  glassConfig,
  oneCellDesign,
  foreignProjectId,
  foreignCompanyId,
  distributorCompanyId,
  createLedgered,
  listIds,
} from "./project-helpers";
import {
  readConfigSnapshot,
  readCalculation,
  readProjectState,
  setProjectStatus,
} from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/projects");
covers("POST /api/v1/orgs/[orgSlug]/projects");
covers("GET /api/v1/orgs/[orgSlug]/projects/[projectId]");
covers("PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]");
covers("DELETE /api/v1/orgs/[orgSlug]/projects/[projectId]");
covers("GET /api/v1/orgs/[orgSlug]/projects/[projectId]/calculation");
covers("GET /api/v1/orgs/[orgSlug]/projects/[projectId]/config-update");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/config-update");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/recompute");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/reset");
covers("POST /api/v1/orgs/[orgSlug]/projects/[projectId]/submit-design");

type Project = {
  id: string;
  name: string;
  status: string;
  currency: string;
  projectNumber: number;
  companyProjectNumber: number | null;
  destinationCountry: string;
  externalCompanyId: string | null;
  createdByUserId: string;
  formulaSetId: string | null;
  designSubmittedAt: string | null;
  organizationId: string;
};
type Snapshot = { takenAt: string; componentTypes: { id: string; code: string; name: string }[] };
type Problem = { kind: string; scope: string; message: string; locus?: Record<string, unknown> };

const nm = (c: Pick<Ctx, "run">, what: string) => `${c.run.prefix}${what}-${tag()}`;

const negative = (verb: "GET" | "POST", sub: string, malformedJson?: boolean) => ({
  key: `${verb} /api/v1/orgs/[orgSlug]/projects/[projectId]/${sub}`,
  method: verb,
  path: () => `/projects/${GHOST}/${sub}`,
  unknownId: () => `/projects/${GHOST}/${sub}`,
  foreignId: async (c: Ctx) => `/projects/${await foreignProjectId(c)}/${sub}`,
  ...(malformedJson === undefined ? {} : { malformedJson }),
});

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/projects", method: "GET", path: () => "/projects" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/projects",
    method: "POST",
    path: () => "/projects",
    body: (c) => ({ name: nm(c, "neg-proj") }), // no currency → a leaked gate still creates nothing
    invalid: [
      { name: "{} (name and currency are required)", body: {}, status: 400 },
      { name: "missing currency", body: (c: Ctx) => ({ name: nm(c, "neg-proj") }), status: 400 },
      { name: "blank name", body: { name: "  ", currency: "AED" }, status: 400 },
      { name: "non-string currency", body: (c: Ctx) => ({ name: nm(c, "neg-proj"), currency: 1 }), status: 400 },
      { name: 'externalCompanyId "does-not-exist"', body: (c: Ctx) => ({ name: nm(c, "neg-proj"), currency: "AED", externalCompanyId: "does-not-exist" }), status: 400 },
      { name: "externalCompanyId of an org-B company", body: async (c: Ctx) => ({ name: nm(c, "neg-proj"), currency: "AED", externalCompanyId: await foreignCompanyId(c) }), status: 400 },
    ],
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/projects/[projectId]",
    method: "GET",
    path: () => `/projects/${GHOST}`,
    unknownId: () => `/projects/${GHOST}`,
    foreignId: async (c) => `/projects/${await foreignProjectId(c)}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/projects/[projectId]",
    method: "PATCH",
    path: () => `/projects/${GHOST}`,
    body: (c) => ({ name: nm(c, "neg-proj") }),
    unknownId: () => `/projects/${GHOST}`,
    foreignId: async (c) => `/projects/${await foreignProjectId(c)}`,
    invalid: [
      { name: "blank name", body: { name: "   " }, status: 400 },
      { name: "blank currency", body: { currency: " " }, status: 400 },
    ],
  },
  {
    key: "DELETE /api/v1/orgs/[orgSlug]/projects/[projectId]",
    method: "DELETE",
    path: () => `/projects/${GHOST}`,
    unknownId: () => `/projects/${GHOST}`,
    foreignId: async (c) => `/projects/${await foreignProjectId(c)}`,
  },
  negative("GET", "calculation"),
  negative("GET", "config-update"),
  negative("POST", "config-update"), // reads { fixes } → malformed JSON is a 400
  negative("POST", "recompute", false), // these three never read a body
  negative("POST", "reset", false),
  negative("POST", "submit-design", false),
]);

/** f.wall + one GLASS selection filling the wall's only cell: ready for Submit Design. */
async function readyWall(f: Factories, admin: Guarded, url: (p: string) => string) {
  const w = await f.wall();
  const sel = await f.selection(w.projectId, "GLASS", await glassConfig(f));
  const p = await admin.patch(url(`/partitions/${w.partitionId}`), { data: { heightMm: 2400, design: oneCellDesign(sel.id) } });
  expect(p.status(), await p.text()).toBe(200);
  return { ...w, selectionId: sel.id };
}

async function submitted(f: Factories, admin: Guarded, url: (p: string) => string) {
  const w = await readyWall(f, admin, url);
  const s = await admin.post(url(`/projects/${w.projectId}/submit-design`));
  expect(s.status(), await s.text()).toBe(200);
  return w;
}

const json = async <T>(r: APIResponse): Promise<T> => (await r.json()) as T;

test.describe("projects: create / read / patch / list", () => {
  test("create → get → list: server-derived fields; configSnapshot only on GET by id", async ({ as, run, ledger, url, orgB }) => {
    const name = nm({ run }, "proj");
    const { res, id, body } = await createLedgered(as.admin, { run, ledger }, "project", {
      name: ` ${name} `, currency: " inr ", projectLocation: " Pune ", destinationCountry: "India", submissionDate: "2026-03-01", endClientName: " EC ",
    });
    expect(res.status(), JSON.stringify(body)).toBe(201);
    const p = body.project as Project & Record<string, unknown>;
    expect(p).toMatchObject({
      name, currency: "INR", projectLocation: "Pune", destinationCountry: "", status: "DRAFT", externalCompanyId: null,
      companyProjectNumber: null, organizationId: run.testOrg.id, createdByUserId: run.users.admin.id, designSubmittedAt: null,
      submissionDate: "2026-03-01T00:00:00.000Z", endClientName: "EC",
    });
    expect(p.projectNumber).toEqual(expect.any(Number));
    expect(p).not.toHaveProperty("configSnapshot");
    expect((await readProjectState(id!)).formulaSetId).toBe(p.formulaSetId);
    expect(p.formulaSetId).toEqual(expect.any(String));

    const g = await as.architect.get(url(`/projects/${id}`));
    expect(g.status(), await g.text()).toBe(200);
    const got = (await json<{ project: Project & { configSnapshot: Snapshot; selectionCount: number; partitionCount: number; createdBy: unknown; externalCompany: unknown; inquiry: unknown } }>(g)).project;
    expect(got).toMatchObject({ id, name, selectionCount: 0, partitionCount: 0, externalCompany: null, inquiry: null });
    expect(got.createdBy).toEqual({ id: run.users.admin.id, username: run.users.admin.username });
    expect(got.configSnapshot.componentTypes.map((t) => t.code)).toEqual(expect.arrayContaining(["GLASS", "DOOR"]));
    expect(got.configSnapshot).toEqual(await readConfigSnapshot(id!));

    const l = await as.admin.get(url(`/projects?search=${encodeURIComponent(name)}`));
    expect(l.status()).toBe(200);
    const list = await json<{ projects: (Project & Record<string, unknown>)[]; total: number; page: number; pageSize: number }>(l);
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(list.projects[0].id).toBe(id);
    expect(list.projects[0]).not.toHaveProperty("configSnapshot"); // lists omit it (Stage 22 D-10)

    const b = await orgB.get(orgApi(run.orgB.slug, `/projects?search=${encodeURIComponent(name)}`));
    expect(((await b.json()) as { total: number }).total).toBe(0);
  });

  test("company-linked create: destination derived, per-company number; bad company → 400 \"Selected company is invalid.\"", async ({ as, f, run, ledger, url }) => {
    const india = await f.externalCompany(undefined, { country: "INDIA", defaultCurrency: "INR" });
    const a = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "proj-in"), currency: "INR", externalCompanyId: india.id });
    expect(a.res.status(), JSON.stringify(a.body)).toBe(201);
    expect(a.body.project).toMatchObject({ destinationCountry: "India", externalCompanyId: india.id, companyProjectNumber: 1, endClientGstNumber: null });
    const b = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "proj-in"), currency: "INR", externalCompanyId: india.id });
    expect(b.body.project).toMatchObject({ companyProjectNumber: 2 });

    const name = nm({ run }, "proj-badco");
    const bad = await createLedgered(as.admin, { run, ledger }, "project", { name, currency: "AED", externalCompanyId: "does-not-exist" });
    expect(bad.res.status()).toBe(400);
    expect(bad.body).toEqual({ error: "Selected company is invalid." });
    expect(await listIds(as.admin, url(`/projects?search=${encodeURIComponent(name)}`), "projects")).toEqual([]);
    const empty = await as.admin.post(url("/projects"), { data: {} });
    expect(empty.status()).toBe(400);
    expect(await empty.json()).toEqual({ error: "name and currency are required" });
  });

  test("PATCH round-trip on DRAFT; company + destination locked; blank name/currency → 400; non-DRAFT → 409", async ({ as, f, run, ledger, url }) => {
    const co = await f.externalCompany();
    const other = await f.externalCompany();
    const { id, body } = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "proj-p"), currency: "AED", externalCompanyId: co.id, projectLocation: "Dubai" });
    expect(id, JSON.stringify(body)).not.toBeNull();
    const renamed = `${(body.project as Project).name}-renamed`;
    const p = await as.member.patch(url(`/projects/${id}`), {
      data: { name: ` ${renamed} `, currency: "usd", projectLocation: "", mainContractorName: " MC ", projectDeadline: "2027-01-01", externalCompanyId: other.id, destinationCountry: "India", status: "SUBMITTED" },
    });
    expect(p.status(), await p.text()).toBe(200);
    const after = (await json<{ project: Project & Record<string, unknown> }>(p)).project;
    expect(after).toMatchObject({
      name: renamed, currency: "USD", projectLocation: null, mainContractorName: "MC", projectDeadline: "2027-01-01T00:00:00.000Z",
      externalCompanyId: co.id, destinationCountry: "UAE", status: "DRAFT",
    });
    expect(after).not.toHaveProperty("configSnapshot");

    for (const [data, error] of [[{ name: "  " }, "name cannot be empty"], [{ currency: "" }, "currency cannot be empty"]] as const) {
      const r = await as.admin.patch(url(`/projects/${id}`), { data });
      expect(r.status()).toBe(400);
      expect(await r.json()).toEqual({ error });
    }
    try {
      await setProjectStatus(id!, "SUBMITTED");
      const r = await as.admin.patch(url(`/projects/${id}`), { data: { name: `${renamed}-x` } });
      expect(r.status()).toBe(409);
      expect(await r.json()).toEqual({ error: "This project cannot be edited — only DRAFT projects are editable." });
    } finally {
      await setProjectStatus(id!, "DRAFT");
    }
    expect((await json<{ project: Project }>(await as.admin.get(url(`/projects/${id}`)))).project.name).toBe(renamed);
  });

  test("visibility: external users list only their company's projects; scope=mine filters by creator; company forced on create", async ({ as, f, run, ledger, url }) => {
    const distCo = await distributorCompanyId({ run, as });
    const otherCo = await f.externalCompany();
    const base = nm({ run }, "pvis");
    const mk = async (suffix: string, extra: Record<string, unknown>, who = as.admin) => {
      const r = await createLedgered(who, { run, ledger }, "project", { name: `${base}-${suffix}`, currency: "AED", ...extra });
      expect(r.res.status(), JSON.stringify(r.body)).toBe(201);
      return r.body.project as Project;
    };
    const own = await mk("own", { externalCompanyId: distCo });
    const foreign = await mk("other", { externalCompanyId: otherCo.id });
    const none = await mk("none", {});
    const byArch = await mk("byarch", { externalCompanyId: otherCo.id }, as.architect);
    expect(byArch.externalCompanyId).toBe(distCo); // the session's company wins
    expect(byArch.createdByUserId).toBe(run.users.architect.id);

    const q = (extra = "") => url(`/projects?search=${encodeURIComponent(base)}${extra}`);
    const sorted = (xs: string[]) => [...xs].sort();
    expect(sorted(await listIds(as.distributor, q(), "projects"))).toEqual(sorted([own.id, byArch.id]));
    expect(sorted(await listIds(as.architect, q(), "projects"))).toEqual(sorted([own.id, byArch.id]));
    expect(sorted(await listIds(as.member, q(), "projects"))).toEqual(sorted([own.id, foreign.id, none.id, byArch.id]));
    expect(sorted(await listIds(as.distributor, q(`&externalCompanyId=${otherCo.id}`), "projects"))).toEqual(sorted([own.id, byArch.id]));
    expect(await listIds(as.admin, q(`&externalCompanyId=${otherCo.id}`), "projects")).toEqual([foreign.id]);
    expect(sorted(await listIds(as.admin, q("&scope=mine"), "projects"))).toEqual(sorted([own.id, foreign.id, none.id]));
    expect(await listIds(as.architect, q("&scope=mine"), "projects")).toEqual([byArch.id]);
    expect(await listIds(as.distributor, q("&scope=mine"), "projects")).toEqual([]);
  });

  test("KNOWN BUG: an external user can read AND edit another company's project by id", async ({ as, f, run, ledger, url }) => {
    const otherCo = await f.externalCompany();
    const { id, body } = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "proj-idor"), currency: "AED", externalCompanyId: otherCo.id });
    expect(id, JSON.stringify(body)).not.toBeNull();
    const name = (body.project as Project).name;
    expect(await listIds(as.distributor, url(`/projects?search=${encodeURIComponent(name)}`), "projects")).toEqual([]);
    // KNOWN BUG — getProjectById/updateProject scope by org only, not by the external user's company;
    // when fixed, change both expectations to 404 and assert the name is unchanged.
    const g = await as.distributor.get(url(`/projects/${id}`));
    expect(g.status(), await g.text()).toBe(200);
    const p = await as.distributor.patch(url(`/projects/${id}`), { data: { name: `${name}-by-dist` } });
    expect(p.status(), await p.text()).toBe(200);
    expect((await json<{ project: Project }>(await as.admin.get(url(`/projects/${id}`)))).project.name).toBe(`${name}-by-dist`);
  });

  test("KNOWN BUG: POST accepts any client-supplied status (an unknown value is stored, the project is then locked)", async ({ as, run, ledger, url }) => {
    const { res, id, body } = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "proj-status"), currency: "AED", status: "rgr-NOT-A-STATUS" });
    try {
      // KNOWN BUG — createProject writes `status` from the body verbatim (Project.status is a plain
      // String); when fixed, change this to 400 (or to 201 with status "DRAFT").
      expect(res.status(), JSON.stringify(body)).toBe(201);
      expect((body.project as Project).status).toBe("rgr-NOT-A-STATUS");
      expect((await as.admin.delete(url(`/projects/${id}`))).status()).toBe(409); // not DRAFT → undeletable via API
    } finally {
      if (id) await setProjectStatus(id, "DRAFT"); // teardown deletes through the DRAFT-only route
    }
  });

  test("KNOWN BUG: currency is not validated — \"EUR\" is accepted on create", async ({ as, run, ledger }) => {
    // KNOWN BUG — only a non-empty currency is required (forms offer INR/AED/USD); when fixed, change to 400.
    const { res, body } = await createLedgered(as.admin, { run, ledger }, "project", { name: nm({ run }, "proj-eur"), currency: "eur" });
    expect(res.status(), JSON.stringify(body)).toBe(201);
    expect((body.project as Project).currency).toBe("EUR");
  });

  test("KNOWN BUG: an unparseable date on PATCH returns 500 instead of 400 (nothing changes)", async ({ as, f, url }) => {
    const p = await f.project();
    // KNOWN BUG — parseDate yields an Invalid Date that Prisma rejects; when fixed, change this to 400.
    const r = await as.admin.patch(url(`/projects/${p.id}`), { data: { name: `${p.name}-x`, submissionDate: "not-a-date" } });
    expect(r.status()).toBe(500);
    expect(await r.json()).toEqual({ error: "Internal server error" });
    expect((await json<{ project: Project }>(await as.admin.get(url(`/projects/${p.id}`)))).project.name).toBe(p.name);
  });

  test("KNOWN BUG: a JSON body that is not an object (null) returns 500 instead of 400", async ({ as, url }) => {
    // KNOWN BUG — `body.name` is read on a null body outside any try; when fixed, change this to 400.
    const r = await as.admin.post(url("/projects"), { data: Buffer.from("null"), headers: { "Content-Type": "application/json" } });
    expect(r.status()).toBe(500);
  });
});

test.describe("projects: submit design / calculation / recompute", () => {
  test("submit-design without any partition → 400", async ({ as, f, url }) => {
    const p = await f.project();
    const r = await as.admin.post(url(`/projects/${p.id}/submit-design`));
    expect(r.status()).toBe(400);
    expect(await r.json()).toEqual({ error: "Add at least one partition before submitting the design." });
  });

  test("submit-design problem path: a wall whose cell has no selection → 422 problem report; nothing written", async ({ as, f, url }) => {
    const w = await f.wall();
    const r = await as.member.post(url(`/projects/${w.projectId}/submit-design`));
    expect(r.status(), await r.text()).toBe(422);
    const rep = await json<{ ok: boolean; problems: Problem[]; problemCount: number; error: string }>(r);
    expect(Object.keys(rep).sort()).toEqual(["error", "ok", "problemCount", "problems"]);
    expect(rep.ok).toBe(false);
    expect(rep.problemCount).toBe(rep.problems.length);
    expect(rep.problems.length).toBeGreaterThanOrEqual(1);
    for (const p of rep.problems) {
      expect(p.kind).toEqual(expect.any(String));
      expect(p.scope).toEqual(expect.any(String));
      expect(p.message).toEqual(expect.any(String));
    }
    expect(rep.problems[0]).toMatchObject({ kind: "CELL_UNASSIGNED", scope: "DESIGN", locus: expect.objectContaining({ partitionId: w.partitionId }) });
    expect(rep.error.startsWith(rep.problems[0].message)).toBe(true);

    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
    const c = await as.admin.get(url(`/projects/${w.projectId}/calculation`));
    expect(c.status()).toBe(404);
    expect(await c.json()).toEqual({ error: "No calculation found for this project" });
  });

  test("submit-design happy path → 200; calculation GET shape without materialByRoom (present in the DB)", async ({ as, f, url }) => {
    const w = await readyWall(f, as.admin, url);
    const before = Date.now();
    const s = await as.architect.post(url(`/projects/${w.projectId}/submit-design`));
    expect(s.status(), await s.text()).toBe(200);
    const sp = (await json<{ project: { id: string; designSubmittedAt: string } }>(s)).project;
    expect(Object.keys(sp).sort()).toEqual(["designSubmittedAt", "id"]);
    expect(sp.id).toBe(w.projectId);
    expect(Date.parse(sp.designSubmittedAt)).toBeGreaterThan(before - 120_000);

    const c = await as.distributor.get(url(`/projects/${w.projectId}/calculation`));
    expect(c.status(), await c.text()).toBe(200);
    const raw = await c.text();
    expect(raw).not.toContain("materialByRoom");
    const calc = JSON.parse(raw) as { computedAt: string; status: string; errorDetail: unknown; summary: unknown; materialList: unknown[]; formulaSet: { name: string; version: number } };
    expect(Object.keys(calc).sort()).toEqual(["computedAt", "errorDetail", "formulaSet", "materialList", "status", "summary"]);
    expect(calc.status).toBe("OK");
    expect(calc.errorDetail).toBeNull();
    expect(calc.summary).toBeTruthy();
    expect(Array.isArray(calc.materialList)).toBe(true);
    expect(calc.materialList.length).toBeGreaterThan(0);
    expect(calc.formulaSet).toEqual({ name: expect.any(String), version: expect.any(Number) });

    const db = await readCalculation(w.projectId);
    expect(db).not.toBeNull();
    expect(db!.materialByRoom).not.toBeNull();
    expect(db!.status).toBe("OK");
    expect(new Date(db!.computedAt).toISOString()).toBe(new Date(calc.computedAt).toISOString());
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });
    const g = (await json<{ project: { selectionCount: number; partitionCount: number; designSubmittedAt: string } }>(await as.admin.get(url(`/projects/${w.projectId}`)))).project;
    expect(g).toMatchObject({ selectionCount: 1, partitionCount: 1, designSubmittedAt: sp.designSubmittedAt });
  });

  test("recompute: never computed → 409; after submit → 200 with a later computedAt; designSubmittedAt untouched", async ({ as, f, url }) => {
    const fresh = await f.project();
    const n = await as.admin.post(url(`/projects/${fresh.id}/recompute`));
    expect(n.status()).toBe(409);
    expect(await n.json()).toEqual({ error: "This project has never been submitted or computed — recompute is not the first computation." });

    const w = await submitted(f, as.admin, url);
    const c0 = (await json<{ computedAt: string }>(await as.admin.get(url(`/projects/${w.projectId}/calculation`)))).computedAt;
    const flag0 = (await readProjectState(w.projectId)).designSubmittedAt;
    const r = await as.member.post(url(`/projects/${w.projectId}/recompute`));
    expect(r.status(), await r.text()).toBe(200);
    const raw = await r.text();
    expect(raw).not.toContain("materialByRoom"); // client-level omit also covers the recompute echo
    const calc = (JSON.parse(raw) as { calculation: { projectId: string; computedAt: string; status: string } }).calculation;
    expect(calc).toMatchObject({ projectId: w.projectId, status: "OK" });
    expect(Date.parse(calc.computedAt)).toBeGreaterThan(Date.parse(c0));
    expect((await json<{ computedAt: string }>(await as.admin.get(url(`/projects/${w.projectId}/calculation`)))).computedAt).toBe(calc.computedAt);
    expect((await readProjectState(w.projectId)).designSubmittedAt).toBe(flag0);
  });

  test("DRAFT-only gates: a SUBMITTED project → 409 on recompute, PATCH, DELETE, reset, config-update GET/POST", async ({ as, f, url }) => {
    const w = await submitted(f, as.admin, url);
    try {
      await setProjectStatus(w.projectId, "SUBMITTED");
      const cases: Array<[string, () => Promise<APIResponse>, string]> = [
        ["recompute", () => as.admin.post(url(`/projects/${w.projectId}/recompute`)), "Only a DRAFT project can be recomputed."],
        ["PATCH", () => as.admin.patch(url(`/projects/${w.projectId}`), { data: { currency: "USD" } }), "This project cannot be edited — only DRAFT projects are editable."],
        ["DELETE", () => as.admin.delete(url(`/projects/${w.projectId}`)), "Project cannot be deleted: it is not in DRAFT status"],
        ["reset", () => as.admin.post(url(`/projects/${w.projectId}/reset`)), "Project cannot be reset: it is not in DRAFT status"],
        ["config-update GET", () => as.admin.get(url(`/projects/${w.projectId}/config-update`)), "Configuration can only be updated while the project is DRAFT"],
        ["config-update POST", () => as.admin.post(url(`/projects/${w.projectId}/config-update`), { data: {} }), "Configuration can only be updated while the project is DRAFT"],
      ];
      for (const [what, call, error] of cases) {
        const r = await call();
        expect(r.status(), what).toBe(409);
        expect(await r.json(), what).toEqual({ error });
      }
      // nothing was touched: still submitted, calculation still there, GET still 200
      expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });
      expect((await as.admin.get(url(`/projects/${w.projectId}/calculation`))).status()).toBe(200);
    } finally {
      await setProjectStatus(w.projectId, "DRAFT");
    }
  });

  test("KNOWN BUG: submit-design is not DRAFT-gated — a SUBMITTED project re-submits (200) and rewrites its calculation", async ({ as, f, url }) => {
    const w = await submitted(f, as.admin, url);
    const c0 = (await readCalculation(w.projectId))!.computedAt;
    try {
      await setProjectStatus(w.projectId, "SUBMITTED");
      // KNOWN BUG — submitDesign() never checks Project.status, unlike recompute/reset/PATCH/DELETE (all
      // DRAFT-only, 409). When fixed, change this expectation to 409 and assert computedAt is unchanged.
      const r = await as.admin.post(url(`/projects/${w.projectId}/submit-design`));
      expect(r.status(), await r.text()).toBe(200);
      expect(Date.parse((await readCalculation(w.projectId))!.computedAt)).toBeGreaterThan(Date.parse(c0));
    } finally {
      await setProjectStatus(w.projectId, "DRAFT");
    }
  });

  test("re-lock on edit: a label-only partition PATCH keeps the submission; a design PATCH clears it and deletes the calculation", async ({ as, f, url }) => {
    const w = await submitted(f, as.admin, url);
    const lbl = await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { label: "rgr-relabel" } });
    expect(lbl.status(), await lbl.text()).toBe(200);
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: expect.any(String), calcCount: 1 });

    const d = await as.admin.patch(url(`/partitions/${w.partitionId}`), { data: { design: oneCellDesign(w.selectionId) } });
    expect(d.status(), await d.text()).toBe(200);
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
    expect(await readCalculation(w.projectId)).toBeNull();
    expect((await as.admin.get(url(`/projects/${w.projectId}/calculation`))).status()).toBe(404);
    // nothing computed and nothing submitted → recompute is "never computed" again
    expect((await as.admin.post(url(`/projects/${w.projectId}/recompute`))).status()).toBe(409);
  });
});

test.describe("projects: reset / delete / config-update / cross-tenant", () => {
  test("reset (DRAFT): wipes floors/rooms/partitions/selections/calculation, re-freezes the snapshot, keeps the project row", async ({ as, f, url }) => {
    const w = await submitted(f, as.admin, url);
    const before = (await json<{ project: Project }>(await as.admin.get(url(`/projects/${w.projectId}`)))).project;
    const snap0 = (await readConfigSnapshot(w.projectId))!;
    const r = await as.distributor.post(url(`/projects/${w.projectId}/reset`)); // any member
    expect(r.status(), await r.text()).toBe(200);
    expect(await r.json()).toEqual({ id: w.projectId });

    const after = (await json<{ project: Project & { selectionCount: number; partitionCount: number } }>(await as.admin.get(url(`/projects/${w.projectId}`)))).project;
    expect(after).toMatchObject({
      name: before.name, projectNumber: before.projectNumber, status: "DRAFT", currency: before.currency,
      designSubmittedAt: null, selectionCount: 0, partitionCount: 0,
    });
    expect(after.formulaSetId).toEqual(expect.any(String));
    expect(await readProjectState(w.projectId)).toMatchObject({ designSubmittedAt: null, calcCount: 0 });
    expect(Date.parse((await readConfigSnapshot(w.projectId))!.takenAt)).toBeGreaterThan(Date.parse(snap0.takenAt));
    expect((await json<{ floors: unknown[] }>(await as.admin.get(url(`/floors?projectId=${w.projectId}`)))).floors).toEqual([]);
    expect((await json<{ selections: unknown[] }>(await as.admin.get(url(`/selections?projectId=${w.projectId}`)))).selections).toEqual([]);
    expect((await as.admin.get(url(`/partitions/${w.partitionId}`))).status()).toBe(404);
  });

  // countProjectCalculations(orgId) before/after (the brief's proof) is racy once other workers submit
  // designs in the Test Org concurrently, so the per-project DB read (readCalculation → null) is the proof.
  test("DELETE (DRAFT) cascades floors/rooms/partitions/selections/calculation; then GET/DELETE → 404", async ({ as, f, url, ledger }) => {
    const w = await submitted(f, as.admin, url);
    expect(await readCalculation(w.projectId)).not.toBeNull();
    const d = await as.member.delete(url(`/projects/${w.projectId}`));
    expect(d.status(), await d.text()).toBe(200);
    expect(await d.json()).toEqual({ id: w.projectId });
    ledger.remove(w.projectId);

    expect((await as.admin.get(url(`/projects/${w.projectId}`))).status()).toBe(404);
    expect((await as.admin.delete(url(`/projects/${w.projectId}`))).status()).toBe(404);
    expect((await as.admin.get(url(`/projects/${w.projectId}/calculation`))).status()).toBe(404);
    expect(await readCalculation(w.projectId)).toBeNull();
    expect((await as.admin.get(url(`/partitions/${w.partitionId}`))).status()).toBe(404);
    expect((await json<{ floors: unknown[] }>(await as.admin.get(url(`/floors?projectId=${w.projectId}`)))).floors).toEqual([]);
    expect((await json<{ rooms: unknown[] }>(await as.admin.get(url(`/rooms?floorId=${w.floorId}`)))).rooms).toEqual([]);
    expect((await json<{ selections: unknown[] }>(await as.admin.get(url(`/selections?projectId=${w.projectId}`)))).selections).toEqual([]);
    const sel = await as.admin.patch(url(`/selections/${w.selectionId}`), { data: { label: "rgr-gone" } });
    expect(sel.status()).toBe(404);
  });

  test("config-update on an up-to-date project: GET needsUpdate false; POST {} → ok, 0 selections, snapshot re-frozen", async ({ as, f, url }) => {
    const p = await f.project();
    const g = await as.member.get(url(`/projects/${p.id}/config-update`));
    expect(g.status(), await g.text()).toBe(200);
    const prev = await json<{ needsUpdate: boolean; changes: unknown[]; formula: Record<string, unknown>; types: object; selections: unknown[]; totalSelections: number }>(g);
    expect(Object.keys(prev).sort()).toEqual(["changes", "formula", "needsUpdate", "selections", "totalSelections", "types"]);
    expect(prev).toMatchObject({ needsUpdate: false, changes: [], selections: [], types: {}, totalSelections: 0 });
    expect(prev.formula).toMatchObject({ changed: false, problem: null });
    expect(prev.formula.from).toBe(prev.formula.to);

    const snap0 = (await readConfigSnapshot(p.id))!;
    const post = await as.member.post(url(`/projects/${p.id}/config-update`), { data: {} });
    expect(post.status(), await post.text()).toBe(200);
    expect(await post.json()).toEqual({ ok: true, updatedSelections: 0 });
    expect(Date.parse((await readConfigSnapshot(p.id))!.takenAt)).toBeGreaterThan(Date.parse(snap0.takenAt));
  });

  test("cross-tenant: org B's project under the Test-Org slug → 404 for every project verb; org B's row is untouched", async ({ as, url, run, orgB }) => {
    const id = await foreignProjectId({ run, orgB });
    const before = (await json<{ project: Project }>(await orgB.get(orgApi(run.orgB.slug, `/projects/${id}`)))).project;
    const calls: Array<[string, () => Promise<APIResponse>]> = [
      ["GET", () => as.admin.get(url(`/projects/${id}`))],
      ["PATCH", () => as.admin.patch(url(`/projects/${id}`), { data: { name: `${run.prefix}hijack` } })],
      ["DELETE", () => as.admin.delete(url(`/projects/${id}`))],
      ["submit-design", () => as.admin.post(url(`/projects/${id}/submit-design`))],
      ["recompute", () => as.admin.post(url(`/projects/${id}/recompute`))],
      ["calculation", () => as.admin.get(url(`/projects/${id}/calculation`))],
      ["reset", () => as.admin.post(url(`/projects/${id}/reset`))],
      ["config-update GET", () => as.admin.get(url(`/projects/${id}/config-update`))],
      ["config-update POST", () => as.admin.post(url(`/projects/${id}/config-update`), { data: {} })],
    ];
    for (const [what, call] of calls) {
      const r = await call();
      expect(r.status(), what).toBe(404);
      expect(await r.json(), what).toEqual({ error: "Project not found" });
    }
    const after = (await json<{ project: Project }>(await orgB.get(orgApi(run.orgB.slug, `/projects/${id}`)))).project;
    expect(after).toMatchObject({ id, name: before.name, status: "DRAFT" });
  });
});

test.describe("projects: frozen configSnapshot (shared ComponentType edit)", () => {
  // Rule 4 + 11. The Test Org's GLASS type is SHARED state: its `name` label is renamed via the SuperAdmin
  // route inside withRecordedGlobalState (original read first, restored exactly, verified; a failed revert
  // is written to global-state-failures.json for teardown). The label is the most trivially reversible edit.
  test("a ComponentType rename is invisible to an existing project's snapshot until config-update applies it", async ({ as, f, url, run, baseURL }) => {
    const sa = await SaClient.login(baseURL!, process.env.TEST_SA_USERNAME!, process.env.TEST_SA_PASSWORD!, createAllowance([], [run.testOrg.id]), process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
    try {
      const types = await json<{ componentTypes: { id: string; code: string }[] }>(await as.admin.get(url("/component-types")));
      const glassId = types.componentTypes.find((t) => t.code === "GLASS")!.id;
      const saPath = `/api/v1/superadmin/component-types/${glassId}`;
      const readName = async () => {
        const r = await sa.get(`${saPath}?orgId=${run.testOrg.id}`);
        if (r.status() !== 200) throw new Error(`SA GET GLASS → HTTP ${r.status()}`);
        return ((await r.json()) as { componentType: { name: string } }).componentType.name;
      };
      const writeName = async (name: unknown) => {
        const r = await sa.patch(saPath, { data: { orgId: run.testOrg.id, name } });
        if (r.status() !== 200) throw new Error(`SA PATCH GLASS name → HTTP ${r.status()} ${await r.text()}`);
      };

      const old = await f.project(); // frozen BEFORE the rename
      const cu = await f.project(); // config-update target
      const original = await readName();
      const glassIn = (s: Snapshot | null) => s!.componentTypes.find((t) => t.code === "GLASS")!;
      expect(glassIn(await readConfigSnapshot(old.id)).name).toBe(original);
      const temp = `${run.prefix}GLASS-renamed`;

      await withRecordedGlobalState(
        { key: `Test Org ComponentType GLASS (${glassId}).name`, read: readName, write: writeName },
        () => writeName(temp),
        async () => {
          expect(await readName()).toBe(temp);
          // the existing project keeps its frozen snapshot (DB + GET by id)
          expect(glassIn(await readConfigSnapshot(old.id)).name).toBe(original);
          const g = (await json<{ project: { configSnapshot: Snapshot } }>(await as.admin.get(url(`/projects/${old.id}`)))).project;
          expect(glassIn(g.configSnapshot).name).toBe(original);
          // a project created now freezes the new label
          const fresh = await f.project();
          expect(glassIn(await readConfigSnapshot(fresh.id)).name).toBe(temp);
          // POST selections on the old project validates against its snapshot → still accepted
          const sel = await f.selection(old.id, "GLASS", await glassConfig(f));
          expect(sel.id).toEqual(expect.any(String));
          expect(glassIn(await readConfigSnapshot(old.id)).name).toBe(original);

          // config-update GET reports the diff between snapshot and current config ...
          const pv = await as.admin.get(url(`/projects/${cu.id}/config-update`));
          expect(pv.status(), await pv.text()).toBe(200);
          const prev = await json<{ needsUpdate: boolean; changes: { typeName: string; items: string[] }[]; formula: { changed: boolean; problem: string | null } }>(pv);
          expect(prev.needsUpdate).toBe(true);
          expect(prev.changes).toEqual([{ typeName: temp, items: [`Renamed from "${original}"`] }]);
          expect(prev.formula).toMatchObject({ changed: false, problem: null });
          // ... POST applies it and bumps the snapshot
          const ap = await as.admin.post(url(`/projects/${cu.id}/config-update`), { data: { fixes: {} } });
          expect(ap.status(), await ap.text()).toBe(200);
          expect(await ap.json()).toEqual({ ok: true, updatedSelections: 0 });
          expect(glassIn(await readConfigSnapshot(cu.id)).name).toBe(temp);
          const pv2 = await json<{ needsUpdate: boolean; changes: unknown[] }>(await as.admin.get(url(`/projects/${cu.id}/config-update`)));
          expect(pv2).toMatchObject({ needsUpdate: false, changes: [] });
        },
        globalStateFailuresFile(run.storageDir),
      );

      expect(await readName()).toBe(original);
      // after the revert, the applied project now differs the other way round
      const back = await json<{ changes: { typeName: string; items: string[] }[] }>(await as.admin.get(url(`/projects/${cu.id}/config-update`)));
      expect(back.changes).toEqual([{ typeName: original, items: [`Renamed from "${temp}"`] }]);
    } finally {
      await sa.dispose();
    }
  });
});
