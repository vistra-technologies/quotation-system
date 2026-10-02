import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { Guarded, type Allowance } from "./clients";
import type { LedgerEntry } from "./ledger";
import { RGR_PASSWORD, TEST_ORG } from "../env";
import type { RunState } from "./run-state";
import { apiSignIn, apiUrl } from "../../e2e/helpers";
import { setProjectStatus } from "../../e2e/db-helpers";

/** The suite's run-admin username shape: rgr-<runId>-admin. */
export const isRunAdminUsername = (u: string) => /^rgr-.+-admin$/.test(u);

const ORG_API_PATH: Record<"project" | "inventoryItem" | "externalCompany", string> = {
  project: "projects",
  inventoryItem: "inventory",
  externalCompany: "external-companies",
};

/**
 * Org-admin sessions for org-API deletes (project / inventoryItem / externalCompany have no SuperAdmin
 * route). Session source, in order:
 *   1. a still-existing rgr-…-admin user of that org (from the entries being drained): this run's
 *      storageState file when it belongs to that user, else a fresh apiSignIn with the suite password;
 *   2. the Test Org's seeded `admin` with TEST_ADMIN_PASSWORD (only if set);
 *   3. otherwise throw — loud, never a silent skip.
 */
export class OrgSessions {
  private browser: Browser | null = null;
  private sessions = new Map<string, Guarded>();
  private contexts: BrowserContext[] = [];
  /** orgSlug → candidate rgr-…-admin usernames (kept current by the drainer). */
  readonly adminCandidates = new Map<string, string[]>();

  constructor(
    private readonly opts: { baseURL: string; bypass?: string; adminPass?: string; allowance: Allowance; run: RunState | null },
  ) {}

  private headers(): Record<string, string> {
    return this.opts.bypass ? { "x-vercel-protection-bypass": this.opts.bypass } : {};
  }

  private async tryContext(orgSlug: string, username: string, password: string): Promise<BrowserContext | null> {
    this.browser ??= await chromium.launch();
    const run = this.opts.run;
    const storage =
      run && run.testOrg.slug === orgSlug && run.users.admin.username === username
        ? path.join(run.storageDir, "admin.json")
        : null;
    const ctx = await this.browser.newContext({
      baseURL: this.opts.baseURL,
      extraHTTPHeaders: this.headers(),
      ...(storage && fs.existsSync(storage) ? { storageState: storage } : {}),
    });
    this.contexts.push(ctx);
    if (storage && fs.existsSync(storage)) {
      const probe = await ctx.request.get(apiUrl(orgSlug, `/api/v1/orgs/${orgSlug}/me`));
      if (probe.ok()) return ctx;
      await ctx.clearCookies();
    }
    try {
      const page = await ctx.newPage();
      await apiSignIn(page, orgSlug, username, password);
      await page.close();
      return ctx;
    } catch {
      return null;
    }
  }

  async session(orgSlug: string): Promise<Guarded> {
    const cached = this.sessions.get(orgSlug);
    if (cached) return cached;
    const tried: string[] = [];
    for (const u of this.adminCandidates.get(orgSlug) ?? []) {
      tried.push(u);
      const ctx = await this.tryContext(orgSlug, u, RGR_PASSWORD);
      if (ctx) return this.keep(orgSlug, ctx);
    }
    if (orgSlug === TEST_ORG && this.opts.adminPass) {
      tried.push("admin (TEST_ADMIN_PASSWORD)");
      const ctx = await this.tryContext(orgSlug, "admin", this.opts.adminPass);
      if (ctx) return this.keep(orgSlug, ctx);
    }
    throw new Error(
      `cleanup: no org-admin session for "${orgSlug}" (tried: ${tried.join(", ") || "nothing"}). ` +
        `No rgr- admin user of that org survives and TEST_ADMIN_PASSWORD is ${this.opts.adminPass ? "wrong" : "unset"} — ` +
        `set TEST_ADMIN_PASSWORD (Test Org admin) and re-run so orphan recovery can finish.`,
    );
  }

  /** Forget cached sessions (their user may have been deleted by the previous drain). */
  reset(): void {
    this.sessions.clear();
    this.adminCandidates.clear();
  }

  private keep(orgSlug: string, ctx: BrowserContext): Guarded {
    const g = new Guarded(ctx.request, this.opts.allowance);
    this.sessions.set(orgSlug, g);
    return g;
  }

  /** Delete one project / inventory item / external company via the org API. 404 = already gone. */
  async orgDelete(e: LedgerEntry & { kind: "project" | "inventoryItem" | "externalCompany" }): Promise<void> {
    if (!e.orgSlug) throw new Error(`cleanup: ${e.kind} ${e.label} has no orgSlug`);
    const g = await this.session(e.orgSlug);
    const url = apiUrl(e.orgSlug, `/api/v1/orgs/${e.orgSlug}/${ORG_API_PATH[e.kind]}/${e.id}`);
    let r = await g.delete(url);
    if (r.status() === 409 && e.kind === "project") {
      // DELETE is DRAFT-only: put the (rgr-, in-scope, just 409'd by the org-scoped route) project back to DRAFT.
      await setProjectStatus(e.id, "DRAFT");
      r = await g.delete(url);
    }
    const s = r.status();
    if (s !== 200 && s !== 204 && s !== 404) {
      throw new Error(`cleanup: delete ${e.kind} ${e.label} → HTTP ${s} ${(await r.text()).slice(0, 200)}`);
    }
  }

  async dispose(): Promise<void> {
    for (const c of this.contexts) await c.close().catch(() => undefined);
    await this.browser?.close();
  }
}
