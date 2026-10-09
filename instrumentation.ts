import { flushToAxiom } from "@/lib/axiom";
import { runWithContext, type LogContext } from "@/lib/log-context";
import { log } from "@/lib/logger";
import { serializeError } from "@/lib/log-redact";
import { requestIdFrom } from "@/lib/request-id";

/**
 * Next.js instrumentation hook (Stage 30, S30-9). Fires for server render, action and proxy
 * errors that the route/action wrappers do not see. One `server.error` line; never headers
 * (only `x-vercel-id` is read, to correlate with Vercel's own log id).
 * Stage 30 Batch 3: the line goes to Axiom through one awaited send (S30-8 / N-3).
 * (Next docs: 01-app/03-api-reference/03-file-conventions/instrumentation.md)
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: unknown },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  const vercelId = (request.headers as Record<string, unknown> | null | undefined)?.["x-vercel-id"];
  const ctx: LogContext = {
    requestId: requestIdFrom(typeof vercelId === "string" ? vercelId : null),
    route: context.routePath,
    method: request.method,
    buffer: [],
  };
  runWithContext(ctx, () => {
    log.error("server.error", {
      digest: (err as { digest?: string } | null)?.digest,
      routePath: context.routePath,
      routeType: context.routeType,
      path: request.path.split("?")[0],
      err: serializeError(err),
    });
  });
  // Awaited: this hook is not a request wrapper, so there is no after() to lean on.
  await flushToAxiom(ctx.buffer);
}
