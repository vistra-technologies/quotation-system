// This file is the one sanctioned console writer (Stage 30, S30-1); Batch 2 adds the no-console lint rule with an override for it.
import { BUFFER_CAP, getContext } from "@/lib/log-context";
import { redactValue, scrubString } from "@/lib/log-redact";

/**
 * The one logger (Stage 30, S30-1). One JSON line per call.
 *   info/debug -> console.log; warn/error -> console.error.
 * Redaction happens here (S30-7) so call sites cannot forget it. It never throws.
 * Outside a wrapped request it still writes to stdout, just without request context.
 */

type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export const MAX_LINE_BYTES = 8 * 1024;

function configuredLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  let level: Level = raw in RANK ? (raw as Level) : "info";
  // debug is forced off in production.
  if (level === "debug" && process.env.VERCEL_ENV === "production") level = "info";
  return level;
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  try {
    if (RANK[level] < RANK[configuredLevel()]) return;

    const ctx = getContext();
    const base: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: scrubString(String(msg)),
    };
    if (ctx) {
      base.requestId = ctx.requestId;
      if (ctx.parentRequestId) base.parentRequestId = ctx.parentRequestId;
      base.route = ctx.route;
      base.method = ctx.method;
      if (ctx.orgSlug) base.orgSlug = ctx.orgSlug;
      if (ctx.userId) base.userId = ctx.userId;
      if (ctx.saId) base.saId = ctx.saId;
    }
    base.env = process.env.VERCEL_ENV ?? "development";
    base.commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);

    const extra = (fields ? redactValue(fields) : {}) as Record<string, unknown>;
    let line = JSON.stringify({ ...base, ...extra });

    if (byteLength(line) > MAX_LINE_BYTES) {
      // Keep the identity/core keys and the small scalars the dashboards filter on; drop the rest.
      const kept: Record<string, unknown> = { ...base, truncated: true };
      for (const k of ["status", "durationMs", "ok", "outcome"]) {
        if (k in extra) kept[k] = extra[k];
      }
      line = JSON.stringify(kept);
      if (byteLength(line) > MAX_LINE_BYTES) {
        kept.msg = String(kept.msg).slice(0, 1000);
        line = JSON.stringify(kept);
      }
    }

    if (level === "warn" || level === "error") console.error(line);
    else console.log(line);

    if (ctx && ctx.buffer.length < BUFFER_CAP) ctx.buffer.push(line);
  } catch {
    try {
      console.error(
        JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "logger.failed" }),
      );
    } catch {
      // nothing left to do; a logger must never throw
    }
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
