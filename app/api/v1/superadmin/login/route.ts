import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toPlatformAuthEmail } from "@/lib/auth-utils";
import { SA_SESSION_COOKIE } from "@/lib/superadmin-guard";
import {
  findSuperAdminByEmail,
  createSuperAdminSession,
} from "@/lib/data/superadmin/sessions";

// Never cached.
export const dynamic = "force-dynamic";

// Constant-time dummy hash (salt:key in @better-auth/utils/password format).
// Used when the username is not found so timing is indistinguishable from a
// real failed verify — prevents user enumeration via response time.
// The salt (32 hex chars) and key (128 hex chars) are valid format but will
// never match any real password attempt.
const DUMMY_HASH = "a".repeat(32) + ":" + "b".repeat(128);

// ─── POST /api/v1/superadmin/login ──────────────────────────────────────────
//
// Authenticates a SuperAdmin by username + password.
// On success: creates a SuperAdminSession row and sets the qs-sa-token cookie
// with Domain intentionally omitted (RFC 6265 §5.3 — binds to the exact
// request host, easeetool.com, not sent to *.easeetool.com subdomains).
// On failure: constant-time 401 (always runs password.verify to prevent
// timing-based user enumeration).

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).username !== "string" ||
    typeof (body as Record<string, unknown>).password !== "string"
  ) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 },
    );
  }

  const { username, password } = body as { username: string; password: string };

  // Look up the SuperAdmin by platform email.
  const superAdmin = await findSuperAdminByEmail(toPlatformAuthEmail(username));

  // Always run password.verify — constant-time behavior regardless of whether
  // the username exists (prevents timing-based user enumeration).
  const authCtx = await auth.$context;
  const hashToVerify = superAdmin?.passwordHash ?? DUMMY_HASH;
  const valid = await authCtx.password.verify({
    hash: hashToVerify,
    password,
  });

  if (!superAdmin || !valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // ── Issue session ────────────────────────────────────────────────────────
  const { token, expiresAt } = await createSuperAdminSession(superAdmin.id);

  // ── Set the apex-only session cookie ────────────────────────────────────
  // Domain is intentionally OMITTED — RFC 6265 §5.3 binds the cookie to the
  // exact request host (easeetool.com) and does NOT send it to subdomains.
  // Do NOT add a `domain` key here even as `domain: undefined` — the
  // @edge-runtime/cookies implementation checks `"domain" in c` first.
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SA_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return response;
}
