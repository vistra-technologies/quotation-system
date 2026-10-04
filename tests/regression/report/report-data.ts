/** Types + the pure verdict for the self-contained HTML report (no fs, no Playwright — unit-testable). */

export type TestStatus = "passed" | "failed" | "skipped";
export interface ReportTest {
  title: string;
  status: TestStatus;
  durationMs: number;
  flaky: boolean;
  error?: string;
  /** Path relative to the report file (into Playwright's test-results/); never absolute, never a URL. */
  trace?: string;
  screenshot?: string;
  /** `precondition` annotations: what this test could NOT exercise on this target (final review I4). */
  notExercised?: string[];
}
export type Section = "results" | "cleanup" | "unit" | "coverage";

export interface ReportData {
  verdict: "PASS" | "FAIL";
  runId: string;
  startedAt: string;
  durationMs: number;
  /** Host only — never a full URL. */
  target: string;
  commit: string | null;
  testOrg: string;
  orgB: string;
  unit: { total: number; passed: number; failed: number };
  coverage: { routes: { total: number; covered: number }; pages: { total: number; covered: number }; untested: string[]; stale: string[] };
  areas: Array<{ name: string; tests: ReportTest[] }>;
  cleanup: {
    created: number;
    deleted: string[];
    cleanupErrors: string[];
    strays: unknown[];
    revertFailures: string[];
    delta: string[];
    revertsOk: string[];
    orgsCompared: number;
    /** teardown's own verdict (cleanup.json / last-teardown.json); optional so a bare fixture stays valid. */
    cleanupFailed?: boolean;
  };
  /** Behaviour NOT exercised on this target (`precondition` annotations), with how many tests reported each. Informational. */
  notExercised?: Array<{ description: string; tests: number }>;
  /** Sources a crashed stage never produced; each renders "not produced — see console" and forces FAIL. */
  notProduced?: Section[];
}

/** Every reason the run fails, in plain words (also the verdict banner's subtitle). Empty = PASS. */
export function problemsOf(d: Omit<ReportData, "verdict">): string[] {
  const tests = d.areas.flatMap((a) => a.tests);
  const failed = tests.filter((t) => t.status === "failed").length;
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const c = d.cleanup;
  const out: string[] = [];
  for (const s of d.notProduced ?? []) out.push(`${s} not produced`);
  if (!(d.notProduced ?? []).includes("results") && tests.length === 0) out.push("no tests ran");
  if (failed) out.push(`${failed} test${failed === 1 ? "" : "s"} failed`);
  if (skipped) out.push(`${skipped} skipped (no silent skips)`);
  if (d.unit.failed > 0) out.push(`${d.unit.failed} unit test failure${d.unit.failed === 1 ? "" : "s"}`);
  if (d.coverage.untested.length) out.push(`${d.coverage.untested.length} untested route/page${d.coverage.untested.length === 1 ? "" : "s"}`);
  if (d.coverage.stale.length) out.push(`${d.coverage.stale.length} stale coverage registration${d.coverage.stale.length === 1 ? "" : "s"}`);
  if (c.cleanupErrors.length) out.push(`${c.cleanupErrors.length} cleanup error(s)`);
  if (c.strays.length) out.push(`${c.strays.length} stray row(s)`);
  if (c.revertFailures.length) out.push(`${c.revertFailures.length} global-state revert failure(s)`);
  if (c.delta.length) out.push(`other-org delta (${c.delta.length})`);
  if (c.cleanupFailed === true) out.push("cleanup failed");
  return out;
}

export function verdictOf(d: Omit<ReportData, "verdict">): "PASS" | "FAIL" {
  return problemsOf(d).length === 0 ? "PASS" : "FAIL";
}
