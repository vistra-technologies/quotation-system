/**
 * Stage 19 — Floor/Project DELETE routes behavior-level E2E coverage.
 *
 * API-level only (page.request.* against apiUrl()) — no DOM/layout assertions,
 * per the workspace's UI-is-wireframe-stage rule and profile.md's "Testing
 * posture". Covers the two invariants called out in stage-19.md Batch 1:
 *   1. Floor-delete cascade correctness: deleting a floor removes its Rooms
 *      (and their Partitions) via DB cascade; the Floor itself is gone.
 *   2. Cross-tenant 403: a session belonging to org-A is refused when the
 *      orgSlug in the URL belongs to org-B — applies to both DELETE routes.
 *
 * Auth helper: reuses the apiSignIn() pattern established in stage18.spec.ts
 * (API-level sign-in with cookie re-injection) for the same reason documented
 * there — the browser-form flow is broken on ad-hoc *.vercel.app previews.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, isSubdomain, orgUrl, orgUrlPattern } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * API-level sign-in — bypasses the browser login form to work correctly
 * against ad-hoc *.vercel.app feature-branch previews (see stage18.spec.ts
 * for the full explanation of why the form-based flow doesn't work there).
 */
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
  if (!setCookie) {
    throw new Error(`apiSignIn(${username}@${orgSlug}): no Set-Cookie header in response`);
  }
  const sessionCookieLine = setCookie
    .split("\n")
    .find((line) => line.includes("session_token"));
  if (!sessionCookieLine) {
    throw new Error(
      `apiSignIn(${username}@${orgSlug}): no session_token cookie in Set-Cookie header(s): ${setCookie}`,
    );
  }
  const [nameValue] = sessionCookieLine.split(";");
  const eqIdx = nameValue.indexOf("=");
  const name = nameValue.slice(0, eqIdx);
  const value = decodeURIComponent(nameValue.slice(eqIdx + 1));

  const base = new URL(BASE_URL);
  const host = isSubdomain ? `.${base.hostname}` : base.hostname;

  await page.context().addCookies([
    {
      name,
      value,
      domain: host,
      path: "/",
      httpOnly: true,
      secure: base.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

let acmeCtx: BrowserContext;
let nordicCtx: BrowserContext;
let acmePage: Page;
let nordicPage: Page;

const RUN = Date.now();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  acmeCtx = await browser.newContext();
  nordicCtx = await browser.newContext();
  acmePage = await acmeCtx.newPage();
  nordicPage = await nordicCtx.newPage();

  await apiSignIn(acmePage, ACME, "admin");
  await apiSignIn(nordicPage, NORDIC, "admin");
});

test.afterAll(async () => {
  await acmeCtx.close();
  await nordicCtx.close();
});

// ---------------------------------------------------------------------------
// 1. Floor-delete cascade correctness
//    Deleting a floor must remove its Rooms (and their Partitions) via DB
//    cascade. The Floor itself must be gone afterward.
// ---------------------------------------------------------------------------

test("floor-delete cascade: deleting a floor removes its rooms (and their partitions)", async () => {
  // Create a project to own the floor.
  const projRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`),
    { data: { name: `Stage19 Floor-Cascade ${RUN}`, currency: "AED" } },
  );
  expect(projRes.status()).toBe(201);
  const { project: { id: projectId } } = (await projRes.json()) as {
    project: { id: string };
  };

  // Create a Floor under the project.
  const floorRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors`),
    { data: { projectId, label: `Ground ${RUN}` } },
  );
  expect(floorRes.status()).toBe(201);
  const { floor: { id: floorId } } = (await floorRes.json()) as {
    floor: { id: string };
  };

  // Create a Room inside the floor.
  const roomRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms`),
    { data: { floorId, label: `Room A ${RUN}` } },
  );
  expect(roomRes.status()).toBe(201);
  const { room: { id: roomId } } = (await roomRes.json()) as {
    room: { id: string };
  };

  // Sanity: the room is visible before the delete.
  const roomsBeforeRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  expect(roomsBeforeRes.status()).toBe(200);
  const { rooms: roomsBefore } = (await roomsBeforeRes.json()) as { rooms: { id: string }[] };
  expect(roomsBefore.some((r) => r.id === roomId)).toBe(true);

  // DELETE the floor.
  const deleteRes = await acmePage.request.delete(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors/${floorId}`),
  );
  expect(deleteRes.status()).toBe(200);
  const deleteBody = (await deleteRes.json()) as { ok: boolean };
  expect(deleteBody.ok).toBe(true);

  // Room list for the (now-deleted) floor must be empty — cascade worked.
  const roomsAfterRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms?floorId=${floorId}`),
  );
  expect(roomsAfterRes.status()).toBe(200);
  const { rooms: roomsAfter } = (await roomsAfterRes.json()) as { rooms: unknown[] };
  expect(roomsAfter).toEqual([]);

  // A second DELETE on the same floor returns 404 (idempotency / gone).
  const deleteAgainRes = await acmePage.request.delete(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors/${floorId}`),
  );
  expect(deleteAgainRes.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// 2. Cross-tenant 403: a session for org-A hitting org-B's DELETE routes
//    must be refused at getApiSession()'s cross-tenant guard (before any DAL
//    logic), returning 403 rather than 404 or 200.
// ---------------------------------------------------------------------------

test("cross-tenant 403 on floor-delete and project-delete when orgSlug does not match session org", async () => {
  // Use a plausible-but-fake UUID — we expect 403 from the session guard,
  // never 404 from the DAL (the guard fires first).
  const fakeId = "00000000-0000-0000-0000-000000000001";

  // ACME session against NORDIC's floors DELETE — must 403.
  const floorCrossRes = await acmePage.request.delete(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/floors/${fakeId}`),
  );
  expect(floorCrossRes.status()).toBe(403);

  // ACME session against NORDIC's projects DELETE — must 403.
  const projectCrossRes = await acmePage.request.delete(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/projects/${fakeId}`),
  );
  expect(projectCrossRes.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 3–5. Step-gating (Stage 19 Batch 4)
//
// Navigation-level tests: page.goto() follows any redirect; final page.url()
// is compared with orgUrlPattern() to distinguish "landed on expected page"
// (accessible) from "landed elsewhere" (redirected away).
//
// No DOM assertions — wireframe-stage rule. Behavior being locked in:
//   - Configuration is always accessible (it is WHERE Selections are added).
//   - Design is locked until ≥1 Selection exists on the project.
//   - Summary and Quotation are locked until ≥1 Partition exists on the project.
// ---------------------------------------------------------------------------

test("step-gating: fresh project — /configuration accessible, /design /summary /quotation redirect", async () => {
  // Create a fresh project with no Selections or Partitions.
  const projRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`),
    { data: { name: `Stage19 StepGate Fresh ${RUN}`, currency: "AED" } },
  );
  expect(projRes.status()).toBe(201);
  const { project: { id: freshProjectId } } = (await projRes.json()) as {
    project: { id: string };
  };

  // Configuration — always unlocked; navigating to it must NOT redirect.
  await acmePage.goto(orgUrl(ACME, `/projects/${freshProjectId}/configuration`));
  expect(acmePage.url()).toMatch(
    orgUrlPattern(ACME, `/projects/${freshProjectId}/configuration`),
  );

  // Design — must redirect away when selectionCount === 0.
  await acmePage.goto(orgUrl(ACME, `/projects/${freshProjectId}/design`));
  expect(acmePage.url()).not.toMatch(
    orgUrlPattern(ACME, `/projects/${freshProjectId}/design`),
  );

  // Summary — must redirect away when partitionCount === 0.
  await acmePage.goto(orgUrl(ACME, `/projects/${freshProjectId}/summary`));
  expect(acmePage.url()).not.toMatch(
    orgUrlPattern(ACME, `/projects/${freshProjectId}/summary`),
  );

  // Quotation — must redirect away when partitionCount === 0.
  await acmePage.goto(orgUrl(ACME, `/projects/${freshProjectId}/quotation`));
  expect(acmePage.url()).not.toMatch(
    orgUrlPattern(ACME, `/projects/${freshProjectId}/quotation`),
  );
});

test("step-gating: after adding a Selection — /design becomes reachable", async () => {
  // Create a fresh project.
  const projRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`),
    { data: { name: `Stage19 StepGate WithSel ${RUN}`, currency: "AED" } },
  );
  expect(projRes.status()).toBe(201);
  const { project: { id: projectId } } = (await projRes.json()) as {
    project: { id: string };
  };

  // Look up a ComponentType to attach the Selection to.
  const ctRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`),
  );
  expect(ctRes.status()).toBe(200);
  const { componentTypes } = (await ctRes.json()) as {
    componentTypes: { id: string }[];
  };
  expect(componentTypes.length).toBeGreaterThan(0);

  // Add one Selection.
  const selRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/selections`),
    {
      data: {
        projectId,
        componentTypeId: componentTypes[0].id,
        label: `Sel ${RUN}`,
        config: {},
        orderIndex: 0,
      },
    },
  );
  expect(selRes.status()).toBe(201);

  // /design must now be reachable (selectionCount ≥ 1).
  await acmePage.goto(orgUrl(ACME, `/projects/${projectId}/design`));
  expect(acmePage.url()).toMatch(
    orgUrlPattern(ACME, `/projects/${projectId}/design`),
  );
});

test("step-gating: project with Selections and Partitions — all wizard pages reachable", async () => {
  // Create a project.
  const projRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`),
    { data: { name: `Stage19 StepGate Full ${RUN}`, currency: "AED" } },
  );
  expect(projRes.status()).toBe(201);
  const { project: { id: projectId } } = (await projRes.json()) as {
    project: { id: string };
  };

  // Look up a ComponentType for the Selection.
  const ctRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`),
  );
  expect(ctRes.status()).toBe(200);
  const { componentTypes } = (await ctRes.json()) as {
    componentTypes: { id: string }[];
  };
  expect(componentTypes.length).toBeGreaterThan(0);

  // Add a Selection.
  const selRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/selections`),
    {
      data: {
        projectId,
        componentTypeId: componentTypes[0].id,
        label: `Sel Full ${RUN}`,
        config: {},
        orderIndex: 0,
      },
    },
  );
  expect(selRes.status()).toBe(201);

  // Add a Floor.
  const floorRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors`),
    { data: { projectId, label: `Floor Full ${RUN}` } },
  );
  expect(floorRes.status()).toBe(201);
  const { floor: { id: floorId } } = (await floorRes.json()) as {
    floor: { id: string };
  };

  // Add a Room inside the Floor.
  const roomRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms`),
    { data: { floorId, label: `Room Full ${RUN}` } },
  );
  expect(roomRes.status()).toBe(201);
  const { room: { id: roomId } } = (await roomRes.json()) as {
    room: { id: string };
  };

  // Convert one side to PARTITION — this creates a Partition record in the DB.
  // isClosed: false because a single-side open run bypasses the ≥3-sides
  // validation that applies only to closed rooms (Stage 18 §2).
  const sidesRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/rooms/${roomId}/sides`),
    {
      data: {
        isClosed: false,
        sides: [
          {
            kind: "PARTITION",
            turnDegrees: 90,
            label: `Wall Full ${RUN}`,
            heightMm: 2400,
            widthMm: 1200,
          },
        ],
      },
    },
  );
  expect(sidesRes.status()).toBe(200);

  // All three previously-locked pages must now be reachable (no redirect).
  await acmePage.goto(orgUrl(ACME, `/projects/${projectId}/design`));
  expect(acmePage.url()).toMatch(
    orgUrlPattern(ACME, `/projects/${projectId}/design`),
  );

  await acmePage.goto(orgUrl(ACME, `/projects/${projectId}/summary`));
  expect(acmePage.url()).toMatch(
    orgUrlPattern(ACME, `/projects/${projectId}/summary`),
  );

  await acmePage.goto(orgUrl(ACME, `/projects/${projectId}/quotation`));
  expect(acmePage.url()).toMatch(
    orgUrlPattern(ACME, `/projects/${projectId}/quotation`),
  );
});

// ---------------------------------------------------------------------------
// 6. Project-DELETE: cascade correctness + Inquiry reversion
//   (Stage 19 test-fix batch 1 — N1: profile.md's "Testing posture" names these
//   as invariants to automate; previously only manually verified by the tester
//   via curl+DB, per bugs-1.md. API-level only, no DOM assertions — wireframe-
//   stage rule.)
//
//   NOT automated here: the "non-DRAFT project -> 409" gate. There is
//   currently no product-level way to move a Project out of DRAFT status
//   through the public API (the BOQ/quotation/order pipeline that would do
//   this isn't built yet — every project-creation path in the app only ever
//   sets status: "DRAFT", confirmed via grep across lib/data/). The tester's
//   manual verification of the 409 path (bugs-1.md N1) relied on direct DB
//   access to force a non-DRAFT row. Automating that would mean adding a
//   first-ever direct Prisma/DB dependency into tests/e2e/ (no existing spec
//   does this) purely to construct a state the app itself cannot reach yet —
//   judged out of proportion for this discretionary item. Revisit once a
//   real status transition exists (e.g. Quotation issuance).
// ---------------------------------------------------------------------------

test("project-delete: DRAFT project cascade-deletes and reverts its source Inquiry to NEW", async () => {
  // Create an Inquiry, then convert it to a project (DRAFT, linked via inquiryId).
  const inqRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/inquiries`),
    { data: { name: `Stage19 DeleteCascade Inquiry ${RUN}`, currency: "AED" } },
  );
  expect(inqRes.status()).toBe(201);
  const { inquiry: { id: inquiryId } } = (await inqRes.json()) as {
    inquiry: { id: string };
  };

  const convertRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/inquiries/${inquiryId}/convert`),
  );
  expect(convertRes.status()).toBe(201);
  const { project: { id: projectId } } = (await convertRes.json()) as {
    project: { id: string };
  };

  // Add a Selection and a Floor so the cascade has real children to remove.
  const ctRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`),
  );
  expect(ctRes.status()).toBe(200);
  const { componentTypes } = (await ctRes.json()) as {
    componentTypes: { id: string }[];
  };
  expect(componentTypes.length).toBeGreaterThan(0);

  const selRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/selections`),
    {
      data: {
        projectId,
        componentTypeId: componentTypes[0].id,
        label: `Sel DeleteCascade ${RUN}`,
        config: {},
        orderIndex: 0,
      },
    },
  );
  expect(selRes.status()).toBe(201);

  const floorRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors`),
    { data: { projectId, label: `Floor DeleteCascade ${RUN}` } },
  );
  expect(floorRes.status()).toBe(201);

  // Delete the (still-DRAFT) project.
  const deleteRes = await acmePage.request.delete(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`),
  );
  expect(deleteRes.status()).toBe(200);

  // Project itself is gone.
  const getProjectRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/projects/${projectId}`),
  );
  expect(getProjectRes.status()).toBe(404);

  // Its Selections and Floors are gone (cascade).
  const selectionsAfterRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/selections?projectId=${projectId}`),
  );
  expect(selectionsAfterRes.status()).toBe(200);
  const { selections: selectionsAfter } = (await selectionsAfterRes.json()) as {
    selections: unknown[];
  };
  expect(selectionsAfter).toEqual([]);

  const floorsAfterRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/floors?projectId=${projectId}`),
  );
  expect(floorsAfterRes.status()).toBe(200);
  const { floors: floorsAfter } = (await floorsAfterRes.json()) as {
    floors: unknown[];
  };
  expect(floorsAfter).toEqual([]);

  // The source Inquiry reverted CONVERTED → NEW.
  const inquiryAfterRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/inquiries/${inquiryId}`),
  );
  expect(inquiryAfterRes.status()).toBe(200);
  const { inquiry: inquiryAfter } = (await inquiryAfterRes.json()) as {
    inquiry: { status: string };
  };
  expect(inquiryAfter.status).toBe("NEW");
});
