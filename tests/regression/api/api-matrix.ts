/**
 * Descriptor-driven negative-case matrix for API routes (Tasks 6-11).
 *
 * `registerNegatives(cases)` emits, per RouteCase, inside a `describe(key)`:
 *   - 401 without a session (anon client)
 *   - 403 for every Test-Org role that lacks `permission` (or exactly `deniedRoles`)
 *   - org-scoped only: 403 cross-tenant (Test-Org session addressed at org B's slug — getApiSession
 *     resolves the org first, then compares it to the session's org) and 404 unknown org slug
 *   - 404 unknown id (`unknownId`), 404 foreign id (`foreignId`: an org-B id under the Test-Org slug)
 *   - 400 malformed JSON body (POST/PATCH/PUT, unless `malformedJson: false`)
 *   - every `invalid` body case
 *
 * Every case is rejected before any write (auth/tenancy/permission/lookup/parse gates), so none of
 * them creates data and nothing needs ledgering. If a route WRONGLY accepts one (2xx), the case fails
 * loudly saying so — and because `body` / `invalid` payloads MUST use run-prefixed `rgr-` names
 * (run.prefix) for every name/label/username/code they carry, a row created by such a leak is still
 * caught and deleted by the teardown sweep. Mutating requests still go through `Guarded`:
 * cross-tenant probes use an allowance of exactly {Test Org, org B} (this run's throwaway org), the
 * unknown-slug probe an allowance of exactly the run-prefixed ghost slug (no such org exists).
 *
 * Coverage: the coverage CLI only reads LITERAL `covers("...")` calls in *.spec.ts files, so each
 * spec must still call `covers()` for every key it passes here.
 */
import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/test";
import { Guarded, allowanceFromRun, createAllowance } from "../fixtures/clients";
import type { Factories } from "../fixtures/factories";
import type { Ledger } from "../fixtures/ledger";
import type { Role, RunState } from "../fixtures/run-state";
import { apiUrl } from "../../e2e/helpers";
import { ROLES, deniedRolesFor, type PermissionCode } from "./permissions";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface Ctx {
  run: RunState;
  f: Factories;
  /** Org B's admin (guarded to org B) — to look up / create a foreign row for `foreignId`. */
  orgB: Guarded;
  /** Test-Org role clients — for looking up ids (e.g. a role id) a path or body needs. */
  as: Record<Role, Guarded>;
  /** The run ledger — anything a path/body helper creates must be added here the moment it exists. */
  ledger: Ledger;
}

export interface RouteCase {
  /** "POST /api/v1/orgs/[orgSlug]/projects" — the describe title (call covers() with it in the spec). */
  key: string;
  method: Method;
  /**
   * Org-scoped (default): the path AFTER /api/v1/orgs/<slug>, e.g. "/projects/<id>".
   * `orgScoped: false`: the full API path, e.g. "/api/v1/permissions".
   */
  path: (c: Ctx) => string | Promise<string>;
  /** Default true. false = a route without an org slug (no cross-tenant / unknown-slug cases). */
  orgScoped?: boolean;
  /** Required permission; an array means "any of". Roles holding none of them must get 403. */
  permission?: PermissionCode | PermissionCode[];
  /** Overrides the roles derived from `permission` (for routes with bespoke role rules). */
  deniedRoles?: Role[];
  /** Role used for the authenticated cases. Default: admin, else the first role allowed through. */
  actor?: Role;
  /** Request body for the auth/tenancy cases (mutating methods). Default {}. Names MUST be rgr- (run.prefix). */
  body?: (c: Ctx) => unknown | Promise<unknown>;
  /**
   * Each must be rejected with `status` (actor session, valid path). Names MUST be rgr- (run.prefix).
   * `body` may be a function of the Ctx when it needs run-scoped values (run.prefix, a looked-up id).
   */
  invalid?: { name: string; body: unknown | ((c: Ctx) => unknown | Promise<unknown>); status: number }[];
  /** Path (same convention as `path`) whose id does not exist → 404 (actor session). */
  unknownId?: (c: Ctx) => string;
  /** Path (same convention) whose id belongs to org B, addressed under the Test-Org slug → 404. */
  foreignId?: (c: Ctx) => Promise<string>;
  /** Default: true for POST/PATCH/PUT (a DELETE that reads a JSON body must opt in). */
  malformedJson?: boolean;
}

/** A syntactically valid id (uuid v4) that no row has. */
export const GHOST = "00000000-0000-4000-8000-000000000000";

const hasBody = (m: Method) => m === "POST" || m === "PATCH" || m === "PUT";

function actorFor(c: RouteCase): Role {
  if (c.actor) return c.actor;
  const denied = new Set(deniedRolesFor(c));
  const ok = ROLES.find((r) => !denied.has(r));
  if (!ok) throw new Error(`${c.key}: every role is denied — set \`actor\` explicitly`);
  return ok;
}

function send(g: Guarded, method: Method, url: string, body?: unknown): Promise<APIResponse> {
  switch (method) {
    case "GET":
      return g.get(url);
    case "DELETE":
      // a few DELETE routes read a JSON body (e.g. roles/[roleId]/permissions): send it when given
      return body === undefined ? g.delete(url) : g.delete(url, { data: body });
    case "POST":
      return g.post(url, { data: body ?? {} });
    case "PATCH":
      return g.patch(url, { data: body ?? {} });
    case "PUT":
      return g.put(url, { data: body ?? {} });
  }
}

/**
 * Asserts the exact rejection status, but first fails with an explicit message when the request was
 * ACCEPTED (2xx): a negative case must never write, and anything it created is an unledgered row.
 */
async function expectRejected(r: APIResponse, status: number, what: string): Promise<void> {
  const text = await r.text();
  if (r.ok()) {
    throw new Error(
      `${what}: expected ${status} but the request was ACCEPTED (HTTP ${r.status()}) — a negative case wrote ` +
        `through; any row it created is unledgered (a stray the rgr- teardown sweep must remove). Body: ${text.slice(0, 500)}`,
    );
  }
  expect(r.status(), text).toBe(status);
}

/** Absolute (subdomain-aware) URL: org-scoped paths go under /api/v1/orgs/<slug>. */
function urlFor(c: RouteCase, slug: string, p: string): string {
  return c.orgScoped === false ? apiUrl(slug, p) : apiUrl(slug, `/api/v1/orgs/${slug}${p}`);
}

export function registerNegatives(cases: RouteCase[]): void {
  const keys = new Set<string>();
  for (const c of cases) {
    if (keys.has(c.key)) throw new Error(`registerNegatives: duplicate key "${c.key}"`);
    keys.add(c.key);
    const names = new Set<string>();
    for (const inv of c.invalid ?? []) {
      if (names.has(inv.name)) throw new Error(`registerNegatives: duplicate invalid case "${inv.name}" in "${c.key}"`);
      names.add(inv.name);
    }
  }
  for (const c of cases) {
    const actor = actorFor(c);
    test.describe(c.key, () => {
      test("401 without a session", async ({ anon, as, run, f, orgB, ledger }) => {
        const ctx: Ctx = { run, f, orgB, as, ledger };
        const r = await send(anon, c.method, urlFor(c, run.testOrg.slug, await c.path(ctx)), await c.body?.(ctx));
        await expectRejected(r, 401, `${c.key}: ${test.info().title}`);
      });

      for (const role of deniedRolesFor(c)) {
        test(`403 for ${role} (lacks ${[c.permission ?? "the required role"].flat().join(" | ")})`, async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const r = await send(as[role], c.method, urlFor(c, run.testOrg.slug, await c.path(ctx)), await c.body?.(ctx));
          await expectRejected(r, 403, `${c.key}: ${test.info().title}`);
        });
      }

      if (c.orgScoped !== false) {
        test("403 cross-tenant: a Test-Org session addressed at org B's slug", async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const g = new Guarded(as[actor].ctx, allowanceFromRun(run)); // org B is this run's throwaway org
          const r = await send(g, c.method, urlFor(c, run.orgB.slug, await c.path(ctx)), await c.body?.(ctx));
          await expectRejected(r, 403, `${c.key}: ${test.info().title}`);
        });

        test("404 unknown org slug", async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const ghostSlug = `${run.prefix}nosuch`; // rgr- namespace: no real org can hold it
          const g = new Guarded(as[actor].ctx, createAllowance([ghostSlug]));
          const r = await send(g, c.method, urlFor(c, ghostSlug, await c.path(ctx)), await c.body?.(ctx));
          await expectRejected(r, 404, `${c.key}: ${test.info().title}`);
        });
      }

      if (c.unknownId) {
        test("404 unknown id", async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const r = await send(as[actor], c.method, urlFor(c, run.testOrg.slug, c.unknownId!(ctx)), await c.body?.(ctx));
          await expectRejected(r, 404, `${c.key}: ${test.info().title}`);
        });
      }

      if (c.foreignId) {
        test("404 foreign id: an org-B id addressed under the Test-Org slug", async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const r = await send(as[actor], c.method, urlFor(c, run.testOrg.slug, await c.foreignId!(ctx)), await c.body?.(ctx));
          await expectRejected(r, 404, `${c.key}: ${test.info().title}`);
        });
      }

      if (c.malformedJson ?? hasBody(c.method)) {
        test("400 malformed JSON body", async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const url = urlFor(c, run.testOrg.slug, await c.path(ctx));
          // A Buffer, not a string: Playwright JSON-encodes a non-parsable STRING under a JSON content-type
          // (it would arrive as the valid JSON string "{not json"), so only raw bytes are truly malformed.
          const opts = { data: Buffer.from("{not json"), headers: { "Content-Type": "application/json" } };
          const g = as[actor];
          const r =
            c.method === "POST" ? await g.post(url, opts)
            : c.method === "PATCH" ? await g.patch(url, opts)
            : c.method === "DELETE" ? await g.delete(url, opts)
            : await g.put(url, opts);
          await expectRejected(r, 400, `${c.key}: ${test.info().title}`);
        });
      }

      for (const inv of c.invalid ?? []) {
        test(`${inv.status} invalid body: ${inv.name}`, async ({ as, run, f, orgB, ledger }) => {
          const ctx: Ctx = { run, f, orgB, as, ledger };
          const body = typeof inv.body === "function" ? await (inv.body as (c: Ctx) => unknown)(ctx) : inv.body;
          const r = await send(as[actor], c.method, urlFor(c, run.testOrg.slug, await c.path(ctx)), body);
          await expectRejected(r, inv.status, `${c.key}: ${test.info().title}`);
        });
      }
    });
  }
}
