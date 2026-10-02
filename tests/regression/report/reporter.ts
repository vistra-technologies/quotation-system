import fs from "node:fs";
import path from "node:path";
import type { Reporter, FullResult, TestCase, TestResult } from "@playwright/test/reporter";

const RUN_DIR = path.resolve(__dirname, "..", "..", "..", ".engineering", "regression");

type Cleanup = {
  runId?: string; cleanupFailed?: boolean; created?: number; deleted?: string[]; cleanupErrors?: string[];
  strays?: unknown[]; orgsCompared?: number; delta?: string[]; revertFailures?: string[];
};

/** Newest <RUN_DIR>/<runId>/cleanup.json (by mtime), or null — never throws. */
function readLatestCleanup(): Cleanup | null {
  try {
    if (!fs.existsSync(RUN_DIR)) return null;
    const files = fs.readdirSync(RUN_DIR)
      .map((d) => path.join(RUN_DIR, d, "cleanup.json"))
      .filter((f) => fs.existsSync(f))
      .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    const last = files.pop();
    return last ? (JSON.parse(fs.readFileSync(last.f, "utf-8")) as Cleanup) : null;
  } catch {
    return null;
  }
}
function readTeardownStatus(): { cleanupFailed?: boolean; reason?: string } | null {
  try { return JSON.parse(fs.readFileSync(path.join(RUN_DIR, "last-teardown.json"), "utf-8")); } catch { return null; }
}

/** By-feature-area summary + the cleanup-status block written by global-teardown. */
export default class RegressionReporter implements Reporter {
  private rows: { area: string; title: string; status: string; error?: string }[] = [];
  onTestEnd(t: TestCase, r: TestResult) {
    const area = path.basename(t.location.file).replace(/\.spec\.ts$/, "");
    const status = t.outcome() === "expected" && r.status === "failed" ? "passed" : r.status; // test.fail() that failed as declared
    this.rows.push({ area, title: t.title, status, error: r.errors[0]?.message?.split("\n")[0] });
  }
  onEnd(result: FullResult) {
    const areas = new Map<string, { pass: number; fail: number; skip: number }>();
    for (const r of this.rows) {
      const a = areas.get(r.area) ?? { pass: 0, fail: 0, skip: 0 };
      if (r.status === "passed") a.pass++; else if (r.status === "skipped") a.skip++; else a.fail++;
      areas.set(r.area, a);
    }
    const lines = ["", "-- Regression by area ---------------------------------"];
    for (const [k, v] of [...areas].sort()) lines.push(`${v.fail ? "FAIL" : "ok  "} ${k.padEnd(34)} pass ${v.pass}  fail ${v.fail}  skip ${v.skip}`);
    const failed = this.rows.filter((r) => r.status !== "passed" && r.status !== "skipped");
    if (failed.length) { lines.push("", "Failures:"); for (const f of failed) lines.push(`  x [${f.area}] ${f.title}\n      ${f.error ?? ""}`); }
    const skipped = this.rows.filter((r) => r.status === "skipped");
    if (skipped.length) lines.push("", `WARNING: ${skipped.length} test(s) skipped - the suite allows no silent skips; investigate.`);

    // globalTeardown has already run by onEnd (observed live), so this is this run's cleanup.json; falls back to the newest on disk
    const c = readLatestCleanup();
    lines.push("", "-- Cleanup status (latest teardown on disk) ------------");
    if (c) {
      const list = (a?: unknown[]) => (a && a.length ? JSON.stringify(a) : "none");
      lines.push(
        `run                 : ${c.runId ?? "?"}`,
        `cleanupFailed       : ${c.cleanupFailed ? "YES" : "no"}`,
        `created / deleted   : ${c.created ?? "?"} / ${c.deleted?.length ?? "?"}`,
        `cleanup errors      : ${c.cleanupErrors?.length ? c.cleanupErrors.join("; ") : "none"}`,
        `stray rgr- rows     : ${list(c.strays)}`,
        `global reverts      : ${c.revertFailures?.length ? c.revertFailures.join("; ") : "all restored"}`,
        `other-orgs diff     : ${c.delta?.length ? "DELTA\n  " + c.delta.join("\n  ") : `clean (${c.orgsCompared ?? "?"} orgs compared)`}`,
      );
    } else lines.push("(no cleanup.json found - teardown has not written one; see the teardown output)");
    const ts = readTeardownStatus();
    if (ts?.cleanupFailed) lines.push(`last-teardown.json  : cleanupFailed=true${ts.reason ? ` (${ts.reason})` : ""}`);
    lines.push("", failed.length || result.status !== "passed" ? `REGRESSION FAIL (${failed.length} test failure${failed.length === 1 ? "" : "s"})` : "REGRESSION PASS");
    console.log(lines.join("\n"));
  }
}
