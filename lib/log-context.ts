import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request log context (Stage 30, S30-2).
 *
 * The AsyncLocalStorage object is module-level; the STORE (the per-request state) is created by
 * the wrappers in lib/with-route.ts and never shared between requests. Fluid compute runs many
 * requests in one instance, which is why this is ALS and not a module variable.
 */

export type LogContext = {
  requestId: string;
  parentRequestId?: string;
  route: string;
  method: string;
  orgSlug?: string;
  userId?: string;
  saId?: string;
  /** Lines written during this request (capped). Drained by the transport in a later batch. */
  buffer: unknown[];
};

export const BUFFER_CAP = 200;

const als = new AsyncLocalStorage<LogContext>();

export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): LogContext | undefined {
  return als.getStore();
}

/** Merges identity fields into the active context. No-op outside a wrapped request. */
export function setContext(patch: Partial<Pick<LogContext, "orgSlug" | "userId" | "saId">>): void {
  const ctx = als.getStore();
  if (!ctx) return;
  if (patch.orgSlug !== undefined) ctx.orgSlug = patch.orgSlug;
  if (patch.userId !== undefined) ctx.userId = patch.userId;
  if (patch.saId !== undefined) ctx.saId = patch.saId;
}
