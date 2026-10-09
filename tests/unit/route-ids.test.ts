import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { exportedNames, stripComments, urlOf } from "../regression/coverage-map";

/**
 * Stage 30 (S30-4 / S30-5), static checks. Every handler under app/api is `export const VERB =
 * withRoute("VERB /url", ...)` with the exact coverage-map id; /api/health is the one exception.
 * Every export of a "use server" actions file is `export const x = withAction("<file>#x", ...)`.
 */

const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "app");

function walk(dir: string, pred: (full: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "generated") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const routeFiles = walk(path.join(APP, "api"), (p) => path.basename(p) === "route.ts");

test("route files were found (guards against a path bug making the checks vacuous)", () => {
  assert.ok(routeFiles.length >= 60, `found ${routeFiles.length} route files`);
});

test("every exported verb is wrapped with withRoute and its exact coverage-map id (except /api/health)", () => {
  const problems: string[] = [];
  let wrapped = 0;
  for (const f of routeFiles) {
    const url = urlOf(APP, f);
    const raw = fs.readFileSync(f, "utf-8");
    const src = stripComments(raw);
    const verbs = VERBS.filter((v) => exportedNames(raw).has(v));
    if (url === "/api/health") {
      if (/withRoute/.test(src)) problems.push(`${url}: must stay unwrapped (S30-9)`);
      continue;
    }
    for (const v of verbs) {
      const re = new RegExp(`export\\s+const\\s+${v}\\s*=\\s*withRoute\\(\\s*"${esc(`${v} ${url}`)}"\\s*,`);
      if (re.test(src)) wrapped++;
      else problems.push(`${v} ${url} (${path.relative(ROOT, f)}) is not \`export const ${v} = withRoute("${v} ${url}", ...)\``);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(wrapped >= 100, `wrapped ${wrapped} handlers`);
});

test("no route handler under app/api (except health) is a bare `export async function`", () => {
  const bad = routeFiles
    .filter((f) => urlOf(APP, f) !== "/api/health")
    .filter((f) => /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(stripComments(fs.readFileSync(f, "utf-8"))))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, []);
});

test('every export of a "use server" file is withAction("<file>#<name>", ...)', () => {
  const files = walk(APP, (p) => /\.tsx?$/.test(p) && /^\s*["']use server["']/.test(fs.readFileSync(p, "utf-8")));
  assert.ok(files.length >= 12, `found ${files.length} use-server files`);
  const problems: string[] = [];
  let count = 0;
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf-8");
    const src = stripComments(raw);
    const fileId = path.relative(ROOT, f).split(path.sep).join("/").replace(/\.tsx?$/, "");
    // value exports only: `export type` / `export interface` are erased and legal in a "use server" file
    const names = [...src.matchAll(/\bexport\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    for (const n of names) {
      const re = new RegExp(`export\\s+const\\s+${n}\\s*=\\s*withAction\\(\\s*"${esc(`${fileId}#${n}`)}"\\s*,`);
      if (re.test(src)) count++;
      else problems.push(`${fileId}#${n} is not wrapped with its exact id`);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(count >= 38, `wrapped ${count} actions`);
});
