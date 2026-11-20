/**
 * Review R-A finding 1: "Also matched by" must render the codes. The message is formatted with the real next-intl
 * core and the real en.json; the codes are a tag (`<codes></codes>`), not a plain argument, so the rich renderer
 * is called and its output lands in the result. A plain `{codes}` argument would pass the function through as a
 * value and render nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTranslator } from "use-intl/core";

const messages = JSON.parse(readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8"));

test("alsoMatchedBy calls the codes renderer and keeps the lead-in text", () => {
  const t = createTranslator({ locale: "en", messages, namespace: "inventory" });
  let called = 0;
  const out = t.rich("alsoMatchedBy", {
    codes: () => {
      called += 1;
      return "GL-NT2-152, GL-ID6-10";
    },
  }) as unknown;
  // use-intl returns a plain string when every part is a string, else an array of parts.
  const parts = Array.isArray(out) ? out : [out];
  assert.equal(called, 1, "the tag renderer must run");
  assert.equal(parts.join(""), "Also matched by GL-NT2-152, GL-ID6-10");
  assert.ok(
    parts.every((x) => typeof x !== "function"),
    "no function is left to render as nothing",
  );
});
