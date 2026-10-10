/**
 * Fresh-session helpers for API specs that sign a user in themselves (instead of reusing a
 * storageState via the `as` fixture).
 *
 * Sign-in is rate-limited (better-auth special rule: 3 per 10 s per IP on /sign-in and /sign-up), so
 * specs keep sign-ins few and retry only on 429 (same shape as tests/e2e/helpers.ts apiSignIn).
 */
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { RUN_PASSWORD_ENV } from "../env";
import { apiUrl } from "../../e2e/helpers";
import { toAuthEmail } from "@/lib/auth-utils";

export const runPassword = (): string => {
  const p = process.env[RUN_PASSWORD_ENV];
  if (!p) throw new Error(`${RUN_PASSWORD_ENV} is not set - run under the regression global setup`);
  return p;
};

export const bypass = (): Record<string, string> => {
  const b = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return b ? { "x-vercel-protection-bypass": b } : {};
};

/**
 * POST to an auth endpoint, retrying only on 429 (waits X-Retry-After + 1 s). A cookie-bearing auth POST
 * needs a trusted Origin (better-auth CSRF check, 403 MISSING_OR_NULL_ORIGIN otherwise): pass
 * `{ Origin: trustedOrigin(...) }` in `headers` for those.
 */
export async function authPost(
  ctx: APIRequestContext,
  orgSlug: string,
  endpoint: string,
  data: unknown,
  headers?: Record<string, string>,
): Promise<APIResponse> {
  let r!: APIResponse;
  for (let attempt = 1; attempt <= 5; attempt++) {
    r = await ctx.post(apiUrl(orgSlug, `/api/auth/${endpoint}`), { data, headers });
    if (r.status() !== 429) return r;
    await new Promise((res) => setTimeout(res, (Number(r.headers()["x-retry-after"] ?? "10") + 1) * 1000));
  }
  return r;
}

/** The trusted Origin for this org's host (same shape health-auth.spec.ts sends for sign-out). */
export const trustedOrigin = (orgSlug: string, baseURL: string | undefined): string => new URL(apiUrl(orgSlug, "/"), baseURL).origin;

/** Sign `username` in on `ctx` (the context keeps the session cookie on success). */
export const signIn = (ctx: APIRequestContext, orgSlug: string, username: string, password: string): Promise<APIResponse> =>
  authPost(ctx, orgSlug, "sign-in/email", { email: toAuthEmail(username, orgSlug), password });

export const sessionCookieLine = (r: APIResponse): string | undefined =>
  r.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).find((v) => v.includes("session_token="));
