/**
 * Inquiries: list/create, get/patch (update + dismiss), convert → project.
 *
 * Gates (route source): every verb is "any authenticated org member" — no permission. Visibility differs
 * by user type in the LIST only (lib/data/inquiries.ts listInquiriesPaginated): scope=mine → creator;
 * scope=all → external users (session.externalCompanyId set) see only their company's rows, internal
 * users the whole org. External users' externalCompanyId is forced from the session on create.
 *
 * There is NO inquiry DELETE route: inquiries are ledgered kind `inquiry` (deleted by the guarded DB
 * helper at teardown). Projects created by `convert` are ledgered kind `project` (DRAFT, API-deletable).
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { covers } from "../fixtures/covers";
import { registerNegatives, GHOST, type Ctx } from "./api-matrix";
import {
  orgApi,
  tag,
  foreignInquiryId,
  foreignCompanyId,
  distributorCompanyId,
  createLedgered,
  listIds,
} from "./project-helpers";
import { readConfigSnapshot } from "../../e2e/db-helpers";

covers("GET /api/v1/orgs/[orgSlug]/inquiries");
covers("POST /api/v1/orgs/[orgSlug]/inquiries");
covers("GET /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]");
covers("PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]");
covers("POST /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert");

const json = async <T>(r: APIResponse): Promise<T> => (await r.json()) as T;

type Inquiry = {
  id: string;
  name: string;
  status: string;
  currency: string;
  inquiryNumber: number;
  companyInquiryNumber: number | null;
  destinationCountry: string;
  externalCompanyId: string | null;
  createdByUserId: string;
  projectLocation: string | null;
  endClientName: string | null;
  endClientGstNumber: string | null;
  submissionDate: string | null;
  organizationId: string;
};

const nm = (c: Pick<Ctx, "run">, what: string) => `${c.run.prefix}${what}-${tag()}`;

registerNegatives([
  { key: "GET /api/v1/orgs/[orgSlug]/inquiries", method: "GET", path: () => "/inquiries" },
  {
    key: "POST /api/v1/orgs/[orgSlug]/inquiries",
    method: "POST",
    path: () => "/inquiries",
    body: (c) => ({ name: nm(c, "neg-inq") }), // no currency → a leaked gate still creates nothing
    invalid: [
      { name: "{} (name and currency are required)", body: {}, status: 400 },
      { name: "missing currency", body: (c: Ctx) => ({ name: nm(c, "neg-inq") }), status: 400 },
      { name: "blank name", body: { name: "   ", currency: "AED" }, status: 400 },
      { name: "non-string name", body: { name: 123, currency: "AED" }, status: 400 },
      { name: "blank currency", body: (c: Ctx) => ({ name: nm(c, "neg-inq"), currency: "  " }), status: 400 },
      { name: 'externalCompanyId "does-not-exist"', body: (c: Ctx) => ({ name: nm(c, "neg-inq"), currency: "AED", externalCompanyId: "does-not-exist" }), status: 400 },
      { name: "externalCompanyId of an org-B company", body: async (c: Ctx) => ({ name: nm(c, "neg-inq"), currency: "AED", externalCompanyId: await foreignCompanyId(c) }), status: 400 },
    ],
  },
  {
    key: "GET /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]",
    method: "GET",
    path: () => `/inquiries/${GHOST}`,
    unknownId: () => `/inquiries/${GHOST}`,
    foreignId: async (c) => `/inquiries/${await foreignInquiryId(c)}`,
  },
  {
    key: "PATCH /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]",
    method: "PATCH",
    path: () => `/inquiries/${GHOST}`, // never a live row: a leaked gate updates nothing
    body: (c) => ({ name: nm(c, "neg-inq") }), // the update path, so unknown/foreign ids reach the lookup
    unknownId: () => `/inquiries/${GHOST}`,
    foreignId: async (c) => `/inquiries/${await foreignInquiryId(c)}`,
    invalid: [
      { name: "blank name", body: { name: "  " }, status: 400 },
      { name: "non-string name", body: { name: 42 }, status: 400 },
      { name: "blank currency", body: { currency: "" }, status: 400 },
    ],
  },
  {
    key: "POST /api/v1/orgs/[orgSlug]/inquiries/[inquiryId]/convert",
    method: "POST",
    path: () => `/inquiries/${GHOST}/convert`,
    malformedJson: false, // the route never reads a body
    unknownId: () => `/inquiries/${GHOST}/convert`,
    foreignId: async (c) => `/inquiries/${await foreignInquiryId(c)}/convert`,
  },
]);

test.describe("inquiries: rules", () => {
  test("create → get: server-derived fields, trimmed/upper-cased input, list + org-B isolation", async ({ as, run, ledger, url, orgB }) => {
    const name = nm({ run }, "inq");
    const { res, id, body } = await createLedgered(as.admin, { run, ledger }, "inquiry", {
      name: `  ${name} `,
      currency: " aed ",
      projectLocation: "  Dubai  ",
      destinationCountry: "India", // not accepted from the client (D19) — derived, "" without a company
      submissionDate: "2026-01-15",
      endClientName: "  End Client  ",
      mainContractorName: "",
    });
    expect(res.status(), JSON.stringify(body)).toBe(201);
    const inq = body.inquiry as Inquiry;
    expect(inq).toMatchObject({
      name,
      currency: "AED",
      projectLocation: "Dubai",
      destinationCountry: "",
      status: "NEW",
      externalCompanyId: null,
      companyInquiryNumber: null,
      organizationId: run.testOrg.id,
      createdByUserId: run.users.admin.id,
      submissionDate: "2026-01-15T00:00:00.000Z",
      endClientName: "End Client",
    });
    expect((inq as unknown as { mainContractorName: unknown }).mainContractorName).toBeNull();
    expect(inq.inquiryNumber).toEqual(expect.any(Number));

    const g = await as.member.get(url(`/inquiries/${id}`));
    expect(g.status(), await g.text()).toBe(200);
    const got = ((await g.json()) as { inquiry: Inquiry & { externalCompany: unknown; createdBy: { id: string; username: string } } }).inquiry;
    expect(got).toMatchObject({ id, name, status: "NEW", externalCompany: null });
    expect(got.createdBy).toEqual({ id: run.users.admin.id, username: run.users.admin.username });

    const l = await as.admin.get(url(`/inquiries?search=${encodeURIComponent(name)}`));
    expect(l.status()).toBe(200);
    const list = (await l.json()) as { inquiries: Inquiry[]; total: number; page: number; pageSize: number };
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(list.inquiries.map((x) => x.id)).toEqual([id]);

    const b = await orgB.get(orgApi(run.orgB.slug, `/inquiries?search=${encodeURIComponent(name)}`));
    expect(b.status()).toBe(200);
    expect(((await b.json()) as { total: number }).total).toBe(0);
  });

  test("list paging is clamped: pageSize 1..100 (default 20), page >= 1", async ({ as, url }) => {
    for (const [q, page, pageSize] of [["?pageSize=999", 1, 100], ["?pageSize=0", 1, 20], ["?page=0&pageSize=1", 1, 1], ["?page=abc&pageSize=x", 1, 20]] as const) {
      const r = await as.admin.get(url(`/inquiries${q}`));
      expect(r.status(), q).toBe(200);
      const body = (await r.json()) as { inquiries: unknown[]; page: number; pageSize: number };
      expect({ page: body.page, pageSize: body.pageSize }, q).toEqual({ page, pageSize });
      expect(body.inquiries.length, q).toBeLessThanOrEqual(pageSize);
    }
  });

  // D20 (Stage 14) made endClientGstNumber required for INDIA companies CLIENT-SIDE only; Stage 17 then
  // made the whole End Client block optional on all four forms, and the API never enforced it
  // (stage-17.md §1: "server-side validation in all four API routes only enforces name + currency").
  // So the brief's "INDIA without GST → 400" is superseded: both are 201 and destinationCountry is derived.
  test("INDIA company: destinationCountry is derived as \"India\"; GST is optional (201 without, stored with)", async ({ as, f, run, ledger }) => {
    const co = await f.externalCompany(undefined, { country: "INDIA", defaultCurrency: "INR" });
    const without = await createLedgered(as.admin, { run, ledger }, "inquiry", { name: nm({ run }, "inq-in"), currency: "INR", externalCompanyId: co.id });
    expect(without.res.status(), JSON.stringify(without.body)).toBe(201);
    expect(without.body.inquiry).toMatchObject({ destinationCountry: "India", externalCompanyId: co.id, endClientGstNumber: null, companyInquiryNumber: 1 });

    const withGst = await createLedgered(as.admin, { run, ledger }, "inquiry", {
      name: nm({ run }, "inq-in"), currency: "INR", externalCompanyId: co.id, endClientGstNumber: " 27AAAAA0000A1Z5 ",
    });
    expect(withGst.res.status(), JSON.stringify(withGst.body)).toBe(201);
    // the per-company sequence advances independently of the org-wide one
    expect(withGst.body.inquiry).toMatchObject({ destinationCountry: "India", endClientGstNumber: "27AAAAA0000A1Z5", companyInquiryNumber: 2 });

    const uae = await f.externalCompany();
    const u = await createLedgered(as.admin, { run, ledger }, "inquiry", { name: nm({ run }, "inq-ae"), currency: "AED", externalCompanyId: uae.id });
    expect(u.res.status()).toBe(201);
    expect(u.body.inquiry).toMatchObject({ destinationCountry: "UAE", companyInquiryNumber: 1 });
  });

  test("invalid company references are rejected with \"Selected company is invalid.\" and create nothing", async ({ as, run, url, orgB, ledger }) => {
    for (const externalCompanyId of ["does-not-exist", await foreignCompanyId({ run, orgB })]) {
      const name = nm({ run }, "inq-badco");
      const { res, body } = await createLedgered(as.admin, { run, ledger }, "inquiry", { name, currency: "AED", externalCompanyId });
      expect(res.status()).toBe(400);
      expect(body).toEqual({ error: "Selected company is invalid." });
      expect(await listIds(as.admin, url(`/inquiries?search=${encodeURIComponent(name)}`), "inquiries")).toEqual([]);
    }
    const r = await as.admin.post(url("/inquiries"), { data: {} });
    expect(r.status()).toBe(400);
    expect(await r.json()).toEqual({ error: "name and currency are required" });
  });

  test("PATCH round-trip; company/destination stay locked; blank required fields → 400 and nothing changes", async ({ as, f, run, ledger, url }) => {
    const co = await f.externalCompany();
    const other = await f.externalCompany();
    const { id, body } = await createLedgered(as.admin, { run, ledger }, "inquiry", { name: nm({ run }, "inq-p"), currency: "AED", externalCompanyId: co.id, projectLocation: "Dubai" });
    expect(id, JSON.stringify(body)).not.toBeNull();
    const renamed = `${(body.inquiry as Inquiry).name}-renamed`;

    const p = await as.member.patch(url(`/inquiries/${id}`), {
      data: { name: ` ${renamed} `, currency: "usd", projectLocation: "  ", endClientName: "EC", submissionDate: "2026-02-01", externalCompanyId: other.id, destinationCountry: "India" },
    });
    expect(p.status(), await p.text()).toBe(200);
    const after = ((await p.json()) as { inquiry: Inquiry & { externalCompany: { id: string; name: string } } }).inquiry;
    expect(after).toMatchObject({
      name: renamed, currency: "USD", projectLocation: null, endClientName: "EC", submissionDate: "2026-02-01T00:00:00.000Z",
      externalCompanyId: co.id, destinationCountry: "UAE", status: "NEW",
    });
    expect(after.externalCompany).toEqual({ id: co.id, name: co.name });

    // stale / blank required fields
    for (const [data, error] of [
      [{ name: "   " }, "name must be a non-empty string."],
      [{ name: 7 }, "name must be a non-empty string."],
      [{ currency: " " }, "currency must be a non-empty string."],
      [{ currency: 5, name: `${renamed}-x` }, "currency must be a non-empty string."],
    ] as const) {
      const r = await as.admin.patch(url(`/inquiries/${id}`), { data });
      expect(r.status(), JSON.stringify(data)).toBe(400);
      expect(await r.json()).toEqual({ error });
    }
    const g = ((await (await as.admin.get(url(`/inquiries/${id}`))).json()) as { inquiry: Inquiry }).inquiry;
    expect(g).toMatchObject({ name: renamed, currency: "USD", status: "NEW" });
  });

  // Route doc: a PATCH with no body (or no editable field) is the DISMISS action.
  test("dismiss (PATCH with no editable field) → DISMISSED; then edit/dismiss/convert all → 409", async ({ as, f, url }) => {
    const inq = await f.inquiry();
    const d = await as.admin.patch(url(`/inquiries/${inq.id}`), { data: { externalCompanyId: "ignored" } }); // no editable field → dismiss
    expect(d.status(), await d.text()).toBe(200);
    expect(((await d.json()) as { inquiry: Inquiry }).inquiry.status).toBe("DISMISSED");

    const edit = await as.admin.patch(url(`/inquiries/${inq.id}`), { data: { name: `${inq.name}-x` } });
    expect(edit.status()).toBe(409);
    expect(await edit.json()).toEqual({ error: "Only NEW inquiries can be edited." });
    const again = await as.admin.patch(url(`/inquiries/${inq.id}`));
    expect(again.status()).toBe(409);
    expect(await again.json()).toEqual({ error: "Inquiry is already closed." });
    const conv = await as.admin.post(url(`/inquiries/${inq.id}/convert`));
    expect(conv.status()).toBe(409);
    expect(await conv.json()).toEqual({ error: "This inquiry is already closed." });
  });

  test("convert → 201 DRAFT project with the inquiry's fields + a frozen snapshot; twice → 409; deleting the project re-opens the inquiry", async ({ as, run, ledger, url }) => {
    // Use the architect's own company so the architect (external user) can access the inquiry post-fix (D-1 class).
    const archCoId = await distributorCompanyId({ run, as });
    const { id: inqId, body } = await createLedgered(as.admin, { run, ledger }, "inquiry", {
      name: nm({ run }, "inq-conv"), currency: "AED", externalCompanyId: archCoId, projectLocation: "Abu Dhabi", endClientName: "EC1", projectDeadline: "2026-12-31",
    });
    expect(inqId, JSON.stringify(body)).not.toBeNull();
    const inq = body.inquiry as Inquiry;

    // Read the company's current max companyProjectNumber before converting. The distributor's
    // project list is scoped to their company by the API, so no extra filter is needed.
    // Other specs create projects in the same company concurrently, so asserting == 1 would be
    // non-deterministic; asserting maxBefore + 1 keeps the strength while being run-order safe.
    const priorList = await as.distributor.get(url(`/projects?pageSize=100`));
    const priorProjs = ((await priorList.json()) as { projects: { companyProjectNumber: number | null }[] }).projects;
    const maxPriorNumber = priorProjs.reduce((m, p) => Math.max(m, p.companyProjectNumber ?? 0), 0);

    const c = await as.architect.post(url(`/inquiries/${inqId}/convert`)); // any member may convert
    expect(c.status(), await c.text()).toBe(201);
    const project = ((await c.json()) as { project: Record<string, unknown> }).project;
    ledger.add({ kind: "project", id: project.id as string, orgSlug: run.testOrg.slug, label: project.name as string });
    expect(project).toMatchObject({
      name: inq.name, currency: "AED", projectLocation: "Abu Dhabi", destinationCountry: "UAE", status: "DRAFT",
      externalCompanyId: archCoId, inquiryId: inqId, endClientName: "EC1", projectDeadline: "2026-12-31T00:00:00.000Z",
      organizationId: run.testOrg.id, createdByUserId: run.users.architect.id,
    });
    // Assert companyProjectNumber separately: the max read and convert are not atomic, so asserting
    // exact max+1 could flake if a concurrent worker creates a project in this company in that window.
    // toBeGreaterThan(maxPriorNumber) proves the sequence advanced without being racy.
    expect(typeof project.companyProjectNumber).toBe("number");
    expect(project.companyProjectNumber as number).toBeGreaterThan(maxPriorNumber);
    expect(project.formulaSetId).toEqual(expect.any(String));
    expect(project).not.toHaveProperty("configSnapshot"); // never echoed (Stage 22 B3)

    const snap = await readConfigSnapshot(project.id as string);
    expect(snap).not.toBeNull();
    expect(snap!.takenAt).toEqual(expect.any(String));
    expect(snap!.componentTypes.map((t) => t.code)).toEqual(expect.arrayContaining(["GLASS", "DOOR"]));

    const g = ((await (await as.admin.get(url(`/inquiries/${inqId}`))).json()) as { inquiry: Inquiry }).inquiry;
    expect(g.status).toBe("CONVERTED");
    const twice = await as.admin.post(url(`/inquiries/${inqId}/convert`));
    expect(twice.status()).toBe(409);
    expect(await twice.json()).toEqual({ error: "This inquiry is already closed." });
    expect((await as.admin.patch(url(`/inquiries/${inqId}`), { data: { name: `${inq.name}-x` } })).status()).toBe(409);

    // DELETE of the inquiry's last project reverts it to NEW (route doc), so it can be converted again.
    const del = await as.admin.delete(url(`/projects/${project.id}`));
    expect(del.status(), await del.text()).toBe(200);
    ledger.remove(project.id as string);
    expect(((await (await as.admin.get(url(`/inquiries/${inqId}`))).json()) as { inquiry: Inquiry }).inquiry.status).toBe("NEW");
    const again = await as.admin.post(url(`/inquiries/${inqId}/convert`));
    expect(again.status(), await again.text()).toBe(201);
    const p2 = ((await again.json()) as { project: { id: string; name: string; inquiryId: string } }).project;
    ledger.add({ kind: "project", id: p2.id, orgSlug: run.testOrg.slug, label: p2.name });
    expect(p2.inquiryId).toBe(inqId);
  });

  test("visibility: external users list only their company's inquiries; scope=mine filters by creator; company forced on create", async ({ as, f, run, ledger, url }) => {
    const distCo = await distributorCompanyId({ run, as });
    const otherCo = await f.externalCompany();
    const base = nm({ run }, "vis");
    const mk = async (suffix: string, extra: Record<string, unknown>, who = as.admin) => {
      const r = await createLedgered(who, { run, ledger }, "inquiry", { name: `${base}-${suffix}`, currency: "AED", ...extra });
      expect(r.res.status(), JSON.stringify(r.body)).toBe(201);
      return r.body.inquiry as Inquiry;
    };
    const own = await mk("own", { externalCompanyId: distCo });
    const foreign = await mk("other", { externalCompanyId: otherCo.id });
    const none = await mk("none", {});
    // a distributor cannot pick another company: the session's company wins (defense in depth)
    const byDist = await mk("bydist", { externalCompanyId: otherCo.id }, as.distributor);
    expect(byDist.externalCompanyId).toBe(distCo);
    expect(byDist.createdByUserId).toBe(run.users.distributor.id);

    const q = (extra = "") => url(`/inquiries?search=${encodeURIComponent(base)}${extra}`);
    const sorted = (xs: string[]) => [...xs].sort();
    expect(sorted(await listIds(as.distributor, q(), "inquiries"))).toEqual(sorted([own.id, byDist.id]));
    expect(sorted(await listIds(as.architect, q(), "inquiries"))).toEqual(sorted([own.id, byDist.id])); // same company
    expect(sorted(await listIds(as.member, q(), "inquiries"))).toEqual(sorted([own.id, foreign.id, none.id, byDist.id]));
    // external users cannot widen their scope with the externalCompanyId filter
    expect(sorted(await listIds(as.distributor, q(`&externalCompanyId=${otherCo.id}`), "inquiries"))).toEqual(sorted([own.id, byDist.id]));
    // internal users can narrow by company
    expect(await listIds(as.member, q(`&externalCompanyId=${otherCo.id}`), "inquiries")).toEqual([foreign.id]);
    // scope=mine → creator only, for every user type
    expect(sorted(await listIds(as.admin, q("&scope=mine"), "inquiries"))).toEqual(sorted([own.id, foreign.id, none.id]));
    expect(await listIds(as.distributor, q("&scope=mine"), "inquiries")).toEqual([byDist.id]);
    expect(await listIds(as.architect, q("&scope=mine"), "inquiries")).toEqual([]);
    expect(await listIds(as.member, q("&scope=mine"), "inquiries")).toEqual([]);
  });

  // Hotfix 2026-10-05 (backlog "Cross-company access by id"): company ownership is applied on every by-id path.
  test("an external user cannot GET or PATCH another company's inquiry by id (404, like a missing id)", async ({ as, f, run, ledger, url }) => {
    const otherCo = await f.externalCompany();
    const { id, body } = await createLedgered(as.admin, { run, ledger }, "inquiry", { name: nm({ run }, "inq-idor"), currency: "AED", externalCompanyId: otherCo.id });
    expect(id, JSON.stringify(body)).not.toBeNull();
    const name = (body.inquiry as Inquiry).name;
    expect(await listIds(as.distributor, url(`/inquiries?search=${encodeURIComponent(name)}`), "inquiries")).toEqual([]);
    const r = await as.distributor.get(url(`/inquiries/${id}`));
    expect(r.status(), await r.text()).toBe(404);
    const ghost = await as.distributor.get(url(`/inquiries/${GHOST}`));
    expect(await r.json()).toEqual(await ghost.json());
    const p = await as.distributor.patch(url(`/inquiries/${id}`), { data: { name: `${name}-by-dist` } });
    expect(p.status(), await p.text()).toBe(404);
    const after = await as.admin.get(url(`/inquiries/${id}`)); // the rejected PATCH wrote nothing
    expect(((await after.json()) as { inquiry: Inquiry }).inquiry.name).toBe(name);
    expect((await as.member.get(url(`/inquiries/${id}`))).status()).toBe(200); // internal baseline
  });

  test("currency is validated: EUR is 400 on create and on PATCH (nothing created / changed); usd is stored as USD", async ({ as, f, run, ledger, url }) => {
    // Stage 31 S31-11: was accepted verbatim (backlog); the forms offer INR/AED/USD.
    const bad = await createLedgered(as.admin, { run, ledger }, "inquiry", { name: nm({ run }, "inq-eur"), currency: "eur" });
    expect(bad.res.status(), JSON.stringify(bad.body)).toBe(400);
    expect(bad.body).toEqual({ error: "currency must be one of INR, AED, USD" });
    const ok = await createLedgered(as.admin, { run, ledger }, "inquiry", { name: nm({ run }, "inq-usd"), currency: "usd" });
    expect(ok.res.status(), JSON.stringify(ok.body)).toBe(201);
    expect((ok.body.inquiry as Inquiry).currency).toBe("USD");

    const inq = await f.inquiry();
    const r = await as.admin.patch(url(`/inquiries/${inq.id}`), { data: { currency: "EUR" } });
    expect(r.status(), await r.text()).toBe(400);
    expect(await r.json()).toEqual({ error: "currency must be one of INR, AED, USD" });
    expect(((await json<{ inquiry: Inquiry }>(await as.admin.get(url(`/inquiries/${inq.id}`)))).inquiry).currency).toBe("AED");
    const u = await as.admin.patch(url(`/inquiries/${inq.id}`), { data: { currency: "usd" } });
    expect(u.status(), await u.text()).toBe(200);
    expect((await json<{ inquiry: Inquiry }>(u)).inquiry.currency).toBe("USD");
  });

  test("an unparseable date is 400 naming the field on create and on PATCH (nothing is created / changed)", async ({ as, f, run, ledger, url }) => {
    // Stage 31 S31-10: was a 500 (Invalid Date reached Prisma, backlog).
    const name = nm({ run }, "inq-baddate");
    const { res, body } = await createLedgered(as.admin, { run, ledger }, "inquiry", { name, currency: "AED", submissionDate: "not-a-date" });
    expect(res.status(), JSON.stringify(body)).toBe(400);
    expect(body).toEqual({ error: "submissionDate must be a valid date (YYYY-MM-DD)" });
    expect(await listIds(as.admin, url(`/inquiries?search=${encodeURIComponent(name)}`), "inquiries")).toEqual([]);

    const inq = await f.inquiry();
    const p = await as.admin.patch(url(`/inquiries/${inq.id}`), { data: { name: `${inq.name}-x`, projectDeadline: "2026-13-01" } });
    expect(p.status(), await p.text()).toBe(400);
    expect(await p.json()).toEqual({ error: "projectDeadline must be a valid date (YYYY-MM-DD)" });
    expect(((await json<{ inquiry: Inquiry }>(await as.admin.get(url(`/inquiries/${inq.id}`)))).inquiry).name).toBe(inq.name);
  });

  test("a JSON body that is not an object (null) is 400 on create and on PATCH (the inquiry is not dismissed)", async ({ as, f, url }) => {
    // Stage 31 S31-10: was a 500 (`body.name` read on null, backlog). On PATCH a `null` body used to reach the
    // dismiss path.
    const post = await as.admin.post(url("/inquiries"), { data: Buffer.from("null"), headers: { "Content-Type": "application/json" } });
    expect(post.status(), await post.text()).toBe(400);
    expect(await post.json()).toEqual({ error: "Request body must be a JSON object" });
    const inq = await f.inquiry();
    const patch = await as.admin.patch(url(`/inquiries/${inq.id}`), { data: Buffer.from("null"), headers: { "Content-Type": "application/json" } });
    expect(patch.status(), await patch.text()).toBe(400);
    expect(await patch.json()).toEqual({ error: "Request body must be a JSON object" });
    expect(((await json<{ inquiry: Inquiry }>(await as.admin.get(url(`/inquiries/${inq.id}`)))).inquiry).status).toBe("NEW");
  });
});
