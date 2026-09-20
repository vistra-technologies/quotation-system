/**
 * Unit tests for lib/config-snapshot.ts's buildConfigSnapshot (Stage 22 Batch 4/7).
 * Pure — no DB; loadConfigSnapshot (the DB-calling half) is covered by the B4 preview/dry-run
 * verification (verify-b4.md, dryrun reports), not here.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildConfigSnapshot } from "../../lib/config-snapshot";

describe("buildConfigSnapshot", () => {
  const takenAt = new Date("2026-09-20T00:00:00.000Z");

  test("shapes rows into { takenAt, componentTypes[] }, preserving row order", () => {
    const rows = [
      { id: "1", code: "GLASS", name: "Glass", active: true, fieldsSchema: [], orgConfig: null },
      { id: "2", code: "DOOR", name: "Door", active: false, fieldsSchema: [{ key: "hinging" }], orgConfig: null },
    ];
    const snapshot = buildConfigSnapshot(rows, takenAt);
    assert.equal(snapshot.takenAt, "2026-09-20T00:00:00.000Z");
    assert.equal(snapshot.componentTypes.length, 2);
    assert.equal(snapshot.componentTypes[0].code, "GLASS");
    assert.equal(snapshot.componentTypes[1].code, "DOOR");
    // Inactive types are included (a Selection may reference one) — order preserved, not filtered.
    assert.equal(snapshot.componentTypes[1].active, false);
  });

  test("fieldOptionsConfig falls back to {} when there is no ComponentTypeOrgConfig row", () => {
    const rows = [
      { id: "1", code: "GLASS", name: "Glass", active: true, fieldsSchema: [], orgConfig: null },
    ];
    const snapshot = buildConfigSnapshot(rows, takenAt);
    assert.deepEqual(snapshot.componentTypes[0].fieldOptionsConfig, {});
  });

  test("fieldOptionsConfig is taken from the org config row when present", () => {
    const rows = [
      {
        id: "1",
        code: "GLASS",
        name: "Glass",
        active: true,
        fieldsSchema: [],
        orgConfig: { fieldOptionsConfig: { glassType: ["Clear", "Frosted"] } },
      },
    ];
    const snapshot = buildConfigSnapshot(rows, takenAt);
    assert.deepEqual(snapshot.componentTypes[0].fieldOptionsConfig, { glassType: ["Clear", "Frosted"] });
  });

  test("no category or other FK is ever added to the snapshot shape (Decision #6)", () => {
    const rows = [
      { id: "1", code: "GLASS", name: "Glass", active: true, fieldsSchema: [], orgConfig: null },
    ];
    const snapshot = buildConfigSnapshot(rows, takenAt);
    assert.deepEqual(Object.keys(snapshot.componentTypes[0]).sort(), [
      "active",
      "code",
      "fieldOptionsConfig",
      "fieldsSchema",
      "id",
      "name",
    ]);
  });

  test("defaults takenAt to now() when not supplied", () => {
    const before = Date.now();
    const snapshot = buildConfigSnapshot([]);
    const after = Date.now();
    const takenAtMs = new Date(snapshot.takenAt).getTime();
    assert.ok(takenAtMs >= before && takenAtMs <= after);
  });
});
