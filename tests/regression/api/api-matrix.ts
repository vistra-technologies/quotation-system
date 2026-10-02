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
 * them creates data and nothing needs ledgering. Mutating requests still go through `Guarded`:
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
import type { Role, RunState } from "../fixtures/run-state";
import { apiUrl } from "../../e2e/helpers";
import { ROLES, deniedRolesFor, type PermissionCode } from "./permissions";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface Ctx {
  run: RunState;
  f: Factories;
  /** Org B's admin (guarded to org B) — to look up / create a foreign row for `foreignId`. */
  orgB: Guarded;
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
  /** Request body for the auth/tenancy cases (mutating methods). Default {}. */
  body?: (c: Ctx) => unknown;
  /** Each must be rejected with `status` (actor session, valid path). */
  invalid?: { name: string; body: unknown; status: number }[];
  /** Path (same convention as `path`) whose id does not exist → 404 (actor session). */
  unknownId?: (c: Ctx) => string;
  /** Path (same convention) whose id belongs to org B, addressed under the Test-Org slug → 404. */
  foreignId?: (c: Ctx) => Promise<string>;
  /** Default: true for POST/PATCH/PUT. */
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
      return g.delete(url);
    case "POST":
      return g.post(url, { data: body ?? {} });
    case "PATCH":
      return g.patch(url, { data: body ?? {} });
    case "PUT":
      return g.put(url, { data: body ?? {} });
  }
}

/** Absolute (subdomain-aware) URL: org-scoped paths go under /api/v1/orgs/<slug>. */
function urlFor(c: RouteCase, slug: string, p: string): string {
  return c.orgScoped === false ? apiUrl(slug, p) : apiUrl(slug, `/api/v1/orgs/${slug}${p}`);
}

export function registerNegatives(cases: RouteCase[]): void {
  for (const c of cases) {
    const actor = actorFor(c);
    test.describe(c.key, () => {
      test("401 without a session", async ({ anon, run, f, orgB }) => {
        const ctx: Ctx = { run, f, orgB };
        const r = await send(anon, c.method, urlFor(c, run.testOrg.slug, await c.path(ctx)), c.body?.(ctx));
        expect(r.status(), await r.text()).toBe(401);
      });

      for (const role of deniedRolesFor(c)) {
        test(`403 for ${role} (lacks ${[c.permission ?? "the required role"].flat().join(" | ")})`, async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const r = await send(as[role], c.method, urlFor(c, run.testOrg.slug, await c.path(ctx)), c.body?.(ctx));
          expect(r.status(), await r.text()).toBe(403);
        });
      }

      if (c.orgScoped !== false) {
        test("403 cross-tenant: a Test-Org session addressed at org B's slug", async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const g = new Guarded(as[actor].ctx, allowanceFromRun(run)); // org B is this run's throwaway org
          const r = await send(g, c.method, urlFor(c, run.orgB.slug, await c.path(ctx)), c.body?.(ctx));
          expect(r.status(), await r.text()).toBe(403);
        });

        test("404 unknown org slug", async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const ghostSlug = `${run.prefix}nosuch`; // rgr- namespace: no real org can hold it
          const g = new Guarded(as[actor].ctx, createAllowance([ghostSlug]));
          const r = await send(g, c.method, urlFor(c, ghostSlug, await c.path(ctx)), c.body?.(ctx));
          expect(r.status(), await r.text()).toBe(404);
        });
      }

      if (c.unknownId) {
        test("404 unknown id", async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const r = await send(as[actor], c.method, urlFor(c, run.testOrg.slug, c.unknownId!(ctx)), c.body?.(ctx));
          expect(r.status(), await r.text()).toBe(404);
        });
      }

      if (c.foreignId) {
        test("404 foreign id: an org-B id addressed under the Test-Org slug", async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const r = await send(as[actor], c.method, urlFor(c, run.testOrg.slug, await c.foreignId!(ctx)), c.body?.(ctx));
          expect(r.status(), await r.text()).toBe(404);
        });
      }

      if (c.malformedJson ?? hasBody(c.method)) {
        test("400 malformed JSON body", async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const url = urlFor(c, run.testOrg.slug, await c.path(ctx));
          const opts = { data: "{not json", headers: { "Content-Type": "application/json" } };
          const g = as[actor];
          const r = c.method === "POST" ? await g.post(url, opts) : c.method === "PATCH" ? await g.patch(url, opts) : await g.put(url, opts);
          expect(r.status(), await r.text()).toBe(400);
        });
      }

      for (const inv of c.invalid ?? []) {
        test(`${inv.status} invalid body: ${inv.name}`, async ({ as, run, f, orgB }) => {
          const ctx: Ctx = { run, f, orgB };
          const r = await send(as[actor], c.method, urlFor(c, run.testOrg.slug, await c.path(ctx)), inv.body);
          expect(r.status(), await r.text()).toBe(inv.status);
        });
      }
    });
  }
}
