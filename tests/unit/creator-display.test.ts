import { test } from "node:test";
import assert from "node:assert/strict";
import { creatorView } from "../../lib/creator-display";

test("present creator: username and full name", () => {
  assert.deepEqual(creatorView({ username: "priya", name: "Priya S" }, null), {
    removed: false,
    username: "priya",
    fullName: "Priya S",
  });
  // detail selects carry no name
  assert.deepEqual(creatorView({ username: "priya" }, "stale snapshot"), {
    removed: false,
    username: "priya",
    fullName: null,
  });
});

test("null creator: removed, uses the snapshot name", () => {
  assert.deepEqual(creatorView(null, "Priya S"), { removed: true, name: "Priya S" });
  assert.deepEqual(creatorView(undefined, "  Priya S  "), { removed: true, name: "Priya S" });
});

test("null creator with no snapshot: removed with a null name (page shows a generic label)", () => {
  assert.deepEqual(creatorView(null, null), { removed: true, name: null });
  assert.deepEqual(creatorView(null, "   "), { removed: true, name: null });
});

import { creatorCell } from "../../lib/creator-display";

test("creatorCell: present creator shows username with the full name as title", () => {
  const r = creatorCell({ username: "priya", name: "Priya S" }, null, (n) => `${n} (removed)`, "Unknown user");
  assert.deepEqual(r, { text: "priya", title: "Priya S" });
});

test("creatorCell: removed creator shows the snapshot, or the unknown fallback", () => {
  const f = (n: string) => `${n} (removed)`;
  assert.deepEqual(creatorCell(null, "Priya S", f, "Unknown user"), { text: "Priya S (removed)", title: undefined });
  assert.deepEqual(creatorCell(null, null, f, "Unknown user"), { text: "Unknown user (removed)", title: undefined });
});
