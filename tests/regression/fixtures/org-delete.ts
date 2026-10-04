import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { Guarded, type Allowance } from "./clients";
import type { LedgerEntry } from "./ledger";
import { RUN_PASSWORD_ENV, TEST_ORG } from "../env";
import type { RunState } from "./run-state";
import { apiSignIn, apiUrl } from "../../e2e/helpers";
import { rgrSetProjectStatus } from "../../e2e/db-helpers";
import { orgRowDeleteRefusal } from "./cleanup-rules";

const ORG_API_PATH: Record<"project" | "inventoryItem" | "externalCompany", string> = {
  project: "projects",
  inventoryItem: "inventory",
  externalCompany: "external-companies",
};

export interface AdminCandidate { username: string; id: string }

/**
 * Org-admin sessions for org-API deletes (project / inventoryItem / externalCompany have no SuperAdmin
 * route). Session source, in order:
 *   1. this run's admin: its storageState file, else a sign-in with this run's in-memory password
 *      (RGR_RUN_PASSWORD — never on disk);
 *   2. an orphaned rgr-…-admin of that org (a crashed run's password is unknown): reset its password
 *      to a fresh random one via the SuperAdmin user-edit route, then sign in;
 *   3. the Test Org's seeded `admin` with TEST_ADMIN_PASSWORD (only if set);
 *   4. otherwise throw, carrying the last sign-in error — loud, never a silent skip.
 */
export class OrgSessions {
  private browser: Browser | null = null;
  private sessions = new Map<string, Guarded>();
  private contexts: BrowserContext[] = [];
  /** orgSlug → rgr-…-admin users present in the entries being drained (kept current by the drainer). */
  readonly adminCandidates = new Map<string, AdminCandidate[]>();

  constructor(
    private readonly opts: {
      baseURL: string;
      bypass?: string;
      adminPass?: string;
      allowance: Allowance;
      run: RunState | null;
      /** SA-route password reset for an rgr- user; returns the new password. */
      resetPassword: (orgSlug: string, userId: string) => Promise<string>;
    },
  ) {}

  private headers(): Record<string, string> {
    return this.opts.bypass ? { "x-vercel-protection-bypass": this.opts.bypass } : {};
  }

  private async newContext(storage?: string): Promise<BrowserContext> {
    this.browser ??= await chromium.launch();
    const ctx = await this.browser.newContext({
      baseURL: this.opts.baseURL,
      extraHTTPHeaders: this.headers(),
      ...(storage ? { storageState: storage } : {}),
    });
    this.contexts.push(ctx);
    return ctx;
  }

  private async signIn(orgSlug: string, username: string, password: string): Promise<BrowserContext> {
    const ctx = await this.newContext();
    const page = await ctx.newPage();
    await apiSignIn(page, orgSlug, username, password); // throws with the HTTP status on failure
    await page.close();
    return ctx;
  }

  async session(orgSlug: string): Promise<Guarded> {
    const cached = this.sessions.get(orgSlug);
    if (cached) return cached;
    const tried: string[] = [];
    let lastError = "";
    const attempt = async (label: string, f: () => Promise<BrowserContext | null>) => {
      tried.push(label);
      try {
        return await f();
      } catch (err) {
        lastError = `${label}: ${err instanceof Error ? err.message : String(err)}`;
        return null;
      }
    };
    const run = this.opts.run;
    for (const c of this.adminCandidates.get(orgSlug) ?? []) {
      const isThisRun = !!run && run.testOrg.slug === orgSlug && run.users.admin.username === c.username;
      if (isThisRun) {
        const storage = path.join(run.storageDir, "admin.json");
        const ctx = await attempt(`${c.username} (storage state)`, async () => {
          if (!fs.existsSync(storage)) throw new Error("storage file missing");
          const ctx = await this.newContext(storage);
          const probe = await ctx.request.get(apiUrl(orgSlug, `/api/v1/orgs/${orgSlug}/me`));
          if (!probe.ok()) throw new Error(`session probe → HTTP ${probe.status()}`);
          return ctx;
        });
        if (ctx) return this.keep(orgSlug, ctx);
        const pw = process.env[RUN_PASSWORD_ENV];
        if (pw) {
          const ctx2 = await attempt(`${c.username} (run password)`, () => this.signIn(orgSlug, c.username, pw));
          if (ctx2) return this.keep(orgSlug, ctx2);
        }
      }
      const ctx = await attempt(`${c.username} (SA password reset)`, async () => {
        const pw = await this.opts.resetPassword(orgSlug, c.id);
        return this.signIn(orgSlug, c.username, pw);
      });
      if (ctx) return this.keep(orgSlug, ctx);
    }
    if (orgSlug === TEST_ORG && this.opts.adminPass) {
      const ctx = await attempt("admin (TEST_ADMIN_PASSWORD)", () => this.signIn(orgSlug, "admin", this.opts.adminPass!));
      if (ctx) return this.keep(orgSlug, ctx);
    }
    throw new Error(
      `cleanup: no org-admin session for "${orgSlug}" (tried: ${tried.join(", ") || "nothing — no rgr- admin of that org is being drained"}` +
        `${this.opts.adminPass ? "" : "; TEST_ADMIN_PASSWORD unset"}). Last error: ${lastError || "n/a"}. ` +
        `Set TEST_ADMIN_PASSWORD (Test Org admin) and re-run so orphan recovery can finish.`,
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
    // M1: read the LIVE row first — never delete by a ledger id alone
    const live = await g.get(url);
    if (live.status() === 404) return; // already gone
    if (live.status() !== 200) throw new Error(`cleanup: read ${e.kind} ${e.label} → HTTP ${live.status()}`);
    const refusal = orgRowDeleteRefusal(e.kind, await live.json().catch(() => null));
    if (refusal) throw new Error(`cleanup REFUSED: ${e.kind} ${e.id} (ledger said "${e.label}"): ${refusal}`);
    let r = await g.delete(url);
    if (r.status() === 409 && e.kind === "project") {
      // DELETE is DRAFT-only: put the (rgr-, in-scope, just 409'd by the org-scoped route) project back to DRAFT.
      await rgrSetProjectStatus(e.id, "DRAFT");
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
