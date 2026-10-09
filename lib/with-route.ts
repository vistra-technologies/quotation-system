import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { after, NextResponse } from "next/server";
import { apiServerError } from "@/lib/api-error";
import { runWithContext, type LogContext } from "@/lib/log-context";
import { log } from "@/lib/logger";
import { serializeError } from "@/lib/log-redact";

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

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * requestId = the segment after the last `::` of x-vercel-id (equals Vercel's runtime-log id);
 * randomUUID() when the header is missing, empty, or the segment fails REQUEST_ID_RE (Stage 30 S2 ruling).
 */
export function requestIdFrom(vercelId: string | null | undefined): string {
  const seg = (vercelId ?? "").split("::").pop() ?? "";
  return REQUEST_ID_RE.test(seg) ? seg : randomUUID();
}

/** Placeholder for the Axiom transport (Batch 3). Kept here so `after()` is already registered. */
function flushBuffer(buffer: unknown[]): number {
  return buffer.length;
}

/** Registers the end-of-request flush. `after()` throws outside a Next request scope (unit tests). */
function registerFlush(buffer: unknown[]): void {
  try {
    after(() => {
      flushBuffer(buffer);
    });
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
      try {
        const result = await fn(...args);
        log.info("action.end", { ok: true, durationMs: Date.now() - started });
        return result;
      } catch (err) {
        const digest = digestOf(err);
        if (digest.startsWith("NEXT_REDIRECT")) {
          log.info("action.end", { ok: true, outcome: "redirect", durationMs: Date.now() - started });
        } else if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
          log.info("action.end", { ok: false, outcome: "not_found", durationMs: Date.now() - started });
        } else {
          log.error("action.end", {
            ok: false,
            durationMs: Date.now() - started,
            err: serializeError(err),
          });
        }
        throw err;
      }
    });
  };
}
