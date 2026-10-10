/**
 * Narrowing helpers for Prisma's known-request errors (Stage 31, S31-10).
 *
 * Narrow by `code` only. Never forward a Prisma `message` or `meta` to a response: both leak
 * model/column names and the failing invocation. Callers map the code to a fixed, hand-written message.
 */

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === code
  );
}

/** P2002 — unique constraint violation. */
export function isUniqueViolation(err: unknown): boolean {
  return hasCode(err, "P2002");
}

/** P2003 — foreign key constraint violation. */
export function isFkViolation(err: unknown): boolean {
  return hasCode(err, "P2003");
}

/** P2025 — record to update/delete not found. */
export function isRecordNotFound(err: unknown): boolean {
  return hasCode(err, "P2025");
}
