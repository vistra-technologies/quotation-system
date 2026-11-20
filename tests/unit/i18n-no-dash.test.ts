import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Q-D25 (Stage 38, Batch 2): no em dash (U+2014) or en dash (U+2013) in any UI string this stage adds or edits.
 * Scope: the three currency option labels, and every string of the namespaces Stage 38a adds or edits
 * (orgSettings, summaryNotice, inventory). Live strings elsewhere are tracked in the backlog, not scanned here.
 * The shared price formatter output is scanned in price-format.test.ts. Batch 4 extends this to the quotation namespace.
 */
const messages = JSON.parse(readFileSync(path.join(__dirname, "../../messages/en.json"), "utf8")) as Record<string, Record<string, unknown>>;
const DASH = /[–—]/;

function strings(node: unknown, prefix: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([prefix, node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, `${prefix}.${k}`, out);
  return out;
}

test("the currency option labels read 'INR (Indian Rupee)' style", () => {
  const ec = messages.externalCompanies;
  assert.equal(ec.currencyINR, "INR (Indian Rupee)");
  assert.equal(ec.currencyAED, "AED (UAE Dirham)");
  assert.equal(ec.currencyUSD, "USD (US Dollar)");
});

test("no U+2013 / U+2014 in the currency labels or the Stage 38a namespaces", () => {
  const scanned = [
    ...strings({ currencyINR: messages.externalCompanies.currencyINR, currencyAED: messages.externalCompanies.currencyAED, currencyUSD: messages.externalCompanies.currencyUSD }, "externalCompanies"),
    ...strings(messages.orgSettings, "orgSettings"),
    ...strings(messages.summaryNotice, "summaryNotice"),
    ...strings(messages.inventory, "inventory"),
  ];
  assert.ok(scanned.length > 80, "the scan found the namespaces");
  const hits = scanned.filter(([, v]) => DASH.test(v)).map(([k]) => k);
  assert.deepEqual(hits, []);
});

test("the unpriced mark is 'No price'", () => {
  assert.equal(messages.inventory.noPrice, "No price");
});
