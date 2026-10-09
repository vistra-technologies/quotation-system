// Affected-spec runner: given a git diff base, maps changed app/api route.ts and
// app page.tsx files to their regression spec files via the coverage map, then runs
// (or lists) only those specs via the standard playwright.regression.config.ts.
//
// Usage (via npm run test:regression:affected):
//   npm run test:regression:affected                    # diff origin/master...HEAD
//   npm run test:regression:affected -- main            # diff main...HEAD
//   npm run test:regression:affected -- --list          # print matched specs, do not run
//   npm run test:regression:affected -- --include-ui    # also include pages/ and journeys/ specs
//
// By default, pages/ and journeys/ specs are excluded (they are UI tests that require
// test.easeetool.com; use --include-ui to include them when running against the stable URL).
//
// When a changed lib/data/* or lib/session.ts file has no direct map entry, a warning
// is printed recommending the full run instead of guessing silently.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments, urlOf } from "./coverage-map";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const APP_DIR = path.join(ROOT, "app");
const TESTS_DIR = path.join(ROOT, "tests", "regression");

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const includeUi = args.includes("--include-ui");
// The first non-flag arg (if any) is the diff base.
const base = args.find((a) => !a.startsWith("--")) ?? "origin/master";

// ---------------------------------------------------------------------------
// Build reverse map: URL -> spec files that cover it
// Route keys: "GET /api/v1/orgs/[orgSlug]/projects" etc.
// Page keys:  "page:/[orgSlug]/projects"
// ---------------------------------------------------------------------------
function walk(dir: string, pred: (n: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "generated") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(e.name)) out.push(p);
  }
  return out;
}

// Map: coverage key -> Set<specFile>
const coverageIndex = new Map<string, Set<string>>();

function addToIndex(key: string, specFile: string) {
  let s = coverageIndex.get(key);
  if (!s) coverageIndex.set(key, (s = new Set()));
  s.add(specFile);
}

for (const specFile of walk(TESTS_DIR, (n) => n.endsWith(".spec.ts"))) {
  const src = stripComments(fs.readFileSync(specFile, "utf-8"));
  for (const m of src.matchAll(/\bcovers\(\s*["'`]([A-Z]+ [^"'`]+)["'`]\s*\)/g)) {
    // key is "VERB /url", but we store just the URL part so one route file maps all verbs
    const [verb, ...urlParts] = m[1].trim().split(" ");
    const url = urlParts.join(" ");
    addToIndex(`route:${url}`, specFile);
    addToIndex(`route-verb:${verb} ${url}`, specFile);
  }
  for (const m of src.matchAll(/\bcoversPage\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    addToIndex(`page:${m[1].trim()}`, specFile);
  }
}

// ---------------------------------------------------------------------------
// Get changed files from git
// ---------------------------------------------------------------------------
const diffResult = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  cwd: ROOT,
  encoding: "utf-8",
  shell: false,
});
if (diffResult.status !== 0) {
  const err = (diffResult.stderr ?? "").trim();
  console.error(`\naffected-runner: git diff failed (base="${base}"):`);
  if (err) console.error(err);
  console.error(`  Did you mean a different base? (e.g. npm run test:regression:affected -- origin/staging)`);
  process.exit(1);
}

const changedFiles: string[] = (diffResult.stdout ?? "")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

if (changedFiles.length === 0) {
  console.log(`\naffected-runner: no changed files between ${base} and HEAD — nothing to run.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Map changed files to spec files
// ---------------------------------------------------------------------------
const ROUTE_FILE = /[/\\]route\.(ts|tsx|js|jsx)$/;
const PAGE_FILE = /[/\\]page\.(tsx|ts|jsx|js)$/;
const SPEC_FILE = /tests[/\\]regression[/\\].*\.spec\.ts$/;
// Lib files that have no direct coverage-map entry but affect many routes
const LIB_PATTERN = /^lib[/\\]/;
const KNOWN_BROAD_LIBS = [/^lib[/\\]data[/\\]/, /^lib[/\\]session\.ts$/, /^lib[/\\]api-auth\.ts$/];

const selectedSpecs = new Set<string>();
const warnings: string[] = [];

for (const rel of changedFiles) {
  const abs = path.join(ROOT, rel.replace(/\//g, path.sep));

  if (SPEC_FILE.test(rel)) {
    // A changed spec is always included (it is its own test)
    if (fs.existsSync(abs)) selectedSpecs.add(abs);
    continue;
  }

  if (ROUTE_FILE.test(rel) && rel.startsWith("app/")) {
    // app/api/v1/.../route.ts -> URL -> spec files
    const url = urlOf(APP_DIR, abs);
    const key = `route:${url}`;
    const specs = coverageIndex.get(key);
    if (specs) {
      for (const s of specs) selectedSpecs.add(s);
    } else {
      warnings.push(`  ${rel} -> URL "${url}" has no covers() entry — no spec mapped.`);
    }
    continue;
  }

  if (PAGE_FILE.test(rel) && rel.startsWith("app/")) {
    const url = urlOf(APP_DIR, abs);
    const key = `page:${url === "/" ? "/" : url}`;
    const specs = coverageIndex.get(key);
    if (specs) {
      for (const s of specs) selectedSpecs.add(s);
    } else {
      warnings.push(`  ${rel} -> page "${url}" has no coversPage() entry — no spec mapped.`);
    }
    continue;
  }

  if (LIB_PATTERN.test(rel) && KNOWN_BROAD_LIBS.some((p) => p.test(rel))) {
    warnings.push(`  ${rel} is a shared lib with no direct coverage map entry.`);
  }
  // Non-app/non-spec files are silently skipped (prisma schema, scripts, config, etc.)
}

// ---------------------------------------------------------------------------
// Apply UI exclusion
// ---------------------------------------------------------------------------
const PAGES_DIR = path.join(TESTS_DIR, "pages");
const JOURNEYS_DIR = path.join(TESTS_DIR, "journeys");

const filteredSpecs = [...selectedSpecs].filter((s) => {
  if (!includeUi && (s.startsWith(PAGES_DIR) || s.startsWith(JOURNEYS_DIR))) return false;
  return true;
});

const uiExcluded = selectedSpecs.size - filteredSpecs.length;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log(`\naffected-runner: base=${base}, changed files=${changedFiles.length}`);
if (warnings.length) {
  console.warn(`\nWARNINGS — files with no direct spec mapping:`);
  for (const w of warnings) console.warn(w);
  console.warn(`  Recommendation: run the full suite (npm run test:regression) to ensure coverage.`);
}

if (filteredSpecs.length === 0 && uiExcluded > 0) {
  console.log(`\nNo non-UI specs matched (${uiExcluded} UI spec(s) excluded). Use --include-ui to include them.`);
  process.exit(0);
}

if (filteredSpecs.length === 0) {
  console.log(`\nNo affected specs found for the changed files above. Run the full suite if in doubt.`);
  process.exit(0);
}

// Make paths relative to ROOT for readability
const relSpecs = filteredSpecs.map((s) => path.relative(ROOT, s).replace(/\\/g, "/"));

if (uiExcluded > 0) {
  console.log(`\n(${uiExcluded} UI spec(s) excluded; use --include-ui to add them)`);
}
console.log(`\nAffected specs (${relSpecs.length}):`);
for (const s of relSpecs.sort()) console.log(`  ${s}`);

if (listOnly) {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Run playwright with the selected spec files
// ---------------------------------------------------------------------------
console.log(`\nRunning affected specs against PLAYWRIGHT_BASE_URL=${process.env.PLAYWRIGHT_BASE_URL ?? "(unset)"}\n`);

const pw = spawnSync(
  "npx",
  ["playwright", "test", "-c", "playwright.regression.config.ts", ...filteredSpecs],
  { stdio: "inherit", shell: true, cwd: ROOT },
);
process.exit(pw.status ?? 1);
