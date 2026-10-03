import { SaClient, createAllowance } from "./clients";
import { appendGlobalStateFailures, globalStateFailuresFile } from "./global-state";
import { readRunState } from "./run-state";

/**
 * Safety net for a Test-Org ComponentType rename whose withRecordedGlobalState revert never ran (the test
 * TIMED OUT inside the window: Playwright abandons the body, so its `finally` may not execute).
 *
 * A spec records the pending rename before the window (`pending.set`) and clears it after the wrapper
 * returned (`pending.clear`). Its `test.afterAll` calls `restorePendingRenames()`, which — with a FRESH
 * SuperAdmin session (the test's own request contexts are gone) — re-reads each recorded type and PATCHes
 * the original name back ONLY if the current name is still the recorded temporary one (current == original
 * → nothing to do; anything else → someone else changed it: NOT overwritten, reported). Anything it cannot
 * restore is appended to
 * global-state-failures.json (teardown fails the run). Global teardown independently reports any Test-Org
 * type still carrying an `rgr-` name as a revert failure.
 */
export interface PendingRename {
  key: string;
  typeId: string;
  original: string;
  /** The temporary name the window writes (exactly as recorded). */
  temp: string;
}

export type RestoreDecision = "done" | "restore" | "conflict";

/** Pure: what the safety net does for a type whose current name is `current`. */
export function restoreDecision(current: string, p: Pick<PendingRename, "original" | "temp">): RestoreDecision {
  if (current === p.original) return "done";
  if (current === p.temp) return "restore";
  return "conflict";
}

const pendingRenames = new Map<string, PendingRename>();

export const pending = {
  set(p: PendingRename): void {
    pendingRenames.set(p.typeId, p);
  },
  clear(typeId: string): void {
    pendingRenames.delete(typeId);
  },
  size(): number {
    return pendingRenames.size;
  },
};

export async function restorePendingRenames(): Promise<void> {
  if (pendingRenames.size === 0) return;
  const run = readRunState();
  const file = globalStateFailuresFile(run.storageDir);
  const failures: string[] = [];
  let sa: SaClient | null = null;
  try {
    sa = await SaClient.login(
      process.env.PLAYWRIGHT_BASE_URL ?? "",
      process.env.TEST_SA_USERNAME ?? "",
      process.env.TEST_SA_PASSWORD ?? "",
      createAllowance([], [run.testOrg.id]),
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    );
    for (const p of [...pendingRenames.values()]) {
      const path = `/api/v1/superadmin/component-types/${p.typeId}`;
      try {
        const read = async () => {
          const r = await sa!.get(`${path}?orgId=${run.testOrg.id}`);
          if (r.status() !== 200) throw new Error(`SA GET → HTTP ${r.status()}`);
          return ((await r.json()) as { componentType: { name: string } }).componentType.name;
        };
        const current = await read();
        const decision = restoreDecision(current, p);
        if (decision === "conflict") {
          throw new Error(`current name ${JSON.stringify(current)} is neither the original ${JSON.stringify(p.original)} nor the temporary ${JSON.stringify(p.temp)} — NOT overwritten; check it by hand`);
        }
        if (decision === "restore") {
          const w = await sa.patch(path, { data: { orgId: run.testOrg.id, name: p.original } });
          if (w.status() !== 200) throw new Error(`SA PATCH → HTTP ${w.status()} ${await w.text()}`);
          const after = await read();
          if (after !== p.original) throw new Error(`still "${after}"`);
          console.warn(`[regression] afterAll restored ${p.key} to ${JSON.stringify(p.original)} (the test's own revert did not run)`);
        }
        pendingRenames.delete(p.typeId);
      } catch (err) {
        failures.push(`global state "${p.key}" afterAll restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    failures.push(`afterAll restore of ${pendingRenames.size} pending rename(s) could not start: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await sa?.dispose();
    appendGlobalStateFailures(file, failures);
  }
}
