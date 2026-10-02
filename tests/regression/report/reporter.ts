import fs from "node:fs";
import path from "node:path";
import type { Reporter, FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { buildSummary, type Row } from "./summary";
import { toRow, mergeResults, type ResultRow, type ResultsFile } from "./assemble";

const RUN_DIR = path.resolve(__dirname, "..", "..", "..", ".engineering", "regression");
const RUN_ID_ENV = "RGR_RUN_ID"; // set by global-setup in the main process (same process as this reporter)
/** Set by the orchestrator on the --last-failed re-run: the first pass's run id, whose results this run completes. */
const MERGE_FROM_ENV = "RGR_MERGE_FROM";
export const LATEST_RUN_FILE = path.join(RUN_DIR, "latest-run.json");

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const rel = (runDir: string, abs: string | undefined) => (abs ? path.relative(runDir, abs).split(path.sep).join("/") : undefined);

/** By-feature-area summary + the cleanup-status block for THIS run only (no newest-on-disk fallback). */
export default class RegressionReporter implements Reporter {
  private rows = new Map<string, Row>();
  private detail = new Map<string, ResultRow>();
  private startedAt = new Date();
  onTestEnd(t: TestCase, r: TestResult) {
    const area = path.basename(t.location.file).replace(/\.spec\.ts$/, "");
    this.rows.set(t.id, {
      id: t.id,
      area,
      title: t.title,
      outcome: t.outcome(),
      error: r.errors[0]?.message?.split("\n")[0],
    });
    const runId = process.env[RUN_ID_ENV];
    const runDir = path.join(RUN_DIR, runId ?? "unknown");
    const att = (name: string) => r.attachments.find((a) => a.name === name && a.path)?.path;
    this.detail.set(
      t.id,
      toRow({
        id: t.id, area, title: t.title, outcome: t.outcome(), durationMs: r.duration,
        error: r.errors.length ? stripAnsi(r.errors.map((e) => e.message ?? e.value ?? "").join("\n\n")).slice(0, 4000) : undefined,
        trace: rel(runDir, att("trace")),
        screenshot: rel(runDir, att("screenshot")),
      }),
    );
  }
  onEnd(result: FullResult) {
    const runId = process.env[RUN_ID_ENV];
    if (runId) this.writeResults(runId);
    const { text } = buildSummary({
      rows: [...this.rows.values()],
      runId,
      cleanup: runId ? readJson(path.join(RUN_DIR, runId, "cleanup.json")) : null,
      teardown: readJson(path.join(RUN_DIR, "last-teardown.json")),
      runStatus: result.status,
    });
    console.log(text);
  }
  private writeResults(runId: string) {
    try {
      let res: ResultsFile = { rows: [...this.detail.values()], startedAt: this.startedAt.toISOString(), durationMs: Date.now() - this.startedAt.getTime() };
      const from = process.env[MERGE_FROM_ENV];
      const prev = from ? (readJson(path.join(RUN_DIR, from, "results.json")) as ResultsFile | null) : null;
      if (prev && Array.isArray(prev.rows)) res = mergeResults(prev, res);
      fs.mkdirSync(path.join(RUN_DIR, runId), { recursive: true });
      fs.writeFileSync(path.join(RUN_DIR, runId, "results.json"), JSON.stringify(res, null, 2));
      fs.writeFileSync(LATEST_RUN_FILE, JSON.stringify({ runId }));
    } catch (e) {
      console.log(`[regression] could not write results.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
