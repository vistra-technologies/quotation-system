import fs from "node:fs";
import path from "node:path";
import type { Reporter, FullResult, Suite, TestCase, TestResult } from "@playwright/test/reporter";
import { buildSummary, type Row } from "./summary";
import { redact, secretsFromEnv } from "./redact";
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
    // Area = the owning SPEC file, not t.location (tests registered by a shared helper such as
    // api/api-matrix.ts would otherwise all land in the helper's area). Title keeps describe titles
    // (e.g. the route key a matrix case belongs to).
    let file: Suite | undefined = t.parent;
    while (file && file.type !== "file") file = file.parent;
    const area = path.basename(file?.location?.file ?? t.location.file).replace(/\.spec\.ts$/, "");
    const describes: string[] = [];
    for (let s: Suite | undefined = t.parent; s && s.type === "describe"; s = s.parent) describes.unshift(s.title);
    const title = [...describes, t.title].join(" › ");
    // I4: `precondition` annotations = behaviour this target could not exercise (runtime ones live on the result)
    const notExercised = [...new Set([...t.annotations, ...(r.annotations ?? [])].filter((a) => a.type === "precondition").map((a) => a.description ?? "(no description)"))];
    this.rows.set(t.id, {
      id: t.id,
      area,
      title,
      outcome: t.outcome(),
      error: redact(stripAnsi(r.errors[0]?.message ?? "").split("\n")[0], secretsFromEnv()) || undefined,
      ...(notExercised.length ? { notExercised } : {}),
    });
    const runId = process.env[RUN_ID_ENV];
    const runDir = path.join(RUN_DIR, runId ?? "unknown");
    const att = (name: string) => r.attachments.find((a) => a.name === name && a.path)?.path;
    this.detail.set(
      t.id,
      toRow({
        id: t.id, area, title: redact(title, secretsFromEnv()), outcome: t.outcome(), durationMs: r.duration,
        error: r.errors.length ? redact(stripAnsi(r.errors.map((e) => e.message ?? e.value ?? "").join("\n\n")), secretsFromEnv()).slice(0, 4000) : undefined,
        trace: rel(runDir, att("trace")),
        screenshot: rel(runDir, att("screenshot")),
        notExercised,
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
      else if (from) res = { ...res, mergeFailed: true }; // first pass's results unreadable: reported as not produced
      fs.mkdirSync(path.join(RUN_DIR, runId), { recursive: true });
      fs.writeFileSync(path.join(RUN_DIR, runId, "results.json"), JSON.stringify(res, null, 2));
      fs.writeFileSync(LATEST_RUN_FILE, JSON.stringify({ runId }));
    } catch (e) {
      console.log(`[regression] could not write results.json: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
