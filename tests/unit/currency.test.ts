import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  CURRENCY_ERROR_MESSAGE,
  DEFAULT_CURRENCY_ERROR_MESSAGE,
} from "../../lib/currency";

test("the supported currencies are INR, AED, USD", () => {
  assert.deepEqual([...SUPPORTED_CURRENCIES], ["INR", "AED", "USD"]);
});

test("isSupportedCurrency: exact upper-case codes only", () => {
  for (const c of ["INR", "AED", "USD"]) assert.equal(isSupportedCurrency(c), true, c);
  for (const bad of ["EUR", "usd", "", " USD", "USD ", null, undefined, 1, {}, ["USD"]]) {
    assert.equal(isSupportedCurrency(bad), false, JSON.stringify(bad));
  }
});

test("the error messages are derived from the constant", () => {
  assert.equal(CURRENCY_ERROR_MESSAGE, "currency must be one of INR, AED, USD");
  // external-company wording is unchanged
  assert.equal(DEFAULT_CURRENCY_ERROR_MESSAGE, 'defaultCurrency must be "INR", "AED", or "USD"');
});
