/**
 * SuperAdmin account rules shared by the DAL, the API routes and the UI (hotfix 2026-10-02).
 * Pure module — no I/O — so it is unit-testable and safe to import from client components.
 */

/** The bootstrap account that can never be deleted (its password can still be changed). */
export const PROTECTED_SUPERADMIN_USERNAME = "devadmin";

/** Lowercase letters, digits, `.`, `_`, `-`; 2–32 chars; must start with a letter or digit. */
export const SUPERADMIN_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export const SUPERADMIN_PASSWORD_MIN = 8;

export function isProtectedSuperAdmin(username: string): boolean {
  return username === PROTECTED_SUPERADMIN_USERNAME;
}

/** Returns an error message, or null when valid. Input is expected already trimmed/lowercased. */
export function validateSuperAdminUsername(username: string): string | null {
  if (!SUPERADMIN_USERNAME_RE.test(username)) {
    return "username must be 2–32 characters: lowercase letters, digits, '.', '_' or '-', starting with a letter or digit";
  }
  return null;
}

export function validateSuperAdminPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < SUPERADMIN_PASSWORD_MIN) {
    return `password must be at least ${SUPERADMIN_PASSWORD_MIN} characters`;
  }
  return null;
}

export type DeleteGuard =
  | { allowed: true }
  | { allowed: false; reason: "protected" | "self" | "last_admin"; message: string };

/**
 * Decide whether a SuperAdmin may be deleted. Order matters: protected beats self (deleting
 * `devadmin` while signed in as `devadmin` reports "protected").
 */
export function checkDeleteAllowed(args: {
  targetUsername: string;
  targetId: string;
  actingId: string;
  totalAdmins: number;
}): DeleteGuard {
  if (isProtectedSuperAdmin(args.targetUsername)) {
    return {
      allowed: false,
      reason: "protected",
      message: `"${PROTECTED_SUPERADMIN_USERNAME}" is a protected account and cannot be deleted`,
    };
  }
  if (args.targetId === args.actingId) {
    return { allowed: false, reason: "self", message: "Cannot delete your own account" };
  }
  if (args.totalAdmins <= 1) {
    return {
      allowed: false,
      reason: "last_admin",
      message: "Cannot delete the last remaining SuperAdmin",
    };
  }
  return { allowed: true };
}
