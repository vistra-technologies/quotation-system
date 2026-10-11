/**
 * Bounded retry for the per-org number race (Stage 31, S31-12).
 *
 * `createProject`, `createInquiry` and `convertInquiryToProject` allocate `max(number) + 1` inside a
 * transaction; two concurrent creators can collide on the unique index, which the DAL reports as an error
 * with `code === "SEQUENCE_CONFLICT"`. `fn` is called again — so it must open a FRESH transaction on every
 * call — up to `maxAttempts` times in total. Any other error is rethrown at once; if the last attempt still
 * conflicts, that conflict is rethrown so the route returns its existing 409.
 */
export const SEQUENCE_RETRY_ATTEMPTS = 3;

function isSequenceConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "SEQUENCE_CONFLICT"
  );
}

export async function withSequenceRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = SEQUENCE_RETRY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isSequenceConflict(err) || attempt >= maxAttempts) throw err;
    }
  }
}
