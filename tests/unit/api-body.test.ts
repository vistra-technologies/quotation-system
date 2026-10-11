import { test } from "node:test";
import assert from "node:assert/strict";
import { readJsonObject, parseJsonObjectText, parseOptionalDate } from "../../lib/api-body";

const req = (body: string) => new Request("http://x.test/", { method: "POST", body });

test("readJsonObject: a JSON object passes through", async () => {
  const r = await readJsonObject(req('{"a":1}'));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.body, { a: 1 });
});

test("readJsonObject: unparseable, null, array and primitive bodies are 400 with the fixed text", async () => {
  for (const text of ["{not json", "", "null", "[]", "[1]", '"s"', "1", "true"]) {
    const r = await readJsonObject(req(text));
    assert.equal(r.ok, false, text);
    if (!r.ok) {
      assert.equal(r.response.status, 400, text);
      assert.deepEqual(await r.response.json(), { error: "Request body must be a JSON object" }, text);
    }
  }
});

test("parseJsonObjectText: same rules on text already read", () => {
  assert.equal(parseJsonObjectText("{}").ok, true);
  assert.equal(parseJsonObjectText("null").ok, false);
  assert.equal(parseJsonObjectText("[1]").ok, false);
});

test("parseOptionalDate: a valid date is UTC midnight", () => {
  const r = parseOptionalDate("2026-03-01", "submissionDate");
  assert.ok("value" in r);
  if ("value" in r) assert.equal(r.value?.toISOString(), "2026-03-01T00:00:00.000Z");
  const t = parseOptionalDate(" 2026-03-01 ", "submissionDate");
  assert.ok("value" in t && t.value?.toISOString() === "2026-03-01T00:00:00.000Z");
});

test("parseOptionalDate: absent, blank and non-string values clear to null (as before)", () => {
  for (const v of [undefined, null, "", "   ", 5, {}, true]) {
    assert.deepEqual(parseOptionalDate(v, "projectDeadline"), { value: null }, String(v));
  }
});

test("parseOptionalDate: an unparseable string names the field", () => {
  for (const v of ["not-a-date", "2026-13-01", "2026-02-30", "01/02/2026", "2026-03-01T10:00"]) {
    assert.deepEqual(
      parseOptionalDate(v, "projectDeadline"),
      { error: "projectDeadline must be a valid date (YYYY-MM-DD)" },
      v,
    );
  }
});
