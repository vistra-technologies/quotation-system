import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRevokeSessions } from "../../lib/session-revocation";

test("password reset always revokes", () => {
  for (const stored of [true, false]) {
    assert.equal(shouldRevokeSessions({ passwordChanged: true, nextActive: undefined, storedActive: stored }), true);
  }
});

test("deactivation revokes (even when already inactive: harmless and idempotent)", () => {
  assert.equal(shouldRevokeSessions({ passwordChanged: false, nextActive: false, storedActive: true }), true);
  assert.equal(shouldRevokeSessions({ passwordChanged: false, nextActive: false, storedActive: false }), true);
});

test("reactivation (stored false -> true) revokes leftover sessions", () => {
  assert.equal(shouldRevokeSessions({ passwordChanged: false, nextActive: true, storedActive: false }), true);
});

test("a no-op edit revokes nothing: re-sent active:true on an active user, or no active/password in the edit", () => {
  assert.equal(shouldRevokeSessions({ passwordChanged: false, nextActive: true, storedActive: true }), false);
  assert.equal(shouldRevokeSessions({ passwordChanged: false, nextActive: undefined, storedActive: true }), false);
  assert.equal(shouldRevokeSessions({ passwordChanged: false, nextActive: undefined, storedActive: false }), false);
});
