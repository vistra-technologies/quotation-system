/**
 * Unit tests for lib/partition-design.ts (Stage 22 Batch 7, U1-U6 + door/transom round-trip).
 *
 * Pure functions only — no DB, no network. Run via Node's built-in test runner + tsx loader
 * (Stage 22 D-15: no new test framework; `npm run test:unit`).
 *
 * NOTE on U5/U6 vs. the task file's literal wording (batch-7-tests-docs.md): the task file was
 * written against an assumed `parseDesign()` in a `lib/utils/design.ts` that was never built
 * (plan.md D-3/D-17) — the real pure module is `lib/partition-design.ts`, split into
 * `parseStoredDesign()` (reads: v1 OR v2, plus a documented no-geometry passthrough — see below)
 * and `parseDesignPatch()` (PATCH-body validation: v2 only, `panels` rejected). U5/U6 below are
 * adapted to what `parseStoredDesign()` actually does; the deviation from the task file's literal
 * behavior (a doc with neither `panels` nor `sections` nor `schemaVersion` is a DELIBERATE
 * no-geometry passthrough, not a parse error — see the `parseStoredDesign` doc comment) is
 * called out explicitly and covered by its own test rather than silently skipped.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoredDesign,
  parseDesignPatch,
  panelsToV2,
  PartitionDesignError,
  type ParseStoredOptions,
} from "../../lib/partition-design";

const noDoors: ParseStoredOptions["isDoorSelection"] = () => false;
const opts = (widthMm: number, heightMm: number, isDoorSelection = noDoors): ParseStoredOptions => ({
  widthMm,
  heightMm,
  isDoorSelection,
});

describe("parseStoredDesign — v1 (U1)", () => {
  test("a known-good v1 input returns the correct normalized panel view", () => {
    const v1 = {
      stops: { top: "stop-1", bottom: "stop-1", left: null, right: null },
      panels: [
        { id: "p1", type: "glass", widthMm: 1000, heightMm: 2400, selectionId: "sel-glass-1" },
        {
          id: "p2",
          type: "door",
          widthMm: 900,
          heightMm: 2400,
          selectionId: null,
          door: { selectionId: "sel-door-1", hinging: "left", outerFrame: { w: 900, h: 2100 } },
        },
      ],
    };
    const view = parseStoredDesign(v1, opts(1900, 2400));
    assert.equal(view.panels?.length, 2);
    assert.deepEqual(view.panels?.[0], {
      id: "p1",
      type: "glass",
      widthMm: 1000,
      heightMm: 2400,
      selectionId: "sel-glass-1",
    });
    assert.equal(view.panels?.[1].type, "door");
    assert.equal(view.panels?.[1].door?.selectionId, "sel-door-1");
    assert.deepEqual(view.stops, v1.stops);
  });
});

describe("parseStoredDesign — v2 (U2)", () => {
  test("a known-good v2 input returns the correct normalized panel view", () => {
    const v2 = {
      schemaVersion: 2 as const,
      defaults: { glassSelectionId: "sel-glass-default" },
      sections: [
        {
          id: "sec-1",
          widthMm: 900,
          cells: [{ id: "c-1a", heightMm: 4000, selectionId: "sel-glass-1" }],
        },
        {
          id: "sec-2",
          widthMm: 1200,
          cells: [
            { id: "c-2a", heightMm: 1200, selectionId: "sel-glass-1" },
            { id: "c-2b", heightMm: 2800, selectionId: "sel-door-1", hinging: "left" as const },
          ],
        },
      ],
    };
    const isDoorSelection = (id: string) => id === "sel-door-1";
    const view = parseStoredDesign(v2, opts(2100, 4000, isDoorSelection));
    assert.equal(view.panels?.length, 2);
    assert.deepEqual(view.panels?.[0], {
      id: "sec-1",
      type: "glass",
      widthMm: 900,
      heightMm: 4000,
      selectionId: "sel-glass-1",
      door: null,
    });
    // Door panel: transom's glass selectionId (sec-2's cell 0) carried on the panel's own
    // selectionId; the door itself carries its own selectionId + outerFrame derived from the
    // door cell's own height.
    assert.equal(view.panels?.[1].type, "door");
    assert.equal(view.panels?.[1].selectionId, "sel-glass-1");
    assert.deepEqual(view.panels?.[1].door, {
      selectionId: "sel-door-1",
      hinging: "left",
      outerFrame: { w: 1200, h: 2800 },
    });
  });
});

describe("parseStoredDesign — invariants (U3, U4)", () => {
  test("U3: a v2 input with a violated width-sum invariant throws a clear error", () => {
    const v2 = {
      schemaVersion: 2 as const,
      sections: [{ id: "sec-1", widthMm: 900, cells: [{ id: "c-1", heightMm: 4000, selectionId: null }] }],
    };
    // Partition.widthMm (2100) != sum(sections widths) (900)
    assert.throws(
      () => parseStoredDesign(v2, opts(2100, 4000)),
      (err: unknown) => err instanceof PartitionDesignError && /widths sum to 900mm/.test(err.message),
    );
  });

  test("U4: a v2 input with a violated per-section height-sum invariant throws a clear error", () => {
    const v2 = {
      schemaVersion: 2 as const,
      sections: [
        {
          id: "sec-1",
          widthMm: 900,
          cells: [
            { id: "c-1a", heightMm: 1000, selectionId: null },
            { id: "c-1b", heightMm: 1000, selectionId: null }, // sums to 2000, not 4000
          ],
        },
      ],
    };
    assert.throws(
      () => parseStoredDesign(v2, opts(900, 4000)),
      (err: unknown) =>
        err instanceof PartitionDesignError && /cell heights sum to 2000mm/.test(err.message),
    );
  });
});

describe("parseStoredDesign — malformed input (U5, U6 — adapted, see file header)", () => {
  test("U5 (adapted): a non-object stored design throws a parse error", () => {
    assert.throws(
      () => parseStoredDesign("not-an-object", opts(1000, 2000)),
      (err: unknown) => err instanceof PartitionDesignError && /is not an object/.test(err.message),
    );
  });

  test("U5 (deviation, documented not skipped): a doc with neither panels nor sections nor " +
    "schemaVersion is a DELIBERATE no-geometry passthrough, not a parse error " +
    "(parseStoredDesign doc comment; e.g. a partition whose design only carries `stops`)", () => {
    const noGeometry = { stops: { top: "stop-1" } };
    const view = parseStoredDesign(noGeometry, opts(1000, 2000));
    assert.equal(view.panels, undefined);
    assert.deepEqual(view.stops, { top: "stop-1" });
  });

  test("U6: a v2 input with schemaVersion: 2 but no sections array throws a parse error", () => {
    const bad = { schemaVersion: 2 };
    assert.throws(
      () => parseStoredDesign(bad, opts(1000, 2000)),
      (err: unknown) =>
        err instanceof PartitionDesignError &&
        /neither a v1 \(panels\) nor a v2 \(sections, schemaVersion 2\)/.test(err.message),
    );
  });

  test("U6 (PATCH-body variant): parseDesignPatch also rejects schemaVersion: 2 with no sections", () => {
    assert.throws(
      () => parseDesignPatch({ schemaVersion: 2 }),
      (err: unknown) =>
        err instanceof PartitionDesignError && /requires design\.sections/.test(err.message),
    );
  });

  test("parseDesignPatch rejects a legacy v1 `panels` body outright (D-8)", () => {
    assert.throws(
      () => parseDesignPatch({ panels: [] }),
      (err: unknown) =>
        err instanceof PartitionDesignError && /no longer accepted/.test(err.message),
    );
  });
});

describe("panelsToV2 <-> parseStoredDesign — door/transom round trip (D-4)", () => {
  test("a door shorter than the wall serializes to [transom, door] cells and reads back exactly", () => {
    const wallHeightMm = 4000;
    const panelView = {
      panels: [
        {
          id: "panel-a",
          type: "door" as const,
          widthMm: 1200,
          heightMm: wallHeightMm,
          selectionId: "sel-transom-glass", // the panel's own selectionId carries the transom's glass
          door: { selectionId: "sel-door-1", hinging: "left" as const, outerFrame: { w: 1200, h: 2800 } },
        },
      ],
    };
    const serialized = panelsToV2(panelView, wallHeightMm);
    assert.equal(serialized.schemaVersion, 2);
    assert.equal(serialized.sections?.length, 1);
    const cells = serialized.sections?.[0].cells;
    assert.equal(cells?.length, 2);
    assert.equal(cells?.[0].heightMm, 1200); // transom = 4000 - 2800
    assert.equal(cells?.[0].selectionId, "sel-transom-glass");
    assert.equal(cells?.[1].heightMm, 2800);
    assert.equal(cells?.[1].selectionId, "sel-door-1");

    // No height drift reading it back (E4's behavioral invariant, unit-covered here too).
    const isDoorSelection = (id: string) => id === "sel-door-1";
    const roundTripped = parseStoredDesign(
      { schemaVersion: 2, sections: serialized.sections },
      opts(1200, wallHeightMm, isDoorSelection),
    );
    assert.deepEqual(roundTripped.panels?.[0], panelView.panels[0]);
  });

  test("a full-height door serializes to a single cell (no transom)", () => {
    const wallHeightMm = 2400;
    const panelView = {
      panels: [
        {
          id: "panel-a",
          type: "door" as const,
          widthMm: 900,
          heightMm: wallHeightMm,
          selectionId: null,
          door: { selectionId: "sel-door-1", hinging: "right" as const, outerFrame: { w: 900, h: 2400 } },
        },
      ],
    };
    const serialized = panelsToV2(panelView, wallHeightMm);
    assert.equal(serialized.sections?.[0].cells.length, 1);
    assert.equal(serialized.sections?.[0].cells[0].heightMm, 2400);
  });

  test("transom selectionId fallback order: panel's own selectionId -> defaults.glassSelectionId -> null", () => {
    const wallHeightMm = 4000;
    const door = { selectionId: "sel-door-1", hinging: "left" as const, outerFrame: { w: 1000, h: 3000 } };

    // Panel's own selectionId wins when present.
    const withOwn = panelsToV2(
      { panels: [{ id: "p", type: "door", widthMm: 1000, heightMm: wallHeightMm, selectionId: "own-sel", door }] },
      wallHeightMm,
    );
    assert.equal(withOwn.sections?.[0].cells[0].selectionId, "own-sel");

    // Falls back to defaults.glassSelectionId when the panel's own is null.
    const withDefault = panelsToV2(
      {
        defaults: { glassSelectionId: "default-sel" },
        panels: [{ id: "p", type: "door", widthMm: 1000, heightMm: wallHeightMm, selectionId: null, door }],
      },
      wallHeightMm,
    );
    assert.equal(withDefault.sections?.[0].cells[0].selectionId, "default-sel");

    // Null when neither is present.
    const withNeither = panelsToV2(
      { panels: [{ id: "p", type: "door", widthMm: 1000, heightMm: wallHeightMm, selectionId: null, door }] },
      wallHeightMm,
    );
    assert.equal(withNeither.sections?.[0].cells[0].selectionId, null);
  });
});
