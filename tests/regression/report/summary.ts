/** Pure verdict + formatting logic for the regression reporter (no Playwright, no fs — unit-testable). */

export type Outcome = "expected" | "unexpected" | "skipped" | "flaky";
export interface Row { id: string; area: string; title: string; outcome: Outcome; error?: string }

export interface SummaryInput {
  rows: Row[];
  /** The current run's id (from global-setup); undefined = setup never published one. */
  runId: string | undefined;
  /** Parsed <RUN_DIR>/<runId>/cleanup.json, or null/undefined when absent. */
  cleanup: unknown;
  /** Parsed last-teardown.json, or null/undefined when absent. */
  teardown: unknown;
  /** Playwright's FullResult.status. */
  runStatus: string;
}

const UNKNOWN = "UNKNOWN (cleanup.json malformed)";
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function buildSummary(inp: SummaryInput): { text: string; pass: boolean; problems: string[] } {
  const problems: string[] = [];

  // --- tests, by area ---
  const byId = new Map<string, Row>();
  for (const r of inp.rows) byId.set(r.id, r); // retries: the last result wins
  const rows = [...byId.values()];
  const areas = new Map<string, { pass: number; fail: number; skip: number; flaky: number }>();
  for (const r of rows) {
    const a = areas.get(r.area) ?? { pass: 0, fail: 0, skip: 0, flaky: 0 };
    if (r.outcome === "expected") a.pass++;
    else if (r.outcome === "skipped") a.skip++;
    else if (r.outcome === "flaky") a.flaky++;
    else a.fail++;
    areas.set(r.area, a);
  }
  const lines = ["", "-- Regression by area ---------------------------------"];
  for (const [k, v] of [...areas].sort()) {
    lines.push(`${v.fail ? "FAIL" : "ok  "} ${k.padEnd(34)} pass ${v.pass}  fail ${v.fail}  skip ${v.skip}${v.flaky ? `  flaky ${v.flaky}` : ""}`);
  }
  const failed = rows.filter((r) => r.outcome === "unexpected");
  if (failed.length) {
    lines.push("", "Failures:");
    for (const f of failed) lines.push(`  x [${f.area}] ${f.title}\n      ${f.error ?? "(unexpected result, e.g. a test.fail() that passed)"}`);
    problems.push(`${failed.length} test failure${failed.length === 1 ? "" : "s"}`);
  }
  const skipped = rows.filter((r) => r.outcome === "skipped");
  if (skipped.length) {
    lines.push("", `WARNING: ${skipped.length} test(s) skipped - the suite allows no silent skips; investigate.`);
    for (const s of skipped) lines.push(`  - [${s.area}] ${s.title}`);
    problems.push(`${skipped.length} skipped test(s)`);
  }
  const flaky = rows.filter((r) => r.outcome === "flaky");
  if (flaky.length) lines.push("", `Flaky (passed on retry): ${flaky.map((f) => `[${f.area}] ${f.title}`).join("; ")}`);
  if (inp.runStatus !== "passed" && !failed.length) problems.push(`Playwright run status "${inp.runStatus}"`);

  // --- cleanup ---
  lines.push("", `-- Cleanup status (run ${inp.runId ?? "UNKNOWN"}) ------------`);
  if (!inp.runId) {
    lines.push("run id unknown: global-setup did not publish one");
    problems.push("run id unknown (setup did not complete)");
  } else if (inp.cleanup == null) {
    lines.push(`cleanup.json for run ${inp.runId} is MISSING - teardown did not complete or was never reached`);
    problems.push("cleanup.json missing for this run");
  } else if (!isObj(inp.cleanup)) {
    lines.push(UNKNOWN);
    problems.push("cleanup.json malformed");
  } else {
    const c = inp.cleanup;
    let bad = false;
    const arrField = (name: string): unknown[] | null => (isArr(c[name]) ? (c[name] as unknown[]) : null);
    const show = (name: string, ok: string, fmt: (a: unknown[]) => string): string => {
      const a = arrField(name);
      if (!a) { bad = true; return UNKNOWN; }
      if (a.length) problems.push(`${name} non-empty (${a.length})`);
      return a.length ? fmt(a) : ok;
    };
    if (c.runId !== inp.runId) { bad = true; lines.push(`runId mismatch: cleanup.json says ${String(c.runId)}, this run is ${inp.runId}`); }
    const cf = typeof c.cleanupFailed === "boolean" ? (c.cleanupFailed ? "YES" : "no") : (bad = true, UNKNOWN);
    if (c.cleanupFailed === true) problems.push("cleanupFailed");
    const created = typeof c.created === "number" ? c.created : null;
    const deleted = arrField("deleted");
    if (created === null || !deleted) bad = true;
    const orgs = typeof c.orgsCompared === "number" ? c.orgsCompared : null;
    if (orgs === null) bad = true;
    lines.push(
      `cleanupFailed       : ${cf}`,
      `created / deleted   : ${created ?? UNKNOWN} / ${deleted ? deleted.length : UNKNOWN}`,
      `cleanup errors      : ${show("cleanupErrors", "none", (a) => a.map(String).join("; "))}`,
      `stray rgr- rows     : ${show("strays", "none", (a) => JSON.stringify(a))}`,
      `global reverts      : ${show("revertFailures", "all restored", (a) => a.map(String).join("; "))}`,
      `other-orgs diff     : ${show("delta", `clean (${orgs ?? UNKNOWN} orgs compared)`, (a) => "DELTA\n  " + a.map(String).join("\n  "))}`,
    );
    if (bad) problems.push("cleanup.json malformed or incomplete");
  }
  // last-teardown.json: must belong to this run and not report a failed cleanup
  if (inp.runId) {
    const t = inp.teardown;
    if (!isObj(t)) {
      lines.push("last-teardown.json  : MISSING or malformed");
      problems.push("last-teardown.json missing");
    } else if (t.runId !== inp.runId) {
      lines.push(`last-teardown.json  : belongs to run ${String(t.runId)}, not this run`);
      problems.push("last-teardown.json is for a different run");
    } else if (t.cleanupFailed !== false) {
      lines.push(`last-teardown.json  : cleanupFailed=${String(t.cleanupFailed)}${typeof t.reason === "string" ? ` (${t.reason})` : ""}`);
      problems.push("last-teardown.json reports cleanup failure");
    }
  }

  const pass = problems.length === 0;
  lines.push("", pass ? "REGRESSION PASS" : `REGRESSION FAIL (${problems.join("; ")})`);
  return { text: lines.join("\n"), pass, problems };
}
