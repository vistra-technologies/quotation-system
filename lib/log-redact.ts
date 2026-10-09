/**
 * Redaction + error serialisation for lib/logger.ts (Stage 30, S30-7).
 *
 * Redaction lives in the logger so a call site cannot forget it. Pure functions, no I/O.
 */

/** Keys whose value is never logged (matched case-insensitively, at any depth <= MAX_DEPTH). */
export const DENY_KEYS: readonly string[] = Object.freeze([
  "password",
  "newPassword",
  "currentPassword",
  "initialAdminPassword",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "cookie",
  "set-cookie",
  "authorization",
  "username",
  "email",
  "phone",
  "ip",
  "x-forwarded-for",
  "x-real-ip",
]);

const DENY_LOWER = new Set(DENY_KEYS.map((k) => k.toLowerCase()));

/** Objects nested deeper than this are replaced by "[DEPTH]" rather than copied unscanned. */
export const MAX_DEPTH = 4;

const ENV_SECRET_NAMES = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "BETTER_AUTH_SECRET", "AXIOM_TOKEN"];
const MIN_SECRET_LENGTH = 4;
const DB_URL_RE = /postgres(?:ql)?:\/\/\S+/gi;

/** Literal env secrets present right now (read at call time so tests and env changes apply). */
function envSecrets(): string[] {
  const out: string[] = [];
  for (const name of ENV_SECRET_NAMES) {
    const v = process.env[name];
    if (v && v.length >= MIN_SECRET_LENGTH) out.push(v);
  }
  for (const [name, v] of Object.entries(process.env)) {
    if (/^SUPERADMIN_.*_PASSWORD$/.test(name) && v && v.length >= MIN_SECRET_LENGTH) out.push(v);
  }
  // Longest first so a secret that contains another is removed whole.
  return out.sort((a, b) => b.length - a.length);
}

/** Removes literal env secrets and postgres URLs from a string. */
export function scrubString(s: string): string {
  let out = s;
  for (const secret of envSecrets()) {
    if (out.includes(secret)) out = out.split(secret).join("[REDACTED]");
  }
  return out.replace(DB_URL_RE, "[REDACTED]");
}

/**
 * Deep-copies a value for logging: deny-listed keys -> "[REDACTED]", strings scrubbed, anything
 * deeper than MAX_DEPTH -> "[DEPTH]". Handles arrays, circular refs (via the depth cap), BigInt,
 * Date, Error and throwing getters; never throws.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  try {
    if (typeof value === "string") return scrubString(value);
    if (value === null || value === undefined) return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
    if (typeof value !== "object") return value;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (depth >= MAX_DEPTH) return "[DEPTH]";
    if (value instanceof Error) return serializeError(value);
    if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (DENY_LOWER.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
        continue;
      }
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[key];
      } catch {
        v = "[Unreadable]";
      }
      out[key] = redactValue(v, depth + 1);
    }
    return out;
  } catch {
    return "[Unserializable]";
  }
}

const STACK_MAX = 6 * 1024;
const MESSAGE_MAX = 1024;
const PRISMA_CODE_RE = /^P\d{4}$/;

export type SerializedError = {
  name: string;
  message?: string;
  stack?: string;
  cause?: SerializedError;
  prismaCode?: string;
  model?: string;
};

function serializeOne(err: unknown, withCause: boolean): SerializedError {
  if (!(err instanceof Error)) {
    let s: string;
    try {
      s = String(err);
    } catch {
      s = "[Unprintable]";
    }
    return { name: "NonError", message: scrubString(s).slice(0, 1024) };
  }
  const code = (err as { code?: unknown }).code;
  const isPrisma =
    (typeof code === "string" && PRISMA_CODE_RE.test(code)) || String(err.name).startsWith("PrismaClient");
  if (isPrisma) {
    // Never the message or meta: they carry query values (validation errors echo the whole payload).
    const meta = (err as { meta?: { modelName?: unknown } }).meta;
    const model = typeof meta?.modelName === "string" ? meta.modelName : undefined;
    const out: SerializedError = { name: err.name };
    if (typeof code === "string" && PRISMA_CODE_RE.test(code)) out.prismaCode = code;
    if (model) out.model = model;
    // Location only: stack frame lines, never the message line.
    if (err.stack) {
      const frames = err.stack.split("\n").filter((l) => /^\s+at /.test(l)).join("\n");
      if (frames) out.stack = scrubString(frames).slice(0, STACK_MAX);
    }
    return out;
  }
  const out: SerializedError = { name: err.name, message: scrubString(err.message).slice(0, MESSAGE_MAX) };
  if (err.stack) out.stack = scrubString(err.stack).slice(0, STACK_MAX);
  if (withCause && err.cause !== undefined) out.cause = serializeOne(err.cause, false);
  return out;
}

/** `{ name, message, stack (<= 6 KB), cause (one level) }`; Prisma errors (code P####, or any name starting `PrismaClient`) reduce to `{ name, prismaCode?, model?, stack frames }`. */
export function serializeError(err: unknown): SerializedError {
  try {
    return serializeOne(err, true);
  } catch {
    return { name: "Error", message: "[Unserializable]" };
  }
}
