import { log } from "@/lib/logger";
import { serializeError } from "@/lib/log-redact";

/**
 * Next.js instrumentation hook (Stage 30, S30-9). Fires for server render, action and proxy
 * errors that the route/action wrappers do not see. One `server.error` line; never headers.
 * (Next docs: 01-app/03-api-reference/03-file-conventions/instrumentation.md)
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: unknown },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  log.error("server.error", {
    digest: (err as { digest?: string } | null)?.digest,
    routePath: context.routePath,
    routeType: context.routeType,
    path: request.path.split("?")[0],
    err: serializeError(err),
  });
}
