import type { Prisma } from "@/app/generated/prisma/client";

/** SuperAdmin-editable range for Organization.userLimit (the DB CHECK is only >= 1). */
export const USER_LIMIT_MIN = 1;
export const USER_LIMIT_MAX = 10000;
export const USER_LIMIT_RANGE_MESSAGE = `userLimit must be a whole number between ${USER_LIMIT_MIN} and ${USER_LIMIT_MAX}`;

/** True for an integer in [1, 10000]. The org create and PATCH routes both use it (400 otherwise). */
export function isValidUserLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= USER_LIMIT_MIN &&
    value <= USER_LIMIT_MAX
  );
}

/**
 * Thrown by assertUserSeatAvailable when the org already holds `limit` users.
 * Routes map it to HTTP 409 `{ error, code: "USER_LIMIT_REACHED", limit, current }`.
 */
export class UserLimitReachedError extends Error {
  readonly code = "USER_LIMIT_REACHED" as const;
  constructor(
    readonly limit: number,
    readonly current: number,
  ) {
    super(`User limit reached (${current}/${limit})`);
    this.name = "UserLimitReachedError";
  }
}

/**
 * Assert the org has a free user seat (Stage 29, S29-7). The ONE copy of this check: every
 * `user.create` path in the product calls it (org-admin createUser, SuperAdmin createUserInOrg).
 * `prisma/seed.ts` is deliberately exempt (a maintenance script, not a product path), and org
 * creation needs no count (the initial admin is user 1 and the limit is validated >= 1).
 *
 * MUST run inside the same `$transaction` as the `user.create` it guards:
 *   1. lock the org row (`SELECT ... FOR UPDATE`, the app's one sanctioned raw-SQL call), so
 *      concurrent adds for the same org serialise here;
 *   2. count the org's users (every row, active or deactivated). Under Read Committed the count
 *      runs after the lock is held, so it sees any concurrent insert that already committed;
 *   3. throw if the count is at or above the limit.
 * No TOCTOU window. Lowering the limit below usage is allowed; it only blocks new adds.
 */
export async function assertUserSeatAvailable(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ userLimit: number }[]>`
    SELECT "userLimit" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE
  `;
  if (rows.length === 0) throw new Error("Organization not found");
  const limit = rows[0].userLimit;
  const current = await tx.user.count({ where: { organizationId } });
  if (current >= limit) throw new UserLimitReachedError(limit, current);
}
