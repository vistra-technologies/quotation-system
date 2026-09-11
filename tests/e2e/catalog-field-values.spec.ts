/**
 * Stage 20 Batch 3 — Catalog (org-admin field-values) behavior-level E2E coverage.
 *
 * API-level only (page.request.* against apiUrl()) — no DOM/layout assertions, per the
 * workspace's UI-is-wireframe-stage rule (CLAUDE.md §5) and stage-20.md's Testing posture, which
 * calls out exactly the invariants covered here:
 *   1. Cross-org tenancy on the Catalog PUT — org A cannot write org B's ComponentTypeOrgConfig.
 *   2. 403 without MANAGE_FEATURES on both the API (GET + PUT) and the page itself.
 *   3. PUT server-side validation: unknown field key, non-choice-field key, and an explicit
 *      "dependsOn" in the payload are each rejected 400 (defense in depth — the UI never sends
 *      dependsOn, but a hand-rolled payload might).
 *
 * Auth helper: apiSignIn() — same API-level sign-in + cookie-injection pattern established in
 * stage18.spec.ts/stage19.spec.ts (the browser-form flow is broken on ad-hoc *.vercel.app
 * previews; this bypasses it). A separate distributor sign-in covers the no-MANAGE_FEATURES case
 * (Distributor role has DESIGN/QUOTE/ORDER only — lib/org-role-defaults.ts).
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, isSubdomain, orgUrl, orgUrlPattern } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const NORDIC = "nordic-walls";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();

/**
 * API-level sign-in — bypasses the browser login form (see stage18/19.spec.ts for why).
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
  const sessionCookieLine = setCookie.split("\n").find((line) => line.includes("session_token"));
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
let distributorCtx: BrowserContext;
let acmePage: Page;
let nordicPage: Page;
let distributorPage: Page;

let acmeTypeId: string;
let acmeDropdownKey: string;
let chainTypeId: string;
const CATEGORY_KEY = `category${RUN}`;
const GLASS_TYPE_KEY = `glassType${RUN}`;
const THICKNESS_KEY = `thickness${RUN}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  acmeCtx = await browser.newContext();
  nordicCtx = await browser.newContext();
  distributorCtx = await browser.newContext();
  acmePage = await acmeCtx.newPage();
  nordicPage = await nordicCtx.newPage();
  distributorPage = await distributorCtx.newPage();

  await apiSignIn(acmePage, ACME, "admin");
  await apiSignIn(nordicPage, NORDIC, "admin");
  await apiSignIn(distributorPage, ACME, "distributor");

  // Create a throwaway ComponentType (acme-glass) with one dropdown field, owned by this spec —
  // avoids depending on / mutating the shared seeded GLASS/DOOR/PROFILE_STOP types that other
  // batches' tests also touch.
  const catRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-categories`),
  );
  expect(catRes.status()).toBe(200);
  const { categories } = (await catRes.json()) as { categories: { id: string }[] };
  expect(categories.length).toBeGreaterThan(0);
  const categoryId = categories[0].id;

  acmeDropdownKey = `catalogKey${RUN}`;
  const createRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`),
    {
      data: {
        code: `SA_E2E_CATALOG_${RUN}`,
        name: `Catalog E2E ${RUN}`,
        categoryId,
        fieldsSchema: [
          { key: acmeDropdownKey, label: "Catalog Field", type: "dropdown", required: false, basic: true },
        ],
      },
    },
  );
  expect(createRes.status()).toBe(201);
  const { componentType } = (await createRes.json()) as { componentType: { id: string } };
  acmeTypeId = componentType.id;

  // A second throwaway type: a 2-hop dependsOn chain (Category -> Glass Type -> Thickness),
  // mirroring the design doc's own canonical example (04-data-model.md) — backs the
  // multi-hop round-trip test below (review-B3 CRITICAL #1).
  const chainCreateRes = await acmePage.request.post(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`),
    {
      data: {
        code: `SA_E2E_CHAIN_${RUN}`,
        name: `Catalog Chain E2E ${RUN}`,
        categoryId,
        fieldsSchema: [
          { key: CATEGORY_KEY, label: "Category", type: "dropdown", required: false, basic: true },
          {
            key: GLASS_TYPE_KEY,
            label: "Glass Type",
            type: "dropdown",
            required: false,
            basic: true,
            dependsOn: CATEGORY_KEY,
          },
          {
            key: THICKNESS_KEY,
            label: "Thickness",
            type: "dropdown",
            required: false,
            basic: true,
            dependsOn: GLASS_TYPE_KEY,
          },
        ],
      },
    },
  );
  expect(chainCreateRes.status()).toBe(201);
  const { componentType: chainType } = (await chainCreateRes.json()) as {
    componentType: { id: string };
  };
  chainTypeId = chainType.id;
});

test.afterAll(async () => {
  await acmeCtx.close();
  await nordicCtx.close();
  await distributorCtx.close();
});

// ---------------------------------------------------------------------------
// 1. Cross-org tenancy: nordic-walls session cannot read/write acme-glass's
//    ComponentType via the field-values route.
// ---------------------------------------------------------------------------

test("cross-org tenancy: nordic-walls session cannot GET or PUT acme-glass's field-values", async () => {
  const getRes = await nordicPage.request.get(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/component-types/${acmeTypeId}/field-values`),
  );
  expect(getRes.status()).toBe(404);

  const putRes = await nordicPage.request.put(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/component-types/${acmeTypeId}/field-values`),
    { data: { fieldOptionsConfig: { [acmeDropdownKey]: { options: ["Hacked"] } } } },
  );
  expect(putRes.status()).toBe(404);

  // Confirm acme-glass's own config was not touched by the rejected cross-org PUT.
  const verifyRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
  );
  expect(verifyRes.status()).toBe(200);
  const { componentType } = (await verifyRes.json()) as {
    componentType: { fieldOptionsConfig: Record<string, unknown> | null };
  };
  expect(componentType.fieldOptionsConfig?.[acmeDropdownKey]).toBeUndefined();
});

// ---------------------------------------------------------------------------
// 2. Same-org, cross-URL-orgSlug guard: acme-glass session cannot hit the
//    route via a nordic-walls URL (the getApiSession cross-tenant guard fires
//    first — 403, never reaching the DAL).
// ---------------------------------------------------------------------------

test("cross-tenant 403: acme-glass session against nordic-walls's own field-values URL", async () => {
  const fakeId = "00000000-0000-0000-0000-000000000002";
  const res = await acmePage.request.get(
    apiUrl(NORDIC, `/api/v1/orgs/${NORDIC}/component-types/${fakeId}/field-values`),
  );
  expect(res.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 3. 403 without MANAGE_FEATURES — API (GET + PUT).
// ---------------------------------------------------------------------------

test("403 without MANAGE_FEATURES: distributor session on GET and PUT field-values API", async () => {
  const getRes = await distributorPage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
  );
  expect(getRes.status()).toBe(403);

  const putRes = await distributorPage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
    { data: { fieldOptionsConfig: {} } },
  );
  expect(putRes.status()).toBe(403);
});

// ---------------------------------------------------------------------------
// 4. 403 without MANAGE_FEATURES — the Catalog page itself redirects away.
// ---------------------------------------------------------------------------

test("403 without MANAGE_FEATURES: distributor navigating to the Catalog page is redirected away", async () => {
  await distributorPage.goto(orgUrl(ACME, "/admin/field-values"));
  await expect(distributorPage).not.toHaveURL(orgUrlPattern(ACME, "/admin/field-values"), {
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// 5. PUT validation: unknown key, non-choice-field key, explicit dependsOn.
// ---------------------------------------------------------------------------

test("PUT rejects a fieldOptionsConfig key not present in fieldsSchema", async () => {
  const res = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
    { data: { fieldOptionsConfig: { notAField: { options: ["x"] } } } },
  );
  expect(res.status()).toBe(400);
});

test("PUT rejects a fieldOptionsConfig entry that carries an explicit dependsOn", async () => {
  const res = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
    {
      data: {
        fieldOptionsConfig: {
          [acmeDropdownKey]: { options: ["A"], dependsOn: "someOtherField" },
        },
      },
    },
  );
  expect(res.status()).toBe(400);
});

test("PUT rejects a key naming a non-dropdown/radio field", async () => {
  // Add a plain "field" (free text) entry to the schema first via PATCH, then try to configure it.
  const patchRes = await acmePage.request.patch(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}`),
    {
      data: {
        fieldsSchema: [
          { key: acmeDropdownKey, label: "Catalog Field", type: "dropdown", required: false, basic: true },
          { key: `plainField${RUN}`, label: "Plain Field", type: "field", required: false, basic: true },
        ],
      },
    },
  );
  expect(patchRes.status()).toBe(200);

  const res = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
    { data: { fieldOptionsConfig: { [`plainField${RUN}`]: { options: ["x"] } } } },
  );
  expect(res.status()).toBe(400);
});

// ---------------------------------------------------------------------------
// 6. Happy path: a valid flat-field PUT round-trips through GET.
// ---------------------------------------------------------------------------

test("PUT with a valid flat options list round-trips through GET", async () => {
  const putRes = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
    { data: { fieldOptionsConfig: { [acmeDropdownKey]: { options: ["Red", "Blue"] } } } },
  );
  expect(putRes.status()).toBe(200);

  const getRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${acmeTypeId}/field-values`),
  );
  expect(getRes.status()).toBe(200);
  const { componentType } = (await getRes.json()) as {
    componentType: { fieldOptionsConfig: Record<string, { options?: string[] }> };
  };
  expect(componentType.fieldOptionsConfig[acmeDropdownKey]?.options).toEqual(["Red", "Blue"]);
});

// ---------------------------------------------------------------------------
// 7. Multi-hop chain round-trip (review-B3 CRITICAL #1 regression coverage).
//    A 2-hop dependsOn chain (Category -> Glass Type -> Thickness, the design
//    doc's own canonical example) must round-trip intact through PUT -> GET —
//    this is API-level coverage for the bug the editor UI previously had
//    (silently wiping the deepest level's data whose parent was itself
//    dependent). The API/DAL layer was never the bug, but this closes the gap
//    the original spec had no coverage of, per the reviewer's request.
// ---------------------------------------------------------------------------

test("PUT with a 2-hop dependsOn chain round-trips intact through GET", async () => {
  const fieldOptionsConfig = {
    [CATEGORY_KEY]: { options: ["Single", "Glazed"] },
    [GLASS_TYPE_KEY]: {
      valueMap: { Single: ["Clear", "Tinted"], Glazed: ["Low-E"] },
    },
    [THICKNESS_KEY]: {
      valueMap: { Clear: ["6mm", "8mm"], "Low-E": ["10mm"] },
    },
  };

  const putRes = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${chainTypeId}/field-values`),
    { data: { fieldOptionsConfig } },
  );
  expect(putRes.status()).toBe(200);

  const getRes = await acmePage.request.get(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${chainTypeId}/field-values`),
  );
  expect(getRes.status()).toBe(200);
  const { componentType } = (await getRes.json()) as {
    componentType: {
      fieldOptionsConfig: Record<
        string,
        { options?: string[]; valueMap?: Record<string, string[]> }
      >;
    };
  };

  expect(componentType.fieldOptionsConfig[CATEGORY_KEY]?.options).toEqual(["Single", "Glazed"]);
  expect(componentType.fieldOptionsConfig[GLASS_TYPE_KEY]?.valueMap).toEqual({
    Single: ["Clear", "Tinted"],
    Glazed: ["Low-E"],
  });
  // The deepest level — this is exactly the data the editor bug silently wiped.
  expect(componentType.fieldOptionsConfig[THICKNESS_KEY]?.valueMap?.Clear).toEqual([
    "6mm",
    "8mm",
  ]);
  expect(componentType.fieldOptionsConfig[THICKNESS_KEY]?.valueMap?.["Low-E"]).toEqual(["10mm"]);
});
