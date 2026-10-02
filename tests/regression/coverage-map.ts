import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const ROUTE_FILE = /^route\.(ts|tsx|js|jsx)$/;
const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;

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

/** Remove line and block comments, leaving string/template literals intact. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") out += src[i++];
        out += src[i++] ?? "";
      }
      out += src[i++] ?? "";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** "app/a/(grp)/[x]/route.ts" -> "/a/[x]" — route groups don't appear in URLs. */
const urlOf = (appDir: string, file: string) =>
  "/" + path.relative(appDir, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s)).join("/");

/** Every name a module exports (comments stripped): declarations, destructuring, and export lists. */
export function exportedNames(rawSrc: string): Set<string> {
  const src = stripComments(rawSrc);
  const names = new Set<string>();
  for (const m of src.matchAll(/\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const p = part.trim().replace(/\s*=.*$/, "");
      const name = p.includes(":") ? p.split(":")[1].trim() : p;
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  return names;
}

export function enumerateRoutes(appDir: string): string[] {
  const out: string[] = [];
  for (const f of walk(appDir, (n) => ROUTE_FILE.test(n))) {
    const names = exportedNames(fs.readFileSync(f, "utf-8"));
    for (const v of VERBS) if (names.has(v)) out.push(`${v} ${urlOf(appDir, f)}`);
  }
  return out;
}
export function enumeratePages(appDir: string): string[] {
  return walk(appDir, (n) => PAGE_FILE.test(n)).map((f) => urlOf(appDir, f) || "/");
}
export function collectCovered(testsDir: string): { routes: Set<string>; pages: Set<string> } {
  const routes = new Set<string>();
  const pages = new Set<string>();
  for (const f of walk(testsDir, (n) => n.endsWith(".spec.ts"))) {
    const src = stripComments(fs.readFileSync(f, "utf-8"));
    for (const m of src.matchAll(/\bcovers\(\s*["'`]([A-Z]+ [^"'`]+)["'`]\s*\)/g)) routes.add(m[1]);
    for (const m of src.matchAll(/\bcoversPage\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) pages.add(m[1]);
  }
  return { routes, pages };
}
export function checkCoverage(
  actual: { routes: string[]; pages: string[] },
  covered: { routes: Set<string>; pages: Set<string> },
): { untested: string[]; stale: string[]; untestedRoutes: number; untestedPages: number } {
  const untestedRoutes = actual.routes.filter((r) => !covered.routes.has(r));
  const untestedPages = actual.pages.filter((p) => !covered.pages.has(p));
  const untested = [...untestedRoutes, ...untestedPages.map((p) => `page ${p}`)];
  const known = new Set(actual.routes);
  const knownPages = new Set(actual.pages);
  const stale = [
    ...[...covered.routes].filter((r) => !known.has(r)),
    ...[...covered.pages].filter((p) => !knownPages.has(p)).map((p) => `page ${p}`),
  ];
  return { untested, stale, untestedRoutes: untestedRoutes.length, untestedPages: untestedPages.length };
}

/** CLI body: returns the exit code (2 = misconfigured/vacuous, 1 = gaps, 0 = complete). */
export function runCli(root: string, log: (m: string) => void = console.log, err: (m: string) => void = console.error): number {
  const appDir = path.join(root, "app");
  const testsDir = path.join(root, "tests", "regression");
  if (!fs.existsSync(appDir) || !fs.existsSync(testsDir)) {
    err(`coverage map: cannot find ${!fs.existsSync(appDir) ? appDir : testsDir} - refusing to report a vacuous pass`);
    return 2;
  }
  const routes = enumerateRoutes(appDir);
  if (routes.length === 0) {
    err(`coverage map: zero routes enumerated under ${appDir} - refusing to report a vacuous pass`);
    return 2;
  }
  const res = checkCoverage({ routes, pages: enumeratePages(appDir) }, collectCovered(testsDir));
  if (res.untested.length) err(`UNTESTED (${res.untested.length}):\n  ${res.untested.sort().join("\n  ")}`);
  if (res.stale.length) err(`STALE (route/page no longer exists) (${res.stale.length}):\n  ${res.stale.sort().join("\n  ")}`);
  if (!res.untested.length && !res.stale.length) log("coverage map: every route and page has a regression test");
  return res.untested.length || res.stale.length ? 1 : 0;
}

// CLI: `npx tsx tests/regression/coverage-map.ts`. The repo root comes from this file's location, never cwd.
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (entry.endsWith("tests/regression/coverage-map.ts")) {
  const here = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  process.exit(runCli(path.resolve(here, "..", "..")));
}
