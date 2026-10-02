import path from "node:path";
import {
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { assertMutationAllowed } from "./guard";
import { TEST_ORG } from "../env";
import type { Role, RunState } from "./run-state";
import { apiUrl } from "../../e2e/helpers";

/**
 * What this run may mutate: org slugs (org-scoped API) and row ids (id-addressed SuperAdmin routes).
 * ONE shared, mutable instance per process — setup/fixtures add ids (Test Org, org B, created admins /
 * formula sets) as they learn them, and every Guarded client sees the additions immediately.
 */
export interface Allowance {
  slugs: Set<string>;
  ids: Set<string>;
}

export function createAllowance(slugs: Iterable<string> = [TEST_ORG], ids: Iterable<string> = []): Allowance {
  return { slugs: new Set(slugs), ids: new Set(ids) };
}

/** Worker processes rebuild the allowance from run.json (Test Org + this run's org B). */
export function allowanceFromRun(run: RunState): Allowance {
  return createAllowance([run.testOrg.slug, run.orgB.slug], [run.testOrg.id, run.orgB.id]);
}

type Body = { data?: unknown; headers?: Record<string, string> };

/** Wraps an APIRequestContext so every mutating call is checked BEFORE it is sent. */
export class Guarded {
  constructor(
    readonly ctx: APIRequestContext,
    readonly allowance: Allowance,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}
  private h(o?: Body) {
    return { ...this.extraHeaders, ...(o?.headers ?? {}) };
  }
  private check(method: string, url: string, o?: Body) {
    assertMutationAllowed(method, url, this.allowance.slugs, this.allowance.ids, o?.data);
  }
  get(url: string, o?: Body): Promise<APIResponse> {
    return this.ctx.get(url, { headers: this.h(o) });
  }
  post(url: string, o?: Body): Promise<APIResponse> {
    this.check("POST", url, o);
    return this.ctx.post(url, { data: o?.data, headers: this.h(o) });
  }
  patch(url: string, o?: Body): Promise<APIResponse> {
    this.check("PATCH", url, o);
    return this.ctx.patch(url, { data: o?.data, headers: this.h(o) });
  }
  put(url: string, o?: Body): Promise<APIResponse> {
    this.check("PUT", url, o);
    return this.ctx.put(url, { data: o?.data, headers: this.h(o) });
  }
  delete(url: string, o?: Body): Promise<APIResponse> {
    this.check("DELETE", url, o);
    return this.ctx.delete(url, { data: o?.data, headers: this.h(o) });
  }
}

/** SuperAdmin API client — login once, send qs-sa-token on every call. */
export class SaClient extends Guarded {
  private constructor(ctx: APIRequestContext, allowance: Allowance, readonly token: string) {
    super(ctx, allowance, { Cookie: `qs-sa-token=${token}` });
  }
  static async login(baseURL: string, user: string, pass: string, allowance: Allowance, bypass?: string): Promise<SaClient> {
    const ctx = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {},
    });
    const res = await ctx.post("/api/v1/superadmin/login", { data: { username: user, password: pass } });
    if (res.status() !== 200) throw new Error(`SuperAdmin login failed: HTTP ${res.status()}`);
    const token = /qs-sa-token=([^;]+)/.exec(res.headers()["set-cookie"] ?? "")?.[1];
    if (!token) throw new Error("SuperAdmin login: no qs-sa-token cookie");
    return new SaClient(ctx, allowance, token);
  }
  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

export type Identity = Role | "orgB-admin";

/** Org-scoped client bound to one org slug (paths are resolved with apiUrl), same guard. */
export class OrgClient extends Guarded {
  private constructor(
    ctx: APIRequestContext,
    allowance: Allowance,
    readonly orgSlug: string,
    private readonly owner: BrowserContext,
  ) {
    super(ctx, allowance);
  }
  /** Absolute/relative URL for an org API path (subdomain-aware). */
  url(apiPath: string): string {
    return apiUrl(this.orgSlug, apiPath);
  }
  static async fromStorage(browser: Browser, identity: Identity, run: RunState, allowance = allowanceFromRun(run)): Promise<OrgClient> {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const owner = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL,
      storageState: path.join(run.storageDir, `${identity}.json`),
      extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {},
    });
    const slug = identity === "orgB-admin" ? run.orgB.slug : run.testOrg.slug;
    return new OrgClient(owner.request, allowance, slug, owner);
  }
  async close(): Promise<void> {
    await this.owner.close();
  }
}
