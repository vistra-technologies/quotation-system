import { prisma } from "@/lib/prisma";
import type { getSession } from "@/lib/session";

/**
 * Canonical permission codes — mirrors the 8-row Permission catalog seeded in
 * prisma/seed.ts.  Import these constants instead of using magic strings.
 */
export const PERMISSIONS = {
  MANAGE_USERS: "MANAGE_USERS",
  MANAGE_FEATURES: "MANAGE_FEATURES",
  VIEW_ALL_DATA: "VIEW_ALL_DATA",
  MANAGE_PRICING: "MANAGE_PRICING",
  APPLY_DISCOUNT: "APPLY_DISCOUNT",
  DESIGN: "DESIGN",
  QUOTE: "QUOTE",
  ORDER: "ORDER",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Thrown when no session exists (not authenticated). */
export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/** Thrown when a session exists but the role lacks the requested permission. */
export class ForbiddenError extends Error {
  constructor(permissionCode: string) {
    super(`Forbidden: missing permission ${permissionCode}`);
    this.name = "ForbiddenError";
  }
}

/**
 * Asserts that the given session's role has the requested permission.
 *
 * Throws:
 * - `UnauthorizedError` — if `session` is null (caller should redirect to login).
 * - `ForbiddenError`    — if the role exists but lacks `permissionCode`.
 *
 * @example
 * // In a Server Component or Route Handler:
 * const session = await getSession();
 * await requirePermission(session, PERMISSIONS.MANAGE_USERS);
 */
export async function requirePermission(
  session: Awaited<ReturnType<typeof getSession>>,
  permissionCode: string,
): Promise<void> {
  if (!session) {
    throw new UnauthorizedError();
  }

  const link = await prisma.rolePermission.findFirst({
    where: {
      roleId: session.roleId,
      permission: { code: permissionCode },
    },
  });

  if (!link) {
    throw new ForbiddenError(permissionCode);
  }
}
