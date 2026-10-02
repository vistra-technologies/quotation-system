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

/** POST to an auth endpoint, retrying only on 429 (waits X-Retry-After + 1 s). */
export async function authPost(ctx: APIRequestContext, orgSlug: string, endpoint: string, data: unknown): Promise<APIResponse> {
  let r!: APIResponse;
  for (let attempt = 1; attempt <= 5; attempt++) {
    r = await ctx.post(apiUrl(orgSlug, `/api/auth/${endpoint}`), { data });
    if (r.status() !== 429) return r;
    await new Promise((res) => setTimeout(res, (Number(r.headers()["x-retry-after"] ?? "10") + 1) * 1000));
  }
  return r;
}

/** Sign `username` in on `ctx` (the context keeps the session cookie on success). */
export const signIn = (ctx: APIRequestContext, orgSlug: string, username: string, password: string): Promise<APIResponse> =>
  authPost(ctx, orgSlug, "sign-in/email", { email: toAuthEmail(username, orgSlug), password });

export const sessionCookieLine = (r: APIResponse): string | undefined =>
  r.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).find((v) => v.includes("session_token="));
