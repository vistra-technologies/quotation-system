import fs from "node:fs";
import path from "node:path";

const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function walk(dir: string, pred: (name: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "generated") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(e.name)) out.push(p);
  }
  return out;
}
/** "app/a/(grp)/[x]/route.ts" -> "/a/[x]" — route groups don't appear in URLs. */
const urlOf = (appDir: string, file: string) =>
  "/" + path.relative(appDir, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)).join("/");

export function enumerateRoutes(appDir: string): string[] {
  const out: string[] = [];
  for (const f of walk(appDir, (n) => n === "route.ts")) {
    const src = fs.readFileSync(f, "utf-8");
    for (const v of VERBS) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${v}\\b|export\\s+const\\s+${v}\\b`).test(src)) out.push(`${v} ${urlOf(appDir, f)}`);
    }
  }
  return out;
}
export function enumeratePages(appDir: string): string[] {
  return walk(appDir, (n) => n === "page.tsx").map((f) => urlOf(appDir, f) || "/");
}
export function collectCovered(testsDir: string): { routes: Set<string>; pages: Set<string> } {
  const routes = new Set<string>(); const pages = new Set<string>();
  for (const f of walk(testsDir, (n) => n.endsWith(".spec.ts"))) {
    const src = fs.readFileSync(f, "utf-8");
    for (const m of src.matchAll(/\bcovers\(\s*["'`]([A-Z]+ [^"'`]+)["'`]\s*\)/g)) routes.add(m[1]);
    for (const m of src.matchAll(/\bcoversPage\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) pages.add(m[1]);
  }
  return { routes, pages };
}
export function checkCoverage(
  actual: { routes: string[]; pages: string[] },
  covered: { routes: Set<string>; pages: Set<string> },
): { untested: string[]; stale: string[] } {
  const untested = [
    ...actual.routes.filter((r) => !covered.routes.has(r)),
    ...actual.pages.filter((p) => !covered.pages.has(p)).map((p) => `page ${p}`),
  ];
  const known = new Set(actual.routes); const knownPages = new Set(actual.pages);
  const stale = [
    ...[...covered.routes].filter((r) => !known.has(r)),
    ...[...covered.pages].filter((p) => !knownPages.has(p)).map((p) => `page ${p}`),
  ];
  return { untested, stale };
}

// CLI: `npx tsx tests/regression/coverage-map.ts` (run from the repo root). Entry check via argv so it
// works whether tsx loads this file as CJS or ESM.
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("tests/regression/coverage-map.ts")) {
  const root = process.cwd();
  const appDir = path.join(root, "app");
  const res = checkCoverage(
    { routes: enumerateRoutes(appDir), pages: enumeratePages(appDir) },
    collectCovered(path.join(root, "tests", "regression")),
  );
  if (res.untested.length) console.error(`UNTESTED (${res.untested.length}):\n  ${res.untested.sort().join("\n  ")}`);
  if (res.stale.length) console.error(`STALE (route/page no longer exists) (${res.stale.length}):\n  ${res.stale.sort().join("\n  ")}`);
  if (!res.untested.length && !res.stale.length) console.log("coverage map: every route and page has a regression test");
  process.exit(res.untested.length || res.stale.length ? 1 : 0);
}
