import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

/** The file global-teardown reads (a JSON string array) to fail the run on a revert that did not take. */
export function globalStateFailuresFile(storageDir: string): string {
  return path.join(storageDir, "global-state-failures.json");
}

/** Merge `failures` into the JSON array at `file` (created if missing). No-op for an empty list. */
export function appendGlobalStateFailures(file: string, failures: string[]): void {
  if (failures.length === 0) return;
  let existing: string[] = [];
  if (fs.existsSync(file)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array`);
    existing = parsed.map(String);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...existing, ...failures], null, 2));
}

/**
 * withGlobalState for spec code: a revert that did not take is written to `file` (so teardown fails
 * the run with its dedicated section) AND thrown, so the test that caused it fails too.
 */
export async function withRecordedGlobalState<T>(
  spec: GlobalStateSpec,
  mutate: () => Promise<void>,
  body: () => Promise<T>,
  file: string,
): Promise<T> {
  const failures: string[] = [];
  let result: T;
  try {
    result = await withGlobalState(spec, mutate, body, failures);
  } finally {
    appendGlobalStateFailures(file, failures);
  }
  if (failures.length) throw new Error(`global state not restored:\n${failures.join("\n")}`);
  return result;
}

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
