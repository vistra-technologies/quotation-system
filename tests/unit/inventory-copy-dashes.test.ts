/**
 * UI AC5 (Stage 37, Q-D25): the Inventory page copy never carries an em dash, an en dash or a hyphen used as a
 * separator. Scans every string of the `inventory` namespace in messages/en.json (the delete confirm and
 * the item-added toast live there, so they are covered).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEASUREMENT_UNITS } from "../../lib/units";

const messages = JSON.parse(readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8")) as Record<string, unknown>;

function strings(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) strings(v, `${path}.${k}`, out);
  }
  return out;
}

const inventory = strings(messages.inventory, "inventory", []);

test("the inventory namespace exists with the delete confirm strings and the added toast", () => {
  const keys = new Set(inventory.map(([p]) => p));
  for (const k of ["deleteTitle", "deleteMessage", "deleteConfirm", "deleteFailed", "itemAdded", "pageTitle"]) {
    assert.ok(keys.has(`inventory.${k}`), k);
  }
  assert.ok(!keys.has("inventory.pageSubtitle"), "no subtitle: helper text is not allowed");
});

test("no inventory string contains U+2013, U+2014 or a spaced hyphen separator", () => {
  for (const [path, value] of inventory) {
    assert.ok(!/[–—]/.test(value), `${path}: dash`);
    assert.ok(!/ - /.test(value), `${path}: spaced hyphen`);
  }
});

test("unit labels (lib/units) are dash free too", () => {
  for (const u of MEASUREMENT_UNITS) assert.ok(!/[–—]/.test(u.label) && !/ - /.test(u.label), u.label);
});
