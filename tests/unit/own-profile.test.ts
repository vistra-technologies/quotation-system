import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnProfileInput } from "../../lib/own-profile";

test("accepts the four editable fields and trims them", () => {
  const r = parseOwnProfileInput({
    firstName: "  Ada ",
    lastName: " Lovelace",
    mobile: " +1 555 ",
    profileEmail: " ada@example.com ",
  });
  assert.deepEqual(r, {
    ok: true,
    input: {
      firstName: "Ada",
      lastName: "Lovelace",
      mobile: "+1 555",
      profileEmail: "ada@example.com",
    },
  });
});

test("a single field is enough and only that field is returned", () => {
  const r = parseOwnProfileInput({ firstName: "Ada" });
  assert.deepEqual(r, { ok: true, input: { firstName: "Ada" } });
});

test("rejects privilege and identity keys instead of ignoring them", () => {
  for (const k of ["username", "roleId", "organizationId", "externalCompanyId", "active", "email", "id", "name"]) {
    const r = parseOwnProfileInput({ firstName: "Ada", [k]: "x" });
    assert.equal(r.ok, false, k);
  }
});

test("rejects non-objects and empty bodies", () => {
  for (const b of [null, [], "x", 5, {}]) {
    assert.equal(parseOwnProfileInput(b).ok, false);
  }
});

test("first and last name cannot be empty or blank, nor too long", () => {
  assert.equal(parseOwnProfileInput({ firstName: "" }).ok, false);
  assert.equal(parseOwnProfileInput({ lastName: "   " }).ok, false);
  assert.equal(parseOwnProfileInput({ firstName: null }).ok, false);
  assert.equal(parseOwnProfileInput({ firstName: "a".repeat(100) }).ok, true);
  assert.equal(parseOwnProfileInput({ firstName: "a".repeat(101) }).ok, false);
});

test("mobile and email may be cleared (empty or null -> null)", () => {
  assert.deepEqual(parseOwnProfileInput({ mobile: "", profileEmail: "  " }), {
    ok: true,
    input: { mobile: null, profileEmail: null },
  });
  assert.deepEqual(parseOwnProfileInput({ mobile: null, profileEmail: null }), {
    ok: true,
    input: { mobile: null, profileEmail: null },
  });
});

test("mobile is free text with a length cap; email needs a simple valid format", () => {
  assert.equal(parseOwnProfileInput({ mobile: "x".repeat(30) }).ok, true);
  assert.equal(parseOwnProfileInput({ mobile: "x".repeat(31) }).ok, false);
  assert.equal(parseOwnProfileInput({ mobile: 12345 }).ok, false);
  assert.equal(parseOwnProfileInput({ profileEmail: "nope" }).ok, false);
  assert.equal(parseOwnProfileInput({ profileEmail: "a@b" }).ok, false);
  assert.equal(parseOwnProfileInput({ profileEmail: "a b@c.de" }).ok, false);
  assert.equal(parseOwnProfileInput({ profileEmail: 5 }).ok, false);
  const long = "a".repeat(250) + "@b.co";
  assert.equal(parseOwnProfileInput({ profileEmail: long }).ok, false);
});
