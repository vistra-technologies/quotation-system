import { isDeepStrictEqual } from "node:util";

export interface GlobalStateSpec {
  key: string;
  read(): Promise<unknown>;
  write(v: unknown): Promise<void>;
}

/**
 * record original → mutate → run body → ALWAYS revert → re-read and verify.
 * A revert that does not take is pushed to `failures` (the run fails with a dedicated section).
 */
export async function withGlobalState<T>(
  spec: GlobalStateSpec,
  mutate: () => Promise<void>,
  body: () => Promise<T>,
  failures: string[],
): Promise<T> {
  const original = await spec.read();
  try {
    await mutate();
    return await body();
  } finally {
    try {
      await spec.write(original);
      const after = await spec.read();
      if (!isDeepStrictEqual(after, original)) {
        failures.push(`global state "${spec.key}" NOT restored: expected ${JSON.stringify(original)}, found ${JSON.stringify(after)}`);
      }
    } catch (err) {
      failures.push(`global state "${spec.key}" revert threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
