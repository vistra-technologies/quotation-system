// Regression orchestrator: coverage map → unit tests → playwright (re-run failures once) → exit code.
import { spawnSync } from "node:child_process";

const run = (label, cmd, args, env = process.env) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, env });
  return r.status ?? 1;
};

let failed = 0;
failed += run("coverage map", "npx", ["tsx", "tests/regression/coverage-map.ts"]) ? 1 : 0;
failed += run("unit tests", "npm", ["run", "test:unit"]) ? 1 : 0;
let pw = run("regression (parallel)", "npx", ["playwright", "test", "-c", "playwright.regression.config.ts"]);
if (pw) {
  console.log("\n=== re-running failures once at --workers=1 (sign-in rate limit is a known flake source) ===");
  pw = run("regression (failed only)", "npx", ["playwright", "test", "-c", "playwright.regression.config.ts", "--last-failed", "--workers=1"]);
}
failed += pw ? 1 : 0;
console.log(failed ? `\nREGRESSION FAIL (${failed} stage${failed > 1 ? "s" : ""} failed)` : "\nREGRESSION PASS");
process.exit(failed ? 1 : 0);
