/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use()`, which the React hooks rule mistakes for a hook */
/**
 * Shared helpers for the SuperAdmin API specs (Task 11).
 *
 * `test` here extends the regression `test` fixture with `sa`: ONE SuperAdmin session per worker
 * (TEST_SA_USERNAME / TEST_SA_PASSWORD — the tester account; its password is NEVER changed and it is
 * never deleted). The client is GUARDED and its allowance starts with ONLY this run's org B: every
 * other id-addressed SA mutation needs the id of a row this run created (orgs, admins, formula sets),
 * added to `sa.allowance.ids` the moment it exists. The Test Org's id is deliberately NOT in it — SA
 * specs never mutate the Test Org (CLAUDE.md rule 10; component types / roles go to org B only).
 *
 * Every row an SA spec creates is `rgr-<runId>-…` and ledgered at once:
 *   - orgs (kind org) — suspended + hard-deleted by the Cleaner, cascading their children;
 *   - SuperAdmins (kind superadmin) and formula sets (kind formulaSet) — platform-level rows, deleted by
 *     the Cleaner; teardown also lists both and reports any `run.prefix` leftover as a stray.
 * Children created inside org B / a throwaway org (roles, component types, users of org B) cascade with
 * their org and are only ledgered when the Cleaner has a deleter for them (org-B users: kind user).
 *
 * Audit rows (SuperAdminAuditLog) are append-only by design: rows written by / about the suite's
 * throwaway orgs, admins and formula sets SURVIVE the run. That is the accepted exception to "leave
 * nothing behind" (same ruling as the Task 8 GLASS-rename audit rows) — the log has no delete path in
 * app code and the regression suite does not purge it.
 */
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { test as base } from "../fixtures/test";
import { SaClient, createAllowance } from "../fixtures/clients";
import { readRunState, type RunState } from "../fixtures/run-state";
import type { Ledger } from "../fixtures/ledger";
import { runPassword } from "./sign-in";

export const SA = "/api/v1/superadmin";
/** An id no row has. Used for 404 probes and as the ONLY id the auth-matrix allowance lets through. */
export const GHOST = "rgr-ghost-00000000";
export const SA_USER = (): string => process.env.TEST_SA_USERNAME!;
export const tag = (): string => randomBytes(3).toString("hex");

const bypassHeaders = (): Record<string, string> => {
  const b = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return b ? { "x-vercel-protection-bypass": b } : {};
};

export const test = base.extend<{ sa: SaClient }, { saWorker: SaClient }>({
  saWorker: [
    async ({}, use) => {
      const run = readRunState();
      const sa = await SaClient.login(
        process.env.PLAYWRIGHT_BASE_URL!,
        process.env.TEST_SA_USERNAME!,
        process.env.TEST_SA_PASSWORD!,
        createAllowance([], [run.orgB.id]),
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      );
      await use(sa);
      await sa.dispose();
    },
    { scope: "worker" },
  ],
  sa: async ({ saWorker }, use) => {
    await use(saWorker);
  },
});
export { expect };

export const cookie = (token: string): Record<string, string> => ({ Cookie: `qs-sa-token=${token}` });

/** A fresh, cookie-less request context (bypass header only) for raw login / logout calls. */
export async function rawContext(playwright: { request: { newContext(o: object): Promise<APIRequestContext> } }, baseURL: string | undefined): Promise<APIRequestContext> {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: bypassHeaders() });
}

/** POST /superadmin/login on `ctx`; returns the status and the qs-sa-token from Set-Cookie (if any). */
export async function saLogin(ctx: APIRequestContext, username: string, password: string): Promise<{ status: number; token?: string; setCookie: string; body: string }> {
  const r = await ctx.post(`${SA}/login`, { data: { username, password } });
  const setCookie = r.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).join("\n");
  return { status: r.status(), token: /qs-sa-token=([^;]+)/.exec(setCookie)?.[1], setCookie, body: await r.text() };
}

/** Assert the exact status, printing the body on mismatch; a 2xx where a rejection was expected says so loudly. */
export async function expectStatus(r: APIResponse, status: number, what = ""): Promise<string> {
  const text = await r.text();
  if (status >= 400 && r.ok()) {
    throw new Error(`${what}: expected ${status} but the request was ACCEPTED (HTTP ${r.status()}) — it wrote through. Body: ${text.slice(0, 500)}`);
  }
  expect(r.status(), `${what} ${text.slice(0, 500)}`).toBe(status);
  return text;
}

export async function json<T>(r: APIResponse, status = 200, what = ""): Promise<T> {
  const text = await expectStatus(r, status, what);
  return JSON.parse(text) as T;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export type AuditEntry = {
  id: string; createdAt: string; by: { username: string | null; deleted: boolean };
  verb: "INSERT" | "UPDATE" | "DELETE"; item: string; entity: string | null; summary: string; action: string;
  org: { id: string; slug: string | null } | null; targetType: string; targetId: string; details: unknown;
};
export type AuditPage = {
  entries: AuditEntry[]; total: number; page: number; pageSize: number;
  facets: { orgs: { id: string; slug: string | null }[]; admins: { username: string; deleted: boolean }[]; items: string[] };
};

export async function auditLog(sa: SaClient | { get(url: string, o?: { headers?: Record<string, string> }): Promise<APIResponse> }, query: Record<string, string | number> = {}, headers?: Record<string, string>): Promise<AuditPage> {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString();
  const r = await sa.get(`${SA}/audit-log${qs ? `?${qs}` : ""}`, headers ? { headers } : undefined);
  return json<AuditPage>(r, 200, `audit-log ${qs}`);
}

// ── Orgs ──────────────────────────────────────────────────────────────────────

export type OrgRow = {
  id: string; slug: string; name: string; isSuspended: boolean; createdAt: string; userCount: number;
  activeFormulaSetId: string | null; formulaSetLabel: string | null; hasMismatch: boolean;
};

export async function listOrgs(sa: SaClient): Promise<OrgRow[]> {
  return (await json<{ orgs: OrgRow[] }>(await sa.get(`${SA}/orgs`))).orgs;
}

/**
 * Create a throwaway org `rgr-<runId>-<letter><hex>` (its seeded admin is "admin", password = this run's
 * password), ledger it (kind org) and allow its id on `sa`. Teardown suspends + hard-deletes it.
 */
export async function createThrowawayOrg(
  sa: SaClient,
  deps: { run: RunState; ledger: Ledger },
  letter: string,
  formulaSetId = deps.run.formulaSetId,
): Promise<{ id: string; slug: string; name: string }> {
  const slug = `${deps.run.prefix}${letter}${tag()}`;
  const name = `RGR ${deps.run.runId} ${letter.toUpperCase()}`;
  const r = await sa.post(`${SA}/orgs`, { data: { name, slug, adminPassword: runPassword(), formulaSetId } });
  const text = await r.text();
  if (r.status() !== 201) throw new Error(`setup: create org ${slug} → HTTP ${r.status()} ${text}`);
  const org = (JSON.parse(text) as { org: { id: string; slug: string; name: string } }).org;
  deps.ledger.add({ kind: "org", id: org.id, orgSlug: org.slug, label: org.slug });
  sa.allowance.ids.add(org.id);
  return org;
}

/** Suspend (idempotent) then hard-delete one of OUR orgs; asserts both steps. */
export async function hardDeleteOrg(sa: SaClient, orgId: string): Promise<void> {
  await expectStatus(await sa.post(`${SA}/orgs/${orgId}/suspend`, { data: { suspend: true } }), 200, "suspend before delete");
  await expectStatus(await sa.delete(`${SA}/orgs/${orgId}`), 200, "hard delete");
}

// ── Formula sets ──────────────────────────────────────────────────────────────

export type FormulaSetDetail = {
  id: string; name: string; version: number; body: unknown; publishedAt: string | null; createdAt: string; updatedAt: string;
  locked: boolean; inUseBy: { orgCount: number; projectCount: number; calculationCount: number };
};

/** The seeded set's body — a body the validator is known to accept. */
export async function seededBody(sa: SaClient, run: RunState): Promise<unknown> {
  return (await json<{ formulaSet: FormulaSetDetail }>(await sa.get(`${SA}/formula-sets/${run.formulaSetId}`))).formulaSet.body;
}

/**
 * POST a formula set named `name` (must be rgr-), ledger the 201 at once (kind formulaSet) and allow its id.
 * Returns the raw response for the caller's assertions.
 */
export async function postFormulaSet(sa: SaClient, ledger: Ledger, data: { name: string; body: unknown; version?: unknown }): Promise<APIResponse> {
  if (!data.name.trim().startsWith("rgr-")) throw new Error(`postFormulaSet: name "${data.name}" must start with rgr-`);
  const r = await sa.post(`${SA}/formula-sets`, { data });
  if (r.status() === 201) ledgerFormulaSet(sa, ledger, ((await r.json()) as { formulaSet: FormulaSetDetail }).formulaSet);
  return r;
}

export function ledgerFormulaSet(sa: SaClient, ledger: Ledger, fs: { id: string; name: string }): void {
  ledger.add({ kind: "formulaSet", id: fs.id, orgSlug: null, label: fs.name });
  sa.allowance.ids.add(fs.id);
}

// ── SuperAdmins ───────────────────────────────────────────────────────────────

export type AdminRow = { id: string; username: string; createdAt: string; protected: boolean; isSelf: boolean };

export async function listAdmins(sa: { get(url: string, o?: { headers?: Record<string, string> }): Promise<APIResponse> }, headers?: Record<string, string>): Promise<AdminRow[]> {
  return (await json<{ admins: AdminRow[] }>(await sa.get(`${SA}/admins`, headers ? { headers } : undefined))).admins;
}

/**
 * POST /superadmin/admins for `username` (sent as given; the server trims + lower-cases), ledgering a 201
 * under the normalised name (kind superadmin) and allowing its id. `actor` defaults to the worker session.
 */
export async function postAdmin(
  sa: SaClient,
  ledger: Ledger,
  username: string,
  password: string,
  actorHeaders?: Record<string, string>,
): Promise<APIResponse> {
  const normalised = username.trim().toLowerCase();
  if (!normalised.startsWith("rgr-")) throw new Error(`postAdmin: username "${username}" must normalise to rgr-…`);
  const r = await sa.post(`${SA}/admins`, { data: { username, password }, ...(actorHeaders ? { headers: actorHeaders } : {}) });
  if (r.status() === 201) {
    const admin = ((await r.json()) as { admin: { id: string; username: string } }).admin;
    ledger.add({ kind: "superadmin", id: admin.id, orgSlug: null, label: admin.username });
    sa.allowance.ids.add(admin.id);
  }
  return r;
}
