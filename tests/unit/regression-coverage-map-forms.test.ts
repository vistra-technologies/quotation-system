import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enumerateRoutes, enumeratePages, collectCovered, runCli } from "../regression/coverage-map";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
function put(root: string, rel: string, content: string) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}
function routesOf(files: Record<string, string>): string[] {
  const root = tmp();
  for (const [p, c] of Object.entries(files)) put(root, path.join("app", p), c);
  return enumerateRoutes(path.join(root, "app")).sort();
}

test("verb detection: destructured export const { GET, POST } = ...", () => {
  assert.deepEqual(routesOf({ "a/route.ts": "export const { GET, POST } = toNextJsHandler(auth);" }), ["GET /a", "POST /a"]);
});
test("verb detection: aliased and re-exported lists", () => {
  assert.deepEqual(routesOf({ "a/route.ts": "const handler = 1; export { handler as POST };" }), ["POST /a"]);
  assert.deepEqual(routesOf({ "a/route.ts": 'export { GET, PUT } from "./x";' }), ["GET /a", "PUT /a"]);
});
test("verb detection: let/var, HEAD/OPTIONS, route.js/route.tsx", () => {
  assert.deepEqual(routesOf({ "a/route.ts": "export let HEAD = 1; export var OPTIONS = 2;" }), ["HEAD /a", "OPTIONS /a"]);
  assert.deepEqual(routesOf({ "a/route.js": "export function GET(){}", "b/route.tsx": "export async function POST(){}" }), ["GET /a", "POST /b"]);
});
test("verb detection: commented-out exports are NOT counted; // inside a string is not a comment", () => {
  assert.deepEqual(
    routesOf({ "a/route.ts": "// export async function GET(){}\n/* export const POST = 1;\n export { DELETE } */\nexport async function PUT(){}" }),
    ["PUT /a"],
  );
  assert.deepEqual(routesOf({ "a/route.ts": 'const s = "// not a comment"; export function PATCH(){}' }), ["PATCH /a"]);
});
test("enumeratePages: page.jsx / page.js / page.ts are found", () => {
  const root = tmp();
  put(root, "app/a/page.jsx", "");
  put(root, "app/b/page.js", "");
  put(root, "app/c/page.ts", "");
  assert.deepEqual(enumeratePages(path.join(root, "app")).sort(), ["/a", "/b", "/c"]);
});
test("collectCovered ignores commented-out covers()/coversPage()", () => {
  const root = tmp();
  put(root, "t/a.spec.ts", '// covers("GET /x");\n/* coversPage("/y"); */\ncovers("GET /z");');
  const c = collectCovered(path.join(root, "t"));
  assert.deepEqual([...c.routes], ["GET /z"]);
  assert.equal(c.pages.size, 0);
});
test("runCli: exit 2 (never a vacuous pass) when app/ or tests/regression is missing, or zero routes", () => {
  const msgs: string[] = [];
  const root = tmp();
  assert.equal(runCli(root, () => {}, (m) => msgs.push(m)), 2);
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  assert.equal(runCli(root, () => {}, (m) => msgs.push(m)), 2); // tests/regression still missing
  fs.mkdirSync(path.join(root, "tests", "regression"), { recursive: true });
  assert.equal(runCli(root, () => {}, (m) => msgs.push(m)), 2); // zero routes
  assert.equal(msgs.length, 3);
  assert.ok(msgs.every((m) => /vacuous/.test(m)));
});
test("runCli: 1 with gaps, 0 when complete", () => {
  const root = tmp();
  put(root, "app/api/route.ts", "export function GET(){}");
  put(root, "tests/regression/a.spec.ts", "// nothing");
  assert.equal(runCli(root, () => {}, () => {}), 1);
  put(root, "tests/regression/a.spec.ts", 'covers("GET /api");');
  assert.equal(runCli(root, () => {}, () => {}), 0);
});
