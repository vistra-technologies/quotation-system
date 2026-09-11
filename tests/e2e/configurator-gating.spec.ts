/**
 * Stage 20 Batch 4 — Configurator gating + cascading behavior-level coverage.
 *
 * Two kinds of test in this file, per the stage doc's Testing posture (no unit-test runner
 * exists in this repo — Playwright is the only test tool — so pure-function coverage for
 * `lib/configurator-gating.ts` is written as plain `test()`/`expect()` blocks that never request
 * the `page`/`request` fixture; Playwright doesn't launch a browser or touch any server for those,
 * so they need no `PLAYWRIGHT_BASE_URL` and run the same way `tsc`/lint do — a local, static
 * check, not "app behavior" verification):
 *
 *   1. PURE-LOGIC — `isComponentTypeFullyConfigured`, `resolveOptions`, `collectDescendants`
 *      exercised directly, no server involved. Covers the whole-ComponentType gate for a 2-hop
 *      chain (decision #5) and the live cascading/descendant-clearing helpers the stage doc names.
 *   2. API-LEVEL (needs PLAYWRIGHT_BASE_URL) — the server-side backstop behind the "Add
 *      Component" palette's client-side gate: POSTing a Selection against an unconfigured
 *      ComponentType must be rejected even if a client bypasses the UI, per the stage doc's
 *      Testing posture ("a ComponentType with any field left unconfigured is unselectable
 *      end-to-end (API-level check, not just UI greying)").
 */

import { test, expect, type Page } from "@playwright/test";
import { apiUrl, isSubdomain } from "./helpers";
import { toAuthEmail } from "@/lib/auth-utils";
import {
  isComponentTypeFullyConfigured,
  resolveOptions,
  collectDescendants,
} from "@/lib/configurator-gating";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

// ─── PART 1: pure-logic tests — no fixtures, no server ───────────────────────

const field = (overrides: Partial<FieldEntry> & Pick<FieldEntry, "key">): FieldEntry => ({
  label: overrides.key,
  type: "dropdown",
  required: false,
  basic: true,
  ...overrides,
});

// The design doc's own canonical example: Category -> Glass Type -> Thickness (04-data-model.md).
const CHAIN_SCHEMA: FieldEntry[] = [
  field({ key: "category" }),
  field({ key: "glassType", dependsOn: "category" }),
  field({ key: "thickness", dependsOn: "glassType" }),
];

const COMPLETE_CHAIN_CONFIG: FieldOptionsConfig = {
  category: { options: ["Single", "Glazed"] },
  glassType: { valueMap: { Single: ["Clear", "Tinted"], Glazed: ["Low-E"] } },
  thickness: { valueMap: { Clear: ["6mm", "8mm"], Tinted: ["8mm"], "Low-E": ["10mm"] } },
};

test.describe("isComponentTypeFullyConfigured (pure)", () => {
  test("a fully-configured 2-hop chain is configured", () => {
    expect(isComponentTypeFullyConfigured(CHAIN_SCHEMA, COMPLETE_CHAIN_CONFIG)).toBe(true);
  });

  test("a root field with empty options is not configured", () => {
    const config: FieldOptionsConfig = {
      ...COMPLETE_CHAIN_CONFIG,
      category: { options: [] },
    };
    expect(isComponentTypeFullyConfigured(CHAIN_SCHEMA, config)).toBe(false);
  });

  test("a missing branch at the deepest level is not configured (decision #5)", () => {
    // "Glazed" is a valid category value, glassType maps it to "Low-E", but thickness has no
    // entry for "Low-E" — exactly the unmapped-valueMap-branch case decision #5 calls out.
    const config: FieldOptionsConfig = {
      category: { options: ["Single", "Glazed"] },
      glassType: { valueMap: { Single: ["Clear", "Tinted"], Glazed: ["Low-E"] } },
      thickness: { valueMap: { Clear: ["6mm", "8mm"], Tinted: ["8mm"] } }, // Low-E missing
    };
    expect(isComponentTypeFullyConfigured(CHAIN_SCHEMA, config)).toBe(false);
  });

  test("a type with no dropdown/radio fields is trivially configured", () => {
    const schema: FieldEntry[] = [
      { key: "note", label: "Note", type: "field", required: false, basic: true },
      { key: "flag", label: "Flag", type: "checkbox", required: false, basic: true },
    ];
    expect(isComponentTypeFullyConfigured(schema, null)).toBe(true);
  });

  test("null fieldOptionsConfig (no config row yet) is not configured for a dropdown field", () => {
    const schema: FieldEntry[] = [field({ key: "status" })];
    expect(isComponentTypeFullyConfigured(schema, null)).toBe(false);
  });
});

test.describe("resolveOptions (pure)", () => {
  test("root field returns its configured options regardless of currentFieldValues", () => {
    expect(resolveOptions(field({ key: "category" }), {}, COMPLETE_CHAIN_CONFIG)).toEqual([
      "Single",
      "Glazed",
    ]);
  });

  test("dependent field with parent selected returns that branch's values", () => {
    const glassType = field({ key: "glassType", dependsOn: "category" });
    expect(
      resolveOptions(glassType, { category: "Glazed" }, COMPLETE_CHAIN_CONFIG),
    ).toEqual(["Low-E"]);
  });

  test("dependent field with no parent value selected yet returns []", () => {
    const glassType = field({ key: "glassType", dependsOn: "category" });
    expect(resolveOptions(glassType, {}, COMPLETE_CHAIN_CONFIG)).toEqual([]);
  });

  test("2-hop: thickness resolves off glassType's currently-selected value, not category's", () => {
    const thickness = field({ key: "thickness", dependsOn: "glassType" });
    expect(
      resolveOptions(
        thickness,
        { category: "Single", glassType: "Clear" },
        COMPLETE_CHAIN_CONFIG,
      ),
    ).toEqual(["6mm", "8mm"]);
  });

  test("dependent field with an unmapped parent value returns []", () => {
    const glassType = field({ key: "glassType", dependsOn: "category" });
    expect(
      resolveOptions(glassType, { category: "Nonexistent" }, COMPLETE_CHAIN_CONFIG),
    ).toEqual([]);
  });
});

test.describe("collectDescendants (pure)", () => {
  test("changing the root of a 2-hop chain clears both levels below it", () => {
    expect(new Set(collectDescendants(CHAIN_SCHEMA, "category"))).toEqual(
      new Set(["glassType", "thickness"]),
    );
  });

  test("changing the middle field of a 2-hop chain clears only the deepest level", () => {
    expect(collectDescendants(CHAIN_SCHEMA, "glassType")).toEqual(["thickness"]);
  });

  test("a leaf field (nothing depends on it) has no descendants", () => {
    expect(collectDescendants(CHAIN_SCHEMA, "thickness")).toEqual([]);
  });

  test("a field with no dependents in an unrelated schema returns []", () => {
    const schema: FieldEntry[] = [field({ key: "color" })];
    expect(collectDescendants(schema, "color")).toEqual([]);
  });
});

// ─── PART 2: API-level — needs a live preview (PLAYWRIGHT_BASE_URL) ──────────

test.describe("server-side configuredness gate on Selection creation", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  const ACME = "acme-glass";
  const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
  const RUN = Date.now();

  async function apiSignIn(page: Page, orgSlug: string, username: string) {
    const password = process.env.TEST_ADMIN_PASSWORD ?? "Seed1234!";
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
      throw new Error(`apiSignIn(${username}@${orgSlug}) failed: ${resp?.status()}`);
    }
    const setCookie = resp.headers()["set-cookie"];
    if (!setCookie) throw new Error("apiSignIn: no Set-Cookie header");
    const sessionCookieLine = setCookie.split("\n").find((line) => line.includes("session_token"));
    if (!sessionCookieLine) throw new Error("apiSignIn: no session_token cookie");
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

  let acmePage: Page;
  let unconfiguredTypeId: string;
  let unconfiguredKey: string;
  let projectId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext();
    acmePage = await ctx.newPage();
    await apiSignIn(acmePage, ACME, "admin");

    const catRes = await acmePage.request.get(
      apiUrl(ACME, `/api/v1/orgs/${ACME}/component-categories`),
    );
    expect(catRes.status()).toBe(200);
    const { categories } = (await catRes.json()) as { categories: { id: string }[] };
    const categoryId = categories[0].id;

    // A throwaway ComponentType, owned by this spec, with a single root dropdown field that
    // starts genuinely unconfigured (no ComponentTypeOrgConfig row exists for a fresh type).
    unconfiguredKey = `gateKey${RUN}`;
    const createRes = await acmePage.request.post(
      apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types`),
      {
        data: {
          code: `SA_E2E_GATE_${RUN}`,
          name: `Gating E2E ${RUN}`,
          categoryId,
          fieldsSchema: [
            { key: unconfiguredKey, label: "Gate Field", type: "dropdown", required: false, basic: true },
          ],
        },
      },
    );
    expect(createRes.status()).toBe(201);
    const { componentType } = (await createRes.json()) as { componentType: { id: string } };
    unconfiguredTypeId = componentType.id;

    const projRes = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/projects`), {
      data: { name: `Stage20 B4 Gating ${RUN}`, currency: "AED" },
    });
    expect(projRes.status()).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };
    projectId = project.id;
  });

  test("POST /selections against an unconfigured ComponentType → 400, not 201", async () => {
    const res = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/selections`), {
      data: {
        projectId,
        componentTypeId: unconfiguredTypeId,
        label: `Gate Test ${RUN}`,
        config: {},
        orderIndex: 0,
      },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error ?? "").toMatch(/not fully configured/i);
  });

  test("once the type is configured via the Catalog PUT, POST /selections succeeds", async () => {
    const putRes = await acmePage.request.put(
      apiUrl(ACME, `/api/v1/orgs/${ACME}/component-types/${unconfiguredTypeId}/field-values`),
      { data: { fieldOptionsConfig: { [unconfiguredKey]: { options: ["A", "B"] } } } },
    );
    expect(putRes.status()).toBe(200);

    const res = await acmePage.request.post(apiUrl(ACME, `/api/v1/orgs/${ACME}/selections`), {
      data: {
        projectId,
        componentTypeId: unconfiguredTypeId,
        label: `Gate Test Configured ${RUN}`,
        config: { [unconfiguredKey]: "A" },
        orderIndex: 1,
      },
    });
    expect(res.status()).toBe(201);
  });
});
