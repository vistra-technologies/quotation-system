import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

/**
 * The file global-teardown reads to fail the run on a revert that did not take. Format: JSONL — one
 * JSON string per line, appended atomically per failure so concurrent workers cannot clobber each other.
 */
export function globalStateFailuresFile(storageDir: string): string {
  return path.join(storageDir, "global-state-failures.json");
}

/** Append each failure as one JSONL line (a single appendFileSync per line). No-op for an empty list. */
export function appendGlobalStateFailures(file: string, failures: string[]): void {
  if (failures.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const f of failures) fs.appendFileSync(file, JSON.stringify(f) + "\n");
}

/** Read the failures file: JSONL (current) or a legacy whole-file JSON array. Missing file = []. */
export function readGlobalStateFailures(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf-8").trim();
  if (text === "") return [];
  if (text.startsWith("[")) return (JSON.parse(text) as unknown[]).map(String);
  return text.split("\n").filter((l) => l.trim() !== "").map((l) => String(JSON.parse(l)));
}

/**
 * Refuses to start when the CURRENT value already looks like a previous run's temporary value
 * (e.g. a stuck `rgr-…` rename) — "restoring" it would only re-assert the broken value.
 */
export function assertOriginalAllowed(key: string, original: unknown, forbid?: RegExp): void {
  if (forbid && typeof original === "string" && forbid.test(original)) {
    throw new Error(
      `global state "${key}" is already "${original}" (matches ${forbid}) — a previous run's temporary value was never reverted. ` +
        "Restore the real value by hand before running the suite.",
    );
  }
}

/**
 * Test-Org ComponentTypes whose `name` still carries a suite temporary label (`rgr-…`): a rename whose
 * revert never happened (e.g. the process was killed inside the window). The real label is not
 * derivable (names are free text, not a function of `code`), so global setup FAILS on these rather
 * than guessing a repair.
 */
export function stuckTemporaryTypeNames(types: Array<{ code: string; name: string }>): string[] {
  return types.filter((t) => /^rgr-/.test(t.name)).map((t) => `${t.code} (name "${t.name}")`);
}

/**
 * withGlobalState for spec code: a revert that did not take is written to `file` (so teardown fails
 * the run with its dedicated section) AND thrown, so the test that caused it fails too.
 * `opts.forbidOriginal`: refuse to start (nothing mutated) when the current value matches it.
 */
export async function withRecordedGlobalState<T>(
  spec: GlobalStateSpec,
  mutate: () => Promise<void>,
  body: () => Promise<T>,
  file: string,
  opts: { forbidOriginal?: RegExp } = {},
): Promise<T> {
  if (opts.forbidOriginal) assertOriginalAllowed(spec.key, await spec.read(), opts.forbidOriginal);
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
