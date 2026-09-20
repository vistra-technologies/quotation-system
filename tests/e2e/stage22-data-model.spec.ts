/**
 * Stage 22 — Data model foundations E2E coverage (`Partition.design` v2, `Project.configSnapshot`,
 * `designSubmittedAt` clear-on-edit). Covers batch-7-tests-docs.md's E1-E10.
 *
 * API-level only (page.request.get/post/patch against apiUrl()), same posture as
 * tests/e2e/stage18.spec.ts — behavior-level invariants, not DOM/layout assertions (profile.md's
 * "Testing posture": priorities are behavioral for this data-model stage). E1/E2 ("loads in the
 * Design page -> displays correctly -> can be edited -> saves") are covered at the API boundary:
 * GET returns the raw stored v1 doc unmodified (normalization happens client-side at the fetch
 * boundary per D-6, which is outside this file's API-only scope), then a PATCH with a v2 body
 * (what the client's Save sends after editing the normalized panel view) proves the edit-and-save
 * path works end to end and the stored row becomes v2 — this is a deliberate scope choice, not a
 * silent gap; a full browser pass through the Design canvas is out of reach without a browser tool
 * in this dispatch (see the Stage 22 worklog).
 *
 * E3 (width-sum invariant across 3+ consecutive rescales) and E4 (door-with-transom saved
 * unchanged, no height drift) are NOT duplicated here — they are already covered by
 * tests/e2e/stage21-design.spec.ts's "width-sum invariant" test (UI-driven, add/split/unite/
 * rescale x3) and tests/e2e/stage18.spec.ts's "a heightMm change must keep every section's cell
 * heights summing to it" + "legitimate round-trip... derives widthMm from sections" tests
 * respectively (see batch-7-tests-docs.md's instruction not to duplicate existing coverage).
 *
 * v1 seeding (E1/E2) and the pre-backfill null-configSnapshot state (E7) use the direct-DB test
 * helper in tests/e2e/db-helpers.ts (B7 seeding decision, worklog GATE A 2026-09-19) — see that
 * file's header for why no API route can produce either state.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, isSubdomain } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";
import {
  seedV1Design,
  readPartitionRow,
  nullOutConfigSnapshot,
  readConfigSnapshot,
  deleteComponentType,
  closeTestDb,
} from "./db-helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();

// Same api-level sign-in workaround as stage18.spec.ts (feature-branch preview cookie-domain
// mismatch) — see that file's apiSignIn() doc comment for the full root-cause writeup.
async function apiSignIn(
  page: Page,
  orgSlug: string,
  username: string,
  password = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!",
) {
  let resp;
  for (let attempt = 1; attempt <= 4; attempt++) {
    resp = await page.request.post(apiUrl(orgSlug, "/api/auth/sign-in/email"), {
      data: { email: toAuthEmail(username, orgSlug), password },
    });
    if (resp.status() !== 429) break;
    if (attempt < 4) {
      const retryAfterSec = Number(resp.headers()["x-retry-after"] ?? "10");
      await new Promise((resolve) => setTimeout(resolve, (retryAfterSec + 1) * 1_000));
    }
  }
  if (!resp || !resp.ok()) {
    throw new Error(
      `apiSignIn(${username}@${orgSlug}) failed: ${resp?.status()} ${resp ? await resp.text() : ""}`,
    );
  }
  const setCookie = resp.headers()["set-cookie"];
  if (!setCookie) throw new Error(`apiSignIn(${username}@${orgSlug}): no Set-Cookie header`);
  const sessionCookieLine = setCookie.split("\n").find((line) => line.includes("session_token"));
  if (!sessionCookieLine) {
    throw new Error(`apiSignIn(${username}@${orgSlug}): no session_token cookie in: ${setCookie}`);
  }
  const [nameValue] = sessionCookieLine.split(";");
  const eqIdx = nameValue.indexOf("=");
  const name = nameValue.slice(0, eqIdx);
  const value = decodeURIComponent(nameValue.slice(eqIdx + 1));
  const base = new URL(BASE_URL);
  const host = isSubdomain ? `.${base.hostname}` : base.hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/", httpOnly: true, secure: base.protocol === "https:", sameSite: "Lax" },
  ]);
}

let acmeCtx: BrowserContext;
let nordicCtx: BrowserContext;
let acmePage: Page;
let nordicPage: Page;

// Fixtures for the v1/v2 partition tests (E1, E2).
let v1ProjectId: string;
let v1PartitionId: string;
let v1GlassSelectionId: string;

// Fixtures for the configSnapshot tests (E5, E6, E7, E8, E10).
let acmeCategoryId: string;

// E6 creates a real ComponentType with no delete API (review-9 #2) — tracked here so afterAll can
// remove it directly (test-only teardown; no Selection is ever created against it, see the
// db-helpers.deleteComponentType doc comment for why that's FK-safe).
let e6ComponentTypeId: string | undefined;

// Projects created by this suite — deleted in afterAll (tester pass: the suite previously left
// every "Stage22 ..." project behind on the shared dev DB).
const createdProjects: { orgSlug: string; page: Page; id: string }[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  acmeCtx = await browser.newContext();
  nordicCtx = await browser.newContext();
  acmePage = await acmeCtx.newPage();
  nordicPage = await nordicCtx.newPage();
  await apiSignIn(acmePage, ACME, "admin");
  await apiSignIn(nordicPage, NORDIC, "admin");

  const cats = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-categories`));
  expect(cats.status()).toBe(200);
  const { categories } = (await cats.json()) as {
    categories: { id: string }[];
  };
  acmeCategoryId = categories[0].id;
});

test.afterAll(async () => {
  for (const p of createdProjects) {
    await p.page.request.delete(apiUrl(p.orgSlug, `/api/v1/orgs/${p.orgSlug}/projects/${p.id}`)).catch(() => {});
  }
  if (e6ComponentTypeId) {
    await deleteComponentType(e6ComponentTypeId);
  }
  await acmeCtx.close();
  await nordicCtx.close();
  await closeTestDb();
});

async function componentTypeId(page: Page, orgSlug: string, code: string): Promise<string> {
  const res = await page.request.get(apiUrl(orgSlug, `/api/v1/orgs/${orgSlug}/component-types`));
  expect(res.status()).toBe(200);
  const { componentTypes } = (await res.json()) as { componentTypes: { id: string; code: string }[] };
  const found = componentTypes.find((c) => c.code === code);
  if (!found) throw new Error(`No seeded ComponentType with code ${code} in ${orgSlug}`);
  return found.id;
}

async function createProject(
  page: Page,
  orgSlug: string,
  name: string,
): Promise<string> {
  const res = await page.request.post(apiUrl(orgSlug, `/api/v1/orgs/${orgSlug}/projects`), {
    data: { name, currency: orgSlug === NORDIC ? "USD" : "AED" },
  });
  expect(res.status()).toBe(201);
  const { project } = (await res.json()) as { project: { id: string } };
  createdProjects.push({ orgSlug, page, id: project.id });
  return project.id;
}

// ---------------------------------------------------------------------------
// E1, E2 — v1 partition loads/edits/saves; the stored row becomes v2.
// ---------------------------------------------------------------------------

test("E1/E2: a v1 partition round-trips through the API and is stored as v2 after Save", async () => {
  v1ProjectId = await createProject(acmePage, ACME, `Stage22 v1v2 ${RUN}`);
  const floorRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/floors`), {
    data: { projectId: v1ProjectId, label: `Ground ${RUN}` },
  });
  expect(floorRes.status()).toBe(201);
  const { floor: { id: floorId } } = (await floorRes.json()) as { floor: { id: string } };
  const roomRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms`), {
    data: { floorId, label: `Room v1v2 ${RUN}` },
  });
  expect(roomRes.status()).toBe(201);
  const { room: { id: roomId } } = (await roomRes.json()) as { room: { id: string } };

  const convertRes = await acmePage.request.patch(apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `Wall v1v2 ${RUN}`, heightMm: 2400, widthMm: 1900 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  expect(convertRes.status()).toBe(200);
  const { room } = (await convertRes.json()) as { room: { sides: { partitionId?: string }[] } };
  v1PartitionId = room.sides[0].partitionId!;

  const glassTypeId = await componentTypeId(acmePage, ACME, "GLASS");
  const selRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/selections`), {
    data: { projectId: v1ProjectId, componentTypeId: glassTypeId, label: `Glass v1v2 ${RUN}`, config: {}, orderIndex: 0 },
  });
  expect(selRes.status()).toBe(201);
  v1GlassSelectionId = ((await selRes.json()) as { selection: { id: string } }).selection.id;

  // Overwrite with a raw v1 doc directly in Postgres — the only way to produce one since Batch 1
  // rejects `panels` PATCH bodies (D-8). Two glass panels summing to the partition's own widthMm.
  await seedV1Design(v1PartitionId, {
    panels: [
      { id: "v1-p1", type: "glass", widthMm: 1000, heightMm: 2400, selectionId: v1GlassSelectionId },
      { id: "v1-p2", type: "glass", widthMm: 900, heightMm: 2400, selectionId: null },
    ],
  });

  // "loads" — GET returns the raw v1 doc unmodified (server never rewrites on read).
  const preRow = await readPartitionRow(v1PartitionId);
  expect((preRow.design as { panels?: unknown[] }).panels).toHaveLength(2);
  expect((preRow.design as { schemaVersion?: number }).schemaVersion).toBeUndefined();

  const getRes = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions/${v1PartitionId}`));
  expect(getRes.status()).toBe(200);
  const { partition: fetched } = (await getRes.json()) as {
    partition: { design: { panels?: unknown[]; schemaVersion?: number } };
  };
  expect(fetched.design.panels).toHaveLength(2);
  expect(fetched.design.schemaVersion).toBeUndefined();

  // "can be edited -> saves without error" — the client normalizes this v1 doc into the panel
  // view, the user edits it, and Save serializes via panelsToV2 (lib/partition-design.ts); here
  // we send the equivalent v2 PATCH body directly (an edit: second panel now has a selection).
  const patchRes = await acmePage.request.patch(apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions/${v1PartitionId}`), {
    data: {
      design: {
        schemaVersion: 2,
        sections: [
          { id: "v1-p1", widthMm: 1000, cells: [{ id: "v1-p1-c", heightMm: 2400, selectionId: v1GlassSelectionId }] },
          { id: "v1-p2", widthMm: 900, cells: [{ id: "v1-p2-c", heightMm: 2400, selectionId: v1GlassSelectionId }] },
        ],
      },
    },
  });
  expect(patchRes.status()).toBe(200);

  // E2: the raw row now confirms schemaVersion 2 (queried directly, not via the API, per E2's
  // literal wording — "querying the raw row confirms schemaVersion: 2 is present").
  const postRow = await readPartitionRow(v1PartitionId);
  const postDesign = postRow.design as { schemaVersion?: number; panels?: unknown; sections?: unknown[] };
  expect(postDesign.schemaVersion).toBe(2);
  expect(postDesign.panels).toBeUndefined();
  expect(postDesign.sections).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// E5, E6, E8, E10 — configSnapshot: written at creation, frozen, tenant-scoped,
// never in list payloads.
// ---------------------------------------------------------------------------

test("E5/E8/E10: a new project's configSnapshot has the org's own ComponentTypes with id/code/fieldsSchema/fieldOptionsConfig, and never appears in the list payload", async () => {
  const acmeProjectId = await createProject(acmePage, ACME, `Stage22 snapshot ACME ${RUN}`);
  const nordicProjectId = await createProject(nordicPage, NORDIC, `Stage22 snapshot NORDIC ${RUN}`);

  const acmeDetail = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${acmeProjectId}`));
  expect(acmeDetail.status()).toBe(200);
  const { project: acmeProject } = (await acmeDetail.json()) as {
    project: {
      configSnapshot: {
        takenAt: string;
        componentTypes: Array<{ id: string; code: string; fieldsSchema: unknown; fieldOptionsConfig: unknown }>;
      } | null;
    };
  };
  expect(acmeProject.configSnapshot).not.toBeNull();
  expect(acmeProject.configSnapshot!.componentTypes.length).toBeGreaterThan(0);
  for (const key of ["id", "code", "fieldsSchema", "fieldOptionsConfig"] as const) {
    expect(acmeProject.configSnapshot!.componentTypes[0]).toHaveProperty(key);
  }

  // E8 tenancy: NORDIC's snapshot never contains an ACME code, and vice versa.
  const nordicDetail = await nordicPage.request.get(apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/projects/${nordicProjectId}`));
  expect(nordicDetail.status()).toBe(200);
  const { project: nordicProject } = (await nordicDetail.json()) as {
    project: { configSnapshot: { componentTypes: Array<{ id: string; code: string }> } | null };
  };
  expect(nordicProject.configSnapshot).not.toBeNull();
  const acmeIds = new Set(acmeProject.configSnapshot!.componentTypes.map((c) => c.id));
  const nordicIds = new Set(nordicProject.configSnapshot!.componentTypes.map((c) => c.id));
  expect([...acmeIds].some((id) => nordicIds.has(id))).toBe(false);

  // E10: the org's project-list endpoint never includes configSnapshot in any row.
  const listRes = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`));
  expect(listRes.status()).toBe(200);
  const listBody = (await listRes.text());
  expect(listBody).not.toContain("configSnapshot");
});

test("E6: freeze holds — a ComponentType added to the org after project creation does not appear on that project's snapshot", async () => {
  const projectId = await createProject(acmePage, ACME, `Stage22 freeze ${RUN}`);
  const before = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`));
  const { project: beforeProject } = (await before.json()) as {
    project: { configSnapshot: { componentTypes: Array<{ code: string }> } | null };
  };
  const codeBefore = beforeProject.configSnapshot!.componentTypes.map((c) => c.code);

  const newCode = `E2E_${RUN}`;
  const createTypeRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`), {
    data: {
      code: newCode,
      name: `Stage22 Freeze Type ${RUN}`,
      categoryId: acmeCategoryId,
      fieldsSchema: [],
      active: true,
    },
  });
  expect(createTypeRes.status()).toBe(201);
  const { componentType: createdType } = (await createTypeRes.json()) as { componentType: { id: string } };
  e6ComponentTypeId = createdType.id;

  // Reload the SAME project's detail — its snapshot must still be exactly what it was.
  const after = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`));
  const { project: afterProject } = (await after.json()) as {
    project: { configSnapshot: { componentTypes: Array<{ code: string }> } | null };
  };
  const codeAfter = afterProject.configSnapshot!.componentTypes.map((c) => c.code);
  expect(codeAfter).toEqual(codeBefore);
  expect(codeAfter).not.toContain(newCode);

  // The live component-types list DOES show it (proves the freeze is specific to the snapshot,
  // not e.g. an unrelated caching bug hiding the new type everywhere).
  const liveRes = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`));
  const { componentTypes: live } = (await liveRes.json()) as { componentTypes: Array<{ code: string }> };
  expect(live.map((c) => c.code)).toContain(newCode);
});

// ---------------------------------------------------------------------------
// E7 — null-guard: a project with configSnapshot = null still works.
// ---------------------------------------------------------------------------

test("E7: null-guard — a project with configSnapshot forced to NULL still returns 200 from the detail route", async () => {
  const projectId = await createProject(acmePage, ACME, `Stage22 nullguard ${RUN}`);
  await nullOutConfigSnapshot(projectId);

  const snapshot = await readConfigSnapshot(projectId);
  expect(snapshot).toBeNull();

  // The Configuration page's own null-guard branch (configuration/page.tsx) falls back to a live
  // component-types read when this is null — verified at the DAL/route boundary here (no browser
  // tool in this dispatch to load the page itself): the detail route must not 500 or omit the
  // project just because configSnapshot is null.
  const res = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`));
  expect(res.status()).toBe(200);
  const { project } = (await res.json()) as { project: { configSnapshot: unknown } };
  expect(project.configSnapshot).toBeNull();
});

// ---------------------------------------------------------------------------
// E9 — designSubmittedAt clears on a geometry-affecting partition edit.
// ---------------------------------------------------------------------------

test("E9: editing a partition design on a submitted project clears designSubmittedAt", async () => {
  const projectId = await createProject(acmePage, ACME, `Stage22 submit ${RUN}`);
  const floorRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/floors`), {
    data: { projectId, label: `Ground ${RUN}` },
  });
  const { floor: { id: floorId } } = (await floorRes.json()) as { floor: { id: string } };
  const roomRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms`), {
    data: { floorId, label: `Room submit ${RUN}` },
  });
  const { room: { id: roomId } } = (await roomRes.json()) as { room: { id: string } };
  const convertRes = await acmePage.request.patch(apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomId}/sides`), {
    data: {
      sides: [
        { kind: "PARTITION", turnDegrees: 90, label: `Wall submit ${RUN}`, heightMm: 2400, widthMm: 1000 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
        { kind: "PLAIN", turnDegrees: 90 },
      ],
    },
  });
  const { room } = (await convertRes.json()) as { room: { sides: { partitionId?: string }[] } };
  const partitionId = room.sides[0].partitionId!;

  const submitRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}/submit-design`),
  );
  expect(submitRes.status()).toBe(200);

  const afterSubmit = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`));
  const { project: submitted } = (await afterSubmit.json()) as { project: { designSubmittedAt: string | null } };
  expect(submitted.designSubmittedAt).not.toBeNull();

  // A label-only PATCH (no design, no heightMm) must NOT clear the flag.
  const labelRes = await acmePage.request.patch(apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions/${partitionId}`), {
    data: { label: `Wall submit renamed ${RUN}` },
  });
  expect(labelRes.status()).toBe(200);
  const afterLabel = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`));
  const { project: afterLabelProject } = (await afterLabel.json()) as { project: { designSubmittedAt: string | null } };
  expect(afterLabelProject.designSubmittedAt).toBe(submitted.designSubmittedAt);

  // A geometry-affecting PATCH (design present) clears it.
  const geometryRes = await acmePage.request.patch(apiUrl(ACME, `/api/v1/orgs/${ACME}/partitions/${partitionId}`), {
    data: {
      design: {
        schemaVersion: 2,
        sections: [{ id: "sec-submit", widthMm: 1000, cells: [{ id: "cell-submit", heightMm: 2400, selectionId: null }] }],
      },
    },
  });
  expect(geometryRes.status()).toBe(200);
  const afterGeometry = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`));
  const { project: afterGeometryProject } = (await afterGeometry.json()) as { project: { designSubmittedAt: string | null } };
  expect(afterGeometryProject.designSubmittedAt).toBeNull();
});
