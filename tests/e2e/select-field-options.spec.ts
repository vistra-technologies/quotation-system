/**
 * Stage 20 — `SelectField` custom-listbox rewrite: pure-logic coverage for
 * `getOptionsFromChildren`.
 *
 * Per the stage's testing posture and Batch 4's `configurator-gating.spec.ts` precedent — no
 * unit-test runner exists in this repo, so pure-function coverage is written as plain
 * `test()`/`expect()` blocks that never request the `page`/`request` fixture. Playwright doesn't
 * launch a browser or touch any server for these, so they run the same way `tsc`/lint do — a
 * local, static check, not "app behavior" verification (run with a non-localhost
 * `PLAYWRIGHT_BASE_URL` to avoid the config's local-dev `webServer` auto-start, which only
 * matters when the default localhost baseURL is in effect).
 *
 * `<option>` elements are built with `React.createElement` (not JSX) to keep this a `.ts` file
 * consistent with the rest of `tests/e2e/`.
 */

import { test, expect } from "@playwright/test";
import React from "react";
import { getOptionsFromChildren } from "@/components/select-field";

const option = (
  value: string,
  label: React.ReactNode,
  extra?: { disabled?: boolean; title?: string },
) => React.createElement("option", { value, ...extra }, label);

test.describe("getOptionsFromChildren (pure)", () => {
  test("parses a plain list of <option> children", () => {
    const children = [option("usd", "USD"), option("eur", "EUR")];
    expect(getOptionsFromChildren(children)).toEqual([
      { value: "usd", label: "USD", disabled: undefined, title: undefined },
      { value: "eur", label: "EUR", disabled: undefined, title: undefined },
    ]);
  });

  test("carries disabled and title through", () => {
    const children = [option("a", "A", { disabled: true, title: "tip" })];
    const [opt] = getOptionsFromChildren(children);
    expect(opt.disabled).toBe(true);
    expect(opt.title).toBe("tip");
  });

  test("missing value defaults to empty string, not the string 'undefined'", () => {
    const noValue = React.createElement("option", {}, "No value");
    expect(getOptionsFromChildren([noValue])).toEqual([
      { value: "", label: "No value", disabled: undefined, title: undefined },
    ]);
  });

  test("skips non-<option> children defensively (e.g. a stray fragment/text node)", () => {
    const children = [
      option("x", "X"),
      React.createElement("span", {}, "not an option"),
      "a bare string child",
      null,
      option("y", "Y"),
    ];
    expect(getOptionsFromChildren(children).map((o) => o.value)).toEqual(["x", "y"]);
  });

  test("empty/undefined children yields an empty list", () => {
    expect(getOptionsFromChildren(undefined)).toEqual([]);
    expect(getOptionsFromChildren([])).toEqual([]);
  });
});
