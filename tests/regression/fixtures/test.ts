/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use()`, which the React hooks rule mistakes for a hook */
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { LEDGER_FILE, TEST_ORG } from "../env";
import { Ledger } from "./ledger";
import { Guarded, createAllowance } from "./clients";
import { readRunState, type Role, type RunState } from "./run-state";
import { apiUrl } from "../../e2e/helpers";
import { makeFactories, type Factories } from "./factories";

type Fx = {
  run: RunState;
  ledger: Ledger;
  /** Unauthenticated client (reads/probes; mutations are still guarded). */
  anon: Guarded;
  /** One guarded API client per Test Org role (allowance: Test Org only). */
  as: Record<Role, Guarded>;
  /** Throwaway org B's admin (allowance: org B only) — for cross-tenant probes. */
  orgB: Guarded;
  /** Test Org API URL for a path under /api/v1/orgs/<slug>. */
  url: (apiPath: string) => string;
  f: Factories;
};

const ROLES = ["admin", "member", "distributor", "architect"] as const;

function bypassHeaders(): Record<string, string> {
  const b = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return b ? { "x-vercel-protection-bypass": b } : {};
}

export const test = base.extend<Fx>({
  run: async ({}, use) => {
    await use(readRunState());
  },
  ledger: async ({}, use) => {
    await use(new Ledger(LEDGER_FILE));
  },
  anon: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: bypassHeaders() });
    await use(new Guarded(ctx, createAllowance([TEST_ORG])));
    await ctx.dispose();
  },
  as: async ({ playwright, baseURL, run }, use) => {
    const allowance = createAllowance([run.testOrg.slug], [run.testOrg.id]);
    const raw: APIRequestContext[] = [];
    const out = {} as Record<Role, Guarded>;
    for (const role of ROLES) {
      const ctx = await playwright.request.newContext({
        baseURL,
        storageState: `${run.storageDir}/${role}.json`,
        extraHTTPHeaders: bypassHeaders(),
      });
      raw.push(ctx);
      out[role] = new Guarded(ctx, allowance);
    }
    await use(out);
    await Promise.all(raw.map((c) => c.dispose()));
  },
  orgB: async ({ playwright, baseURL, run }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL,
      storageState: `${run.storageDir}/orgB-admin.json`,
      extraHTTPHeaders: bypassHeaders(),
    });
    await use(new Guarded(ctx, createAllowance([run.orgB.slug], [run.orgB.id])));
    await ctx.dispose();
  },
  url: async ({ run }, use) => {
    await use((p) => apiUrl(run.testOrg.slug, `/api/v1/orgs/${run.testOrg.slug}${p}`));
  },
  f: async ({ as, run, ledger }, use) => {
    await use(makeFactories({ admin: as.admin, run, ledger }));
  },
});

export { expect };
