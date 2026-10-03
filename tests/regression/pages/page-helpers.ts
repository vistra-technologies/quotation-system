/**
 * Browser helpers for the page specs (Task 12).
 *
 * Sessions are never signed in here: org identities reuse global setup's storageState files (one per
 * Test-Org role + org B's admin), and the SuperAdmin identity reuses the worker's tester-account session
 * from sa-helpers (`sa.token` → a host-only `qs-sa-token` cookie on the apex). No credentials in code.
 */
import path from "node:path";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Guarded } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import type { Role, RunState } from "../fixtures/run-state";
import { isSubdomain, orgUrl } from "../../e2e/helpers";
import { expectSubmitted, glassConfig, oneCellDesign } from "../api/project-helpers";
import { collectProblems, trackInFlight } from "./collect";
import type { ParamKey } from "./page-table";

export type Who = Role | "orgB-admin" | "anon" | "sa";

export interface Opened {
  ctx: BrowserContext;
  page: Page;
  /** Problems seen so far — read it only after `settle()`. */
  problems: () => string[];
  /** Same-origin requests still in flight. */
  inFlight: () => string[];
}

/** A fresh browser context for `who` (anon = no cookies), with the problem collector attached. */
export async function openAs(browser: Browser, run: RunState, who: Who, saToken?: string): Promise<Opened> {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const ctx = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {},
    ...(who === "anon" || who === "sa" ? {} : { storageState: path.join(run.storageDir, `${who}.json`) }),
  });
  if (who === "sa") {
    if (!saToken) throw new Error("openAs('sa') needs the worker's SuperAdmin token");
    await ctx.addCookies([{ name: "qs-sa-token", value: saToken, url: process.env.PLAYWRIGHT_BASE_URL!, httpOnly: true, secure: true, sameSite: "Lax" }]);
  }
  const page = await ctx.newPage();
  return { ctx, page, problems: collectProblems(page), inFlight: trackInFlight(page) };
}

/**
 * Wait until the page's post-mount calls have settled — no tracked same-origin request in flight, and still
 * none after a 750 ms quiet window — then return the problems. Reading the collector any earlier (or closing
 * the context with a call in flight) could miss a late console error / 5xx / failure. A request that never
 * settles fails the test with its URL instead of being silently aborted by ctx.close().
 *
 * Not `networkidle`: the Vercel preview toolbar keeps connections open, so it times out on most pages; the
 * tracker (collect.ts trackInFlight) ignores exactly that toolbar traffic and Next's <Link> prefetches.
 */
export async function settledProblems(o: Opened): Promise<string[]> {
  await expect
    .poll(
      async () => {
        if (o.inFlight().length) return o.inFlight();
        await o.page.waitForTimeout(750);
        return o.inFlight();
      },
      { timeout: 20_000, message: "same-origin requests still in flight before reading the collector" },
    )
    .toEqual([]);
  return o.problems();
}

/** Poll an observed landing path (client-side redirects arrive after the first response). */
export async function expectLands(observe: () => string, expected: string, message?: string): Promise<void> {
  await expect.poll(observe, { timeout: 15_000, message }).toBe(expected);
}

/** Navigation target for an org-relative path ("/projects/…") in the Test Org (subdomain or path mode). */
export const orgTarget = (run: RunState, rel: string): string => orgUrl(run.testOrg.slug, rel);

/** The org-relative path of `url` ("/login"), asserting it is on the Test Org's host/prefix. */
export function orgPathOf(run: RunState, url: string): string {
  const u = new URL(url);
  if (isSubdomain) {
    expect(u.hostname.startsWith(`${run.testOrg.slug}.`), `expected a ${run.testOrg.slug} subdomain URL, got ${url}`).toBe(true);
    return u.pathname;
  }
  const prefix = `/${run.testOrg.slug}`;
  expect(u.pathname === prefix || u.pathname.startsWith(`${prefix}/`), `expected a ${prefix}/… URL, got ${url}`).toBe(true);
  return u.pathname.slice(prefix.length) || "/";
}

/** Path of an apex URL ("/controls/login"). */
export const apexPathOf = (url: string): string => new URL(url).pathname;

// ── Dynamic params (one row each per worker) ────────────────────────────────

const memo = new Map<string, Promise<string>>();
function once(key: string, make: () => Promise<string>): Promise<string> {
  let p = memo.get(key);
  if (!p) {
    p = make();
    memo.set(key, p);
    p.catch(() => {
      if (memo.get(key) === p) memo.delete(key);
    });
  }
  return p;
}

/** f.wall + one GLASS selection filling its only cell — ready for Submit Design (not submitted). */
export async function readyWall(f: Factories, admin: Guarded, url: (p: string) => string) {
  const w = await f.wall();
  const sel = await f.selection(w.projectId, "GLASS", await glassConfig(f));
  const p = await admin.patch(url(`/partitions/${w.partitionId}`), { data: { heightMm: 2400, design: oneCellDesign(sel.id) } });
  expect(p.status(), await p.text()).toBe(200);
  return { ...w, selectionId: sel.id };
}

export interface ParamDeps {
  f: Factories;
  admin: Guarded;
  url: (p: string) => string;
  run: RunState;
}

/** A value for one route param. Test-Org rows are rgr-, ledgered by the factories, cleaned at teardown. */
export function param(key: ParamKey, d: ParamDeps): Promise<string> {
  switch (key) {
    case "projectId": // a submitted wall: Design, Summary and Quotation are all open
      return once(key, async () => {
        const w = await readyWall(d.f, d.admin, d.url);
        await expectSubmitted(await d.admin.post(d.url(`/projects/${w.projectId}/submit-design`)));
        return w.projectId;
      });
    case "inquiryId":
      return once(key, async () => (await d.f.inquiry()).id);
    case "companyId":
      return once(key, async () => (await d.f.externalCompany()).id);
    case "userId":
      return once(key, async () => (await d.f.user("member")).id);
    case "setId": // the seeded formula set — the SA pages only READ it
      return Promise.resolve(d.run.formulaSetId);
    case "orgId": // this run's throwaway org B — the SA edit page is only READ
      return Promise.resolve(d.run.orgB.id);
  }
}

export async function paramsFor(pagePath: string, d: ParamDeps): Promise<Partial<Record<ParamKey, string>>> {
  const out: Partial<Record<ParamKey, string>> = {};
  for (const m of pagePath.matchAll(/\[(\w+)\]/g)) {
    const k = m[1] as ParamKey;
    if (k !== ("orgSlug" as ParamKey)) out[k] = await param(k, d);
  }
  return out;
}
