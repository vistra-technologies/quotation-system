/** Pure assembly of ReportData from the run's persisted sources (no fs/process — unit-testable). */
import { verdictOf, type ReportData, type ReportTest, type Section } from "./report-data";
import type { Outcome } from "./summary";

export interface ResultRow extends ReportTest { id: string; area: string }
export interface ResultsFile { rows: ResultRow[]; startedAt: string; durationMs: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Playwright outcome -> report row. A flaky pass is a pass that is always listed. */
export function toRow(r: { id: string; area: string; title: string; outcome: Outcome; durationMs: number; error?: string; trace?: string; screenshot?: string }): ResultRow {
  const status = r.outcome === "unexpected" ? "failed" : r.outcome === "skipped" ? "skipped" : "passed";
  return { id: r.id, area: r.area, title: r.title, status, durationMs: r.durationMs, flaky: r.outcome === "flaky", error: r.error, trace: r.trace, screenshot: r.screenshot };
}

/** The `--last-failed` re-run only contains the first pass's failures: fold it back into the full picture. */
export function mergeResults(prev: ResultsFile, cur: ResultsFile): ResultsFile {
  const byId = new Map(prev.rows.map((r) => [r.id, r] as const));
  for (const r of cur.rows) {
    const before = byId.get(r.id);
    byId.set(r.id, before?.status === "failed" && r.status === "passed" ? { ...r, flaky: true } : r);
  }
  return { rows: [...byId.values()], startedAt: prev.startedAt, durationMs: prev.durationMs + cur.durationMs };
}

/** `ℹ tests N` (spec reporter) or `# tests N` (TAP) summary lines from `node --test`. null = unparseable. */
export function parseUnitCounts(text: string | null | undefined): { total: number; passed: number; failed: number } | null {
  if (!text) return null;
  const get = (k: string): number | null => {
    const m = text.match(new RegExp(String.raw`^\s*(?:ℹ|#)\s*${k}\s+(\d+)\s*$`, "m"));
    return m ? Number(m[1]) : null;
  };
  const total = get("tests"), passed = get("pass"), failed = get("fail");
  if (total === null || passed === null || failed === null) return null;
  return { total, passed, failed: failed + (get("cancelled") ?? 0) };
}

export interface AssembleInput {
  runId: string;
  results: ResultsFile | null;
  cleanup: unknown;
  teardown: unknown;
  unitText: string | null;
  coverage: ReportData["coverage"] | null;
  /** Full URL or host; only the host is ever kept. */
  target: string | undefined;
  commit: string | null;
  testOrg: string;
}

function hostOf(t: string | undefined): string {
  if (!t) return "unknown";
  try { return new URL(t).host; } catch { return "unknown"; }
}

export function assembleReportData(i: AssembleInput): ReportData {
  const notProduced: Section[] = [];

  const rows = i.results?.rows ?? [];
  if (!i.results) notProduced.push("results");
  const areaMap = new Map<string, ReportTest[]>();
  for (const row of rows) {
    const { area } = row;
    const t: ReportTest = { title: row.title, status: row.status, durationMs: row.durationMs, flaky: row.flaky, error: row.error, trace: row.trace, screenshot: row.screenshot };
    if (!areaMap.has(area)) areaMap.set(area, []);
    areaMap.get(area)!.push(t);
  }
  const areas = [...areaMap].sort(([a], [b]) => a.localeCompare(b)).map(([name, tests]) => ({ name, tests }));

  const unit = parseUnitCounts(i.unitText);
  if (!unit) notProduced.push("unit");
  if (!i.coverage) notProduced.push("coverage");

  // cleanup.json must be well-formed AND belong to this run; teardown's own status must agree.
  const c = i.cleanup;
  const cleanupOk =
    isObj(c) && c.runId === i.runId && typeof c.created === "number" && typeof c.orgsCompared === "number" &&
    isStrArr(c.deleted) && isStrArr(c.cleanupErrors) && isStrArr(c.revertFailures) && isStrArr(c.delta) &&
    Array.isArray(c.strays) && typeof c.cleanupFailed === "boolean";
  if (!cleanupOk) notProduced.push("cleanup");
  const t = i.teardown;
  const teardownOk = isObj(t) && t.runId === i.runId && t.cleanupFailed === false;
  const cj = cleanupOk ? (c as Record<string, unknown>) : null;

  const base: Omit<ReportData, "verdict"> = {
    runId: i.runId,
    startedAt: i.results?.startedAt ?? "unknown",
    durationMs: i.results?.durationMs ?? 0,
    target: hostOf(i.target),
    commit: i.commit,
    testOrg: i.testOrg,
    orgB: `rgr-${i.runId}-b`,
    unit: unit ?? { total: 0, passed: 0, failed: 0 },
    coverage: i.coverage ?? { routes: { total: 0, covered: 0 }, pages: { total: 0, covered: 0 }, untested: [], stale: [] },
    areas,
    cleanup: {
      created: cj ? (cj.created as number) : 0,
      deleted: cj ? (cj.deleted as string[]) : [],
      cleanupErrors: cj ? (cj.cleanupErrors as string[]) : [],
      strays: cj ? (cj.strays as unknown[]) : [],
      revertFailures: cj ? (cj.revertFailures as string[]) : [],
      delta: cj ? (cj.delta as string[]) : [],
      revertsOk: cj && isStrArr(cj.revertsOk) ? cj.revertsOk : [],
      orgsCompared: cj ? (cj.orgsCompared as number) : 0,
      cleanupFailed: !cleanupOk ? undefined : cj!.cleanupFailed === true || !teardownOk,
    },
    notProduced: notProduced.length ? notProduced : undefined,
  };
  // cleanup.json fine but last-teardown.json missing/foreign/failed -> cleanupFailed already true above.
  return { ...base, verdict: verdictOf(base) };
}
