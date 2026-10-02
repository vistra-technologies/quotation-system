import fs from "node:fs";
import path from "node:path";
import type { Reporter, FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { buildSummary, type Row } from "./summary";

const RUN_DIR = path.resolve(__dirname, "..", "..", "..", ".engineering", "regression");
const RUN_ID_ENV = "RGR_RUN_ID"; // set by global-setup in the main process (same process as this reporter)

function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

/** By-feature-area summary + the cleanup-status block for THIS run only (no newest-on-disk fallback). */
export default class RegressionReporter implements Reporter {
  private rows = new Map<string, Row>();
  onTestEnd(t: TestCase, r: TestResult) {
    this.rows.set(t.id, {
      id: t.id,
      area: path.basename(t.location.file).replace(/\.spec\.ts$/, ""),
      title: t.title,
      outcome: t.outcome(),
      error: r.errors[0]?.message?.split("\n")[0],
    });
  }
  onEnd(result: FullResult) {
    const runId = process.env[RUN_ID_ENV];
    const { text } = buildSummary({
      rows: [...this.rows.values()],
      runId,
      cleanup: runId ? readJson(path.join(RUN_DIR, runId, "cleanup.json")) : null,
      teardown: readJson(path.join(RUN_DIR, "last-teardown.json")),
      runStatus: result.status,
    });
    console.log(text);
  }
}
