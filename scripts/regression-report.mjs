// Assembles the self-contained HTML report for the run that just finished. Run via tsx (it imports .ts):
//   npm run test:regression:report [-- --open]
// Always produces a report: a missing source is marked "not produced — see console" and forces FAIL.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleReportData, reportExitCode } from "../tests/regression/report/assemble.ts";
import { secretsFromEnv } from "../tests/regression/report/redact.ts";
import { renderReport } from "../tests/regression/report/render-html.ts";
import { enumerateRoutes, enumeratePages, collectCovered, checkCoverage } from "../tests/regression/coverage-map.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = path.join(ROOT, ".engineering", "regression");
const readJson = (f) => {
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return null; }
};
const readText = (f) => {
  try { return fs.readFileSync(f, "utf-8"); } catch { return null; }
};

function coverage() {
  try {
    const appDir = path.join(ROOT, "app");
    const routes = enumerateRoutes(appDir);
    if (routes.length === 0) return null; // vacuous -> not produced
    const pages = enumeratePages(appDir);
    const { untested, stale, untestedRoutes, untestedPages } = checkCoverage({ routes, pages }, collectCovered(path.join(ROOT, "tests", "regression")));
    return {
      routes: { total: routes.length, covered: routes.length - untestedRoutes },
      pages: { total: pages.length, covered: pages.length - untestedPages },
      untested: untested.sort(),
      stale: stale.sort(),
    };
  } catch (e) {
    console.error(`coverage for the report failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

const runId = readJson(path.join(BASE, "latest-run.json"))?.runId;
const runDir = runId ? path.join(BASE, runId) : null;
const commit = (() => {
  try {
    const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
    return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  } catch {
    return null;
  }
})();

const data = assembleReportData({
  runId: typeof runId === "string" && runId ? runId : "unknown",
  results: runDir ? readJson(path.join(runDir, "results.json")) : null,
  cleanup: runDir ? readJson(path.join(runDir, "cleanup.json")) : null,
  teardown: readJson(path.join(BASE, "last-teardown.json")),
  unitText: readText(path.join(BASE, "unit.txt")),
  coverage: coverage(),
  target: process.env.PLAYWRIGHT_BASE_URL,
  commit,
  testOrg: "e2e-testorg",
  secrets: secretsFromEnv(),
});

const html = renderReport(data);
// The exit code agrees with the verdict: 0 only on PASS (orchestrator counts a non-zero exit as a failed stage).
process.exitCode = reportExitCode(data);
const outDir = runDir ?? path.join(BASE, "unknown");
const latestDir = path.join(BASE, "latest");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(latestDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(data, null, 2));
fs.writeFileSync(path.join(outDir, "report.html"), html);
// Same depth as <runId>/, so the report's relative trace/screenshot links (../../test-results/...) still resolve.
fs.writeFileSync(path.join(latestDir, "report.html"), html);
const latest = path.join(latestDir, "report.html");
console.log(`\nReport: ${latest}  (${data.verdict}${data.notProduced?.length ? `; not produced: ${data.notProduced.join(", ")}` : ""})`);
if (process.argv.includes("--open")) {
  if (process.platform === "win32") spawn("cmd", ["/c", "start", '""', latest], { stdio: "ignore", detached: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [latest], { stdio: "ignore", detached: true }).unref();
}
