/**
 * Pure validation for PATCH /api/v1/orgs/[orgSlug]/me (Hotfix 2026-10-10, My Account popup).
 *
 * A user may edit only these four fields of their own row. Any other key (username, roleId,
 * organizationId, externalCompanyId, active, email, ...) is rejected, not ignored, so a
 * privilege-changing attempt is loud and pinned by a regression test. Kept apart from the
 * route so it is unit-testable.
 */

import { isValidProfileEmail } from "@/lib/user-validation";

export const OWN_PROFILE_KEYS = ["firstName", "lastName", "mobile", "profileEmail"] as const;

export const MAX_NAME_LENGTH = 100;
export const MAX_MOBILE_LENGTH = 30;
export const MAX_EMAIL_LENGTH = 254;


export type OwnProfileInput = {
  firstName?: string;
  lastName?: string;
  mobile?: string | null;
  profileEmail?: string | null;
};

export type OwnProfileParse =
  | { ok: true; input: OwnProfileInput }
  | { ok: false; error: string };

export function parseOwnProfileInput(body: unknown): OwnProfileParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }
  const o = body as Record<string, unknown>;
  const allowed = new Set<string>(OWN_PROFILE_KEYS);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) return { ok: false, error: `Unknown field: ${k}` };
  }
  if (!OWN_PROFILE_KEYS.some((k) => k in o)) {
    return { ok: false, error: "No editable field supplied" };
  }

  const input: OwnProfileInput = {};

  for (const k of ["firstName", "lastName"] as const) {
    if (!(k in o)) continue;
    const v = typeof o[k] === "string" ? (o[k] as string).trim() : "";
    if (!v) return { ok: false, error: `${k} cannot be empty` };
    if (v.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `${k} must be at most ${MAX_NAME_LENGTH} characters` };
    }
    input[k] = v;
  }

  if ("mobile" in o) {
    if (o.mobile !== null && typeof o.mobile !== "string") {
      return { ok: false, error: "mobile must be a string" };
    }
    const v = typeof o.mobile === "string" ? o.mobile.trim() : "";
    if (v.length > MAX_MOBILE_LENGTH) {
      return { ok: false, error: `mobile must be at most ${MAX_MOBILE_LENGTH} characters` };
    }
    input.mobile = v || null;
  }

  if ("profileEmail" in o) {
    if (o.profileEmail !== null && typeof o.profileEmail !== "string") {
      return { ok: false, error: "profileEmail must be a string" };
    }
    const v = typeof o.profileEmail === "string" ? o.profileEmail.trim() : "";
    if (v && (v.length > MAX_EMAIL_LENGTH || !isValidProfileEmail(v))) {
      return { ok: false, error: "profileEmail must be a valid email address" };
    }
    input.profileEmail = v || null;
  }

  return { ok: true, input };
}
