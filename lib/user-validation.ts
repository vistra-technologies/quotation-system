/**
 * Pure user-admin validation shared by the user routes, the server actions and the account popup
 * (Stage 31 S31-3). No server imports, so it is safe in client components and unit-testable.
 */

export const MIN_PASSWORD_LENGTH = 8;

/** 400 body text for a too-short password (create, admin reset). */
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;

export const PROFILE_EMAIL_INVALID_MESSAGE = "profileEmail must be a valid email address";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when the password meets the minimum length (no trimming: spaces count). */
export function isValidPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Profile (contact) email format check, after trim. `null`, `undefined` and blank are allowed
 * (the field is optional); anything else must look like `a@b.c`.
 */
export function isValidProfileEmail(v: string | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  const t = v.trim();
  if (t === "") return true;
  return EMAIL_RE.test(t);
}
