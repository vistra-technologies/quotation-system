import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { after, NextResponse } from "next/server";
import { apiServerError } from "@/lib/api-error";
import { flushToAxiom } from "@/lib/axiom";
import { runWithContext, type LogContext } from "@/lib/log-context";
import { log } from "@/lib/logger";
import { serializeError } from "@/lib/log-redact";
import { REQUEST_ID_RE, requestIdFrom } from "@/lib/request-id";

export { requestIdFrom };

/**
 * Request wrappers (Stage 30, S30-4 / S30-5).
 *
 *   export const GET = withRoute("GET /api/v1/...", async (request, { params }) => { ... });
 *   export const act = withAction("app/.../actions#act", async (prev, formData) => { ... });
 *
 * Each runs the body inside an AsyncLocalStorage context (lib/log-context.ts), times it, and writes
 * exactly one terminal line: request.end / request.unhandled (routes) or action.end (actions).
 * Neither wrapper ever reads a request body.
 */

const PARENT_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

const MAX_QUERY_IDS = 5;

/**
 * S32-3: keeps string-valued route params that are id-shaped. Arrays (the `[...all]` catch-all) and anything
 * longer or outside the id shape are dropped. The params Promise is awaited in its own try/catch so a missing
 * or rejecting `params` never fails the request.
 */
async function readParams(rest: unknown[]): Promise<Record<string, string> | undefined> {
  try {
    const raw = await (rest[0] as { params?: unknown } | undefined)?.params;
    if (!raw || typeof raw !== "object") return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && REQUEST_ID_RE.test(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/** S32-4: only `*Id` query keys with an id-shaped value, at most 5. Nothing else from the query is read. */
function readQueryIds(request: Request): Record<string, string> | undefined {
  try {
    const out: Record<string, string> = {};
    for (const [k, v] of new URL(request.url).searchParams) {
      if (Object.keys(out).length >= MAX_QUERY_IDS) break;
      if (/Id$/.test(k) && !(k in out) && REQUEST_ID_RE.test(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Registers the end-of-request Axiom flush (S30-8). The buffer is captured BY REFERENCE: ALS is not
 * readable inside `after()` (spike S3). `after()` throws outside a Next request scope (unit tests).
 */
function registerFlush(buffer: unknown[]): void {
  try {
    after(() => flushToAxiom(buffer));
  } catch {
    // no request scope: nothing to flush after
  }
}

function levelForStatus(status: number): "error" | "warn" | "info" {
  if (status >= 500) return "error";
  if ([400, 409, 413, 422, 429].includes(status)) return "warn";
  return "info";
}

function setRequestIdHeader<T extends Response>(res: T, requestId: string): T {
  try {
    res.headers.set("x-request-id", requestId);
    return res;
  } catch {
    // Immutable headers (e.g. Response.redirect / fetch responses): rebuild.
    const copy = new Response(res.body, res);
    copy.headers.set("x-request-id", requestId);
    return copy as T;
  }
}

export function withRoute<A extends unknown[], R extends Response>(
  routeId: string,
  handler: (request: Request, ...rest: A) => Promise<R> | R,
): (request: Request, ...rest: A) => Promise<R | NextResponse> {
  return async (request: Request, ...rest: A): Promise<R | NextResponse> => {
    const requestId = requestIdFrom(request.headers.get("x-vercel-id"));
    const parent = request.headers.get("x-parent-request-id");
    const ctx: LogContext = {
      requestId,
      route: routeId,
      method: request.method,
      buffer: [],
    };
    if (parent && PARENT_ID_RE.test(parent)) ctx.parentRequestId = parent;
    const params = await readParams(rest);
    if (params) ctx.params = params;
    const queryIds = readQueryIds(request);
    if (queryIds) ctx.queryIds = queryIds;
    registerFlush(ctx.buffer);

    return runWithContext(ctx, async () => {
      const started = Date.now();
      try {
        const res = await handler(request, ...rest);
        const out = setRequestIdHeader(res, requestId);
        log[levelForStatus(out.status)]("request.end", {
          status: out.status,
          durationMs: Date.now() - started,
        });
        return out;
      } catch (err) {
        // Next control flow (redirect / notFound / dynamic-usage bailouts) must pass through.
        unstable_rethrow(err);
        log.error("request.unhandled", {
          status: 500,
          durationMs: Date.now() - started,
          err: serializeError(err),
        });
        return setRequestIdHeader(apiServerError(), requestId);
      }
    });
  };
}

function digestOf(err: unknown): string {
  const d = (err as { digest?: unknown } | null)?.digest;
  return typeof d === "string" ? d : "";
}

/**
 * Best-effort identity for an action's log context (S30-15 / bugs-1 finding 1). Thin-marshaler actions
 * only call internalFetch and never getSession(), so nothing would set orgSlug/userId/saId on
 * `action.end`. This starts the cached getSession() (and, if there is no org session, the SuperAdmin
 * lookup) concurrently with the action body; both call setContext() on the active store. Cost: every
 * wrapped action pays ~3 indexed single-row reads (auth session, org, role; 1 for SuperAdmin), run in
 * parallel with the body, so added latency is ~0. The per-request cache does NOT dedupe inside server
 * actions: a getSession() the body makes itself is a separate read. Never throws.
 */
async function defaultResolveIdentity(): Promise<void> {
  try {
    const { getSession } = await import("@/lib/session");
    if (await getSession()) return;
    const { requireSuperAdmin } = await import("@/lib/superadmin-guard");
    await requireSuperAdmin();
  } catch {
    // no session / no request scope: the line simply carries no identity
  }
}

let identityResolver: () => Promise<void> = defaultResolveIdentity;
/** Test seam: replaces the identity lookup. Pass nothing to restore the default. */
export function setActionIdentityResolver(fn?: () => Promise<void>): void {
  identityResolver = fn ?? defaultResolveIdentity;
}

/** Max time `action.end` waits for the identity lookup; the action itself is never held up beyond this. */
const IDENTITY_WAIT_MS = 1000;

async function settleIdentity(pending: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, IDENTITY_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function withAction<A extends unknown[], R>(
  actionId: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    let requestId: string | null = null;
    try {
      requestId = (await headers()).get("x-vercel-id");
    } catch {
      // no request scope
    }
    const ctx: LogContext = {
      requestId: requestIdFrom(requestId),
      route: actionId,
      method: "ACTION",
      buffer: [],
    };
    registerFlush(ctx.buffer);

    return runWithContext(ctx, async () => {
      const started = Date.now();
      let identity: Promise<void> = Promise.resolve();
      try {
        identity = identityResolver().catch(() => undefined);
      } catch {
        // a throwing resolver must not affect the action
      }
      try {
        const result = await fn(...args);
        const durationMs = Date.now() - started;
        await settleIdentity(identity);
        log.info("action.end", { ok: true, durationMs });
        return result;
      } catch (err) {
        const durationMs = Date.now() - started;
        await settleIdentity(identity);
        const digest = digestOf(err);
        if (digest.startsWith("NEXT_REDIRECT")) {
          log.info("action.end", { ok: true, outcome: "redirect", durationMs });
        } else if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
          log.info("action.end", { ok: false, outcome: "not_found", durationMs });
        } else {
          log.error("action.end", {
            ok: false,
            durationMs,
            err: serializeError(err),
          });
        }
        throw err;
      }
    });
  };
}
