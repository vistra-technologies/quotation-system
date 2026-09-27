/**
 * Stage 27 — Catalog page visual dependency-tree UI: DOM/behavior-level E2E coverage.
 *
 * DOM/behavior assertions are allowed as of CLAUDE.md §5 (lifted 2026-09-15) — this spec asserts on
 * real rendered structure (attribute counts, button disabled state, dialog text) and on network
 * traffic (PUT call counting), per stage-27.md's own Testing posture:
 *   - tree renders correct attribute/segment counts, no option-count total anywhere;
 *   - root card is not a button / has no click affordance (S27-2);
 *   - the cascade "Next" button stays disabled while the currently-open attribute has any empty
 *     option group (S27-5), enables once filled, and no PUT fires while the gate is unsatisfied;
 *   - exactly one PUT fires, only at the very end of a multi-step cascade;
 *   - Cancel/Escape mid-cascade discards the whole in-progress session (S27-6);
 *   - a synthetic 2-hop dependsOn chain (Category -> Type -> SubType) directly exercises
 *     `descendants()`/`nextStep()` recursion depth beyond direct children, since real org seed
 *     data may not have a chain that deep (stage-27.md Batch 3 acceptance);
 *   - no Segment Settings entry point exists anywhere (S27-2).
 *
 * Auth helper: apiSignIn() — same API-level sign-in + cookie-injection pattern established in
 * tests/e2e/catalog-field-values.spec.ts (the browser-form flow is broken on ad-hoc *.vercel.app
 * previews; this bypasses it).
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { apiUrl, isSubdomain, orgUrl } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const ACME = "acme-glass";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now();

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
    throw new Error(`apiSignIn(${username}@${orgSlug}) failed: ${resp?.status()} ${resp ? await resp.text() : ""}`);
  }
  const setCookie = resp.headers()["set-cookie"];
  if (!setCookie) throw new Error(`apiSignIn(${username}@${orgSlug}): no Set-Cookie header`);
  const sessionCookieLine = setCookie.split("\n").find((line) => line.includes("session_token"));
  if (!sessionCookieLine) throw new Error(`apiSignIn(${username}@${orgSlug}): no session_token cookie`);
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
let acmePage: Page;

const CAT_KEY = `cat${RUN}`;
const TYPE_KEY = `type${RUN}`;
const SUB_KEY = `sub${RUN}`;
let chainTypeId: string;
let simpleTypeId: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  acmeCtx = await browser.newContext();
  acmePage = await acmeCtx.newPage();
  await apiSignIn(acmePage, ACME, "admin");

  const catRes = await acmePage.request.get(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-categories`));
  expect(catRes.status()).toBe(200);
  const { categories } = (await catRes.json()) as { categories: { id: string }[] };
  const categoryId = categories[0].id;

  // A synthetic 2-hop dependsOn chain (Category -> Type -> SubType), seeded with one complete
  // branch, so adding a brand-new Category value is what triggers the cascade below.
  const chainRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`), {
    data: {
      code: `SA_E2E_S27CHAIN_${RUN}`,
      name: `Stage27 Chain ${RUN}`,
      categoryId,
      fieldsSchema: [
        { key: CAT_KEY, label: "Category", type: "dropdown", required: false, basic: true },
        { key: TYPE_KEY, label: "Type", type: "dropdown", required: false, basic: true, dependsOn: CAT_KEY },
        { key: SUB_KEY, label: "SubType", type: "dropdown", required: false, basic: true, dependsOn: TYPE_KEY },
      ],
    },
  });
  expect(chainRes.status()).toBe(201);
  chainTypeId = ((await chainRes.json()) as { componentType: { id: string } }).componentType.id;

  const seedRes = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${chainTypeId}/field-values`),
    {
      data: {
        fieldOptionsConfig: {
          [CAT_KEY]: { options: ["Alpha"] },
          [TYPE_KEY]: { valueMap: { Alpha: ["A1"] } },
          [SUB_KEY]: { valueMap: { A1: ["S1"] } },
        },
      },
    },
  );
  expect(seedRes.status()).toBe(200);

  // A second, simple throwaway type — two independent flat fields, no chain — for the plain
  // tree-count/no-total assertions, isolated from the cascade type above.
  const simpleRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`), {
    data: {
      code: `SA_E2E_S27SIMPLE_${RUN}`,
      name: `Stage27 Simple ${RUN}`,
      categoryId,
      fieldsSchema: [
        { key: `flatA${RUN}`, label: "Flat A", type: "dropdown", required: false, basic: true },
        { key: `flatB${RUN}`, label: "Flat B", type: "dropdown", required: false, basic: true },
      ],
    },
  });
  expect(simpleRes.status()).toBe(201);
  simpleTypeId = ((await simpleRes.json()) as { componentType: { id: string } }).componentType.id;
  const simpleSeedRes = await acmePage.request.put(
    apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${simpleTypeId}/field-values`),
    { data: { fieldOptionsConfig: { [`flatA${RUN}`]: { options: ["X"] }, [`flatB${RUN}`]: { options: ["Y"] } } } },
  );
  expect(simpleSeedRes.status()).toBe(200);
});

test.afterAll(async () => {
  await acmeCtx.close();
});

// ---------------------------------------------------------------------------
// Tree canvas — counts, no option-count total, root not a button, no Segment
// Settings anywhere (Batch 1).
// ---------------------------------------------------------------------------

test("tree renders correct attribute counts, no option-count total, and a non-interactive root card", async () => {
  await acmePage.goto(orgUrl(ACME, "/admin/catalog"));
  await expect(acmePage.getByRole("tab", { name: /Stage27 Chain/ })).toBeVisible();

  // Switch to the simple (2-attribute) segment and confirm its tab shows "2 attributes".
  await acmePage.getByRole("tab", { name: /Stage27 Simple/ }).click();
  await expect(acmePage.getByText("2 attributes", { exact: false }).first()).toBeVisible();

  // No option-count total anywhere on the page (the dropped "· N options" style figure, S27-3).
  const bodyText = await acmePage.locator("body").innerText();
  expect(bodyText).not.toMatch(/\d+\s*options?\s*(total|overall)/i);
  expect(bodyText).not.toContain("Segment Settings");

  // Root card: rendered, but not a <button> and has no aria-label implying it opens anything.
  const rootCard = acmePage.getByLabel(/Stage27 Simple.*segment/);
  await expect(rootCard).toBeVisible();
  const tagName = await rootCard.evaluate((el) => el.tagName);
  expect(tagName).not.toBe("BUTTON");
});

// ---------------------------------------------------------------------------
// Cascade + completeness gate (Batch 3) — synthetic 2-hop chain.
// ---------------------------------------------------------------------------

test("cascade across a synthetic 2-hop chain: Next stays gated, exactly one PUT fires at the end", async () => {
  await acmePage.goto(orgUrl(ACME, "/admin/catalog"));
  await acmePage.getByRole("tab", { name: /Stage27 Chain/ }).click();

  const putRequests: string[] = [];
  acmePage.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes(`/component-types/${chainTypeId}/field-values`)) {
      putRequests.push(req.postData() ?? "");
    }
  });

  // Step 1: open Category, add a brand-new value "Beta" — this has empty downstream groups at
  // both hops (Type's Beta group, and transitively SubType once Type's Beta group is filled).
  await acmePage.getByRole("button", { name: /Edit Category/ }).click();
  const dialog = acmePage.getByRole("dialog", { name: "Edit options" });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("Add value…").fill("Beta");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  // Category itself is non-empty (Alpha, Beta) — Next is enabled even though Type/SubType are
  // still empty (S27-5 only gates on the *currently open* attribute).
  const primaryBtn = dialog.getByRole("button", { name: /^(Next|Finish)/ });
  await expect(primaryBtn).toBeEnabled();
  expect(putRequests.length).toBe(0);
  await primaryBtn.click();

  // Step 2: now on Type, focused on the new "Beta" group — empty, so Next is disabled.
  await expect(dialog.getByText("Type", { exact: false }).first()).toBeVisible();
  await expect(primaryBtn).toBeDisabled();
  expect(putRequests.length).toBe(0);

  await dialog.getByPlaceholder("Add value…").fill("T1");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(primaryBtn).toBeEnabled();
  expect(putRequests.length).toBe(0);
  await primaryBtn.click();

  // Step 3: now on SubType, focused on the new "T1" group — empty again (2nd hop), Next/Finish
  // disabled — this is the recursion-depth check (descendants() must reach this grandchild).
  await expect(dialog.getByText("SubType", { exact: false }).first()).toBeVisible();
  await expect(primaryBtn).toBeDisabled();
  expect(putRequests.length).toBe(0);

  await dialog.getByPlaceholder("Add value…").fill("S2");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(primaryBtn).toHaveText(/Finish/);
  await expect(primaryBtn).toBeEnabled();
  expect(putRequests.length).toBe(0);

  await primaryBtn.click();
  await expect(dialog).toBeHidden();
  expect(putRequests.length).toBe(1);

  const body = JSON.parse(putRequests[0]) as { fieldOptionsConfig: Record<string, unknown> };
  expect(body.fieldOptionsConfig[CAT_KEY]).toEqual({ options: ["Alpha", "Beta"] });
  expect(body.fieldOptionsConfig[TYPE_KEY]).toEqual({ valueMap: { Alpha: ["A1"], Beta: ["T1"] } });
  expect(body.fieldOptionsConfig[SUB_KEY]).toEqual({ valueMap: { A1: ["S1"], T1: ["S2"] } });
});

// ---------------------------------------------------------------------------
// Discard mid-cascade (S27-6) — reopening afterward shows the original saved state.
// ---------------------------------------------------------------------------

test("Cancel mid-cascade discards the whole in-progress session, including advanced steps", async () => {
  await acmePage.goto(orgUrl(ACME, "/admin/catalog"));
  await acmePage.getByRole("tab", { name: /Stage27 Chain/ }).click();

  await acmePage.getByRole("button", { name: /Edit Category/ }).click();
  const dialog = acmePage.getByRole("dialog", { name: "Edit options" });
  await dialog.getByPlaceholder("Add value…").fill("Gamma");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("button", { name: /^(Next|Finish)/ }).click(); // advance into Type's new "Gamma" group

  await dialog.getByRole("button", { name: /^(Cancel|Close)$/ }).click();
  const discardDialog = acmePage.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeHidden();

  // Reopen Category — "Gamma" must be gone; only the state from the previous (committed) test
  // remains (Alpha, Beta).
  await acmePage.getByRole("button", { name: /Edit Category/ }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Gamma")).toHaveCount(0);
  await expect(dialog.getByText("Alpha")).toBeVisible();
  await expect(dialog.getByText("Beta")).toBeVisible();
  await dialog.getByRole("button", { name: /^(Cancel|Close)$/ }).click();
});
