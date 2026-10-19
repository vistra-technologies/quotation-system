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
  pickTransomGlass,
  fillDefaultGlass,
  isGlassCell,
  fillDefaultGlassPanels,
  panelNeedsGlass,
  type DesignPanel,
  type DesignSectionV2,
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

describe("pickTransomGlass (H-7)", () => {
  const ps = [
    { id: "a", selectionId: null },
    { id: "b", selectionId: "g1" },
    { id: "c", selectionId: "g1" },
    { id: "d", selectionId: "g2" },
  ];
  test("uses the glass the other panels use (most common)", () => {
    assert.equal(pickTransomGlass(ps, "a", "dflt"), "g1");
  });
  test("ignores the panel itself", () => {
    assert.equal(pickTransomGlass([{ id: "a", selectionId: "x" }], "a", null), null);
  });
  test("falls back to the design default, then null", () => {
    assert.equal(pickTransomGlass([{ id: "a", selectionId: null }], "a", "dflt"), "dflt");
    assert.equal(pickTransomGlass([{ id: "a", selectionId: null }], "a"), null);
  });
});

test("isDesignMm: integers in 1..MAX_DESIGN_MM only", async () => {
  const { isDesignMm, MAX_DESIGN_MM } = await import("../../lib/partition-design");
  for (const ok of [1, 2400, MAX_DESIGN_MM]) assert.equal(isDesignMm(ok), true, String(ok));
  for (const bad of [0, -1, 1.5, MAX_DESIGN_MM + 1, NaN, Infinity, "5", null, undefined]) {
    assert.equal(isDesignMm(bad), false, String(bad));
  }
});

describe("fillDefaultGlass (Stage 34 S34-7)", () => {
  const cell = (id: string, selectionId: string | null, hinging?: "left" | "right") => ({
    id,
    heightMm: 1000,
    selectionId,
    ...(hinging ? { hinging } : {}),
  });
  const sec = (id: string, ...cells: ReturnType<typeof cell>[]): DesignSectionV2 => ({ id, widthMm: 900, cells });

  test("fills a null one-cell glass section", () => {
    const input = [sec("s1", cell("c1", null))];
    const r = fillDefaultGlass(input, "G");
    assert.equal(r.changed, true);
    assert.equal(r.sections[0].cells[0].selectionId, "G");
  });

  test("keeps an already-assigned cell", () => {
    const input = [sec("s1", cell("c1", "OTHER"))];
    const r = fillDefaultGlass(input, "G");
    assert.equal(r.changed, false);
    assert.equal(r.sections, input);
  });

  test("never touches a one-cell door section (hinging)", () => {
    const input = [sec("s1", cell("c1", null, "left"))];
    const r = fillDefaultGlass(input, "G");
    assert.equal(r.changed, false);
    assert.equal(r.sections[0].cells[0].selectionId, null);
  });

  test("transom section: cells[0] glass filled, cells[1] door untouched", () => {
    const input = [sec("s1", cell("c1", null), cell("c2", null, "right"))];
    const r = fillDefaultGlass(input, "G");
    assert.equal(r.sections[0].cells[0].selectionId, "G");
    assert.equal(r.sections[0].cells[1].selectionId, null);
  });

  test("null glassId is a no-op returning the same array", () => {
    const input = [sec("s1", cell("c1", null))];
    const r = fillDefaultGlass(input, null);
    assert.equal(r.changed, false);
    assert.equal(r.sections, input);
  });

  test("ignores a locked flag on a cell", () => {
    const locked = { ...cell("c1", null), locked: true } as ReturnType<typeof cell>;
    const r = fillDefaultGlass([sec("s1", locked)], "G");
    assert.equal(r.sections[0].cells[0].selectionId, "G");
  });

  test("does not mutate its input", () => {
    const input = [sec("s1", cell("c1", null))];
    const snapshot = JSON.stringify(input);
    fillDefaultGlass(input, "G");
    assert.equal(JSON.stringify(input), snapshot);
  });

  test("a stored section without a cells array is skipped, not thrown on", () => {
    const bad = { id: "bad", widthMm: 900 } as unknown as DesignSectionV2;
    const good = sec("s2", cell("c1", null));
    const r = fillDefaultGlass([bad, good], "G");
    assert.equal(r.changed, true);
    assert.equal(r.sections[0], bad);
    assert.equal(r.sections[1].cells[0].selectionId, "G");
  });

  test("isGlassCell: three-cell sections have no glass cell by this rule", () => {
    assert.equal(isGlassCell(sec("s", cell("a", null), cell("b", null), cell("c", null)), 0), false);
  });
});

describe("locked flag (Stage 34 S34-3)", () => {
  const cellOf = (id: string) => ({ id, heightMm: 2400, selectionId: null });
  const patch = (locked?: unknown) => ({
    schemaVersion: 2,
    sections: [{ id: "s1", widthMm: 1000, cells: [cellOf("c1")], ...(locked === undefined ? {} : { locked }) }],
  });

  test("true is kept, false and absent are stored as absent", () => {
    assert.equal(parseDesignPatch(patch(true))!.sections![0].locked, true);
    assert.equal("locked" in parseDesignPatch(patch(false))!.sections![0], false);
    assert.equal("locked" in parseDesignPatch(patch())!.sections![0], false);
  });

  test("any other value is rejected", () => {
    for (const bad of [null, "true", 1, 0, {}, []]) {
      assert.throws(
        () => parseDesignPatch(patch(bad)),
        (err: unknown) => err instanceof PartitionDesignError && /sections\[0\]\.locked must be true or false/.test(err.message),
        String(bad),
      );
    }
  });

  test("round trip keeps locked on glass, full-height door and transom sections; omits it when false", () => {
    const wall = 2400;
    const isDoor = (id: string) => id === "door";
    const view = {
      panels: [
        { id: "g", type: "glass" as const, widthMm: 800, heightMm: wall, selectionId: "G", door: null, locked: true },
        { id: "d", type: "door" as const, widthMm: 800, heightMm: wall, selectionId: null, locked: true,
          door: { selectionId: "door", hinging: "left" as const, outerFrame: { w: 800, h: wall } } },
        { id: "t", type: "door" as const, widthMm: 800, heightMm: wall, selectionId: "G", locked: true,
          door: { selectionId: "door", hinging: "right" as const, outerFrame: { w: 800, h: 2000 } } },
        { id: "u", type: "glass" as const, widthMm: 800, heightMm: wall, selectionId: "G", door: null, locked: false },
      ],
    };
    const v2 = panelsToV2(view, wall);
    assert.deepEqual(v2.sections!.map((s) => s.locked), [true, true, true, undefined]);
    assert.equal("locked" in v2.sections![3], false);
    const back = parseStoredDesign({ schemaVersion: 2, sections: v2.sections }, opts(3200, wall, isDoor));
    assert.deepEqual(back.panels!.map((p) => !!p.locked), [true, true, true, false]);
    // and the stored shape re-validates through the PATCH parser unchanged
    assert.deepEqual(parseDesignPatch({ schemaVersion: 2, sections: v2.sections })!.sections, v2.sections);
  });

  test("fillDefaultGlass keeps locked", () => {
    const s: DesignSectionV2[] = [{ id: "s", widthMm: 900, locked: true, cells: [{ id: "c", heightMm: 1000, selectionId: null }] }];
    assert.equal(fillDefaultGlass(s, "G").sections[0].locked, true);
  });
});

describe("fillDefaultGlassPanels (Stage 34 S34-7 client mirror)", () => {
  const wall = 2400;
  const glass = (id: string, selectionId: string | null): DesignPanel => ({ id, type: "glass", widthMm: 800, heightMm: wall, selectionId, door: null });
  const door = (id: string, h: number, selectionId: string | null): DesignPanel => ({
    id, type: "door", widthMm: 800, heightMm: wall, selectionId,
    door: { selectionId: "door", hinging: "left", outerFrame: { w: 800, h } },
  });

  test("fills a null glass panel and a transom, never a full-height door, never overrides", () => {
    const r = fillDefaultGlassPanels([glass("a", null), glass("b", "X"), door("c", wall, null), door("d", 2000, null), door("e", 2000, "Y")], wall, "G");
    assert.equal(r.changed, true);
    assert.deepEqual(r.panels.map((p) => p.selectionId), ["G", "X", null, "G", "Y"]);
  });
  test("null glass id: same array, unchanged; nothing to fill: same array", () => {
    const input = [glass("a", null)];
    assert.equal(fillDefaultGlassPanels(input, wall, null).panels, input);
    const full = [glass("a", "X")];
    assert.equal(fillDefaultGlassPanels(full, wall, "G").panels, full);
  });
  test("a locked panel's null glass is still filled (a fill is not a change)", () => {
    const r = fillDefaultGlassPanels([{ ...glass("a", null), locked: true }], wall, "G");
    assert.equal(r.panels[0].selectionId, "G");
    assert.equal(r.panels[0].locked, true);
  });
  test("panelNeedsGlass rounds the door height like panelsToV2", () => {
    assert.equal(panelNeedsGlass(door("d", 2399.6, null), wall), false); // rounds to 2400 = full height
    assert.equal(panelNeedsGlass(door("d", 2399.4, null), wall), true);
  });
  test("parity with fillDefaultGlass on the stored shape", () => {
    const sets: DesignPanel[][] = [
      [glass("a", null), glass("b", "X")],
      [door("c", wall, null), door("d", 1500, null), glass("e", null)],
      [door("c", 0, null)],
      [glass("a", "X")],
    ];
    for (const panels of sets) {
      const viaPanels = panelsToV2({ panels: fillDefaultGlassPanels(panels, wall, "G").panels }, wall).sections;
      const viaSections = fillDefaultGlass(panelsToV2({ panels }, wall).sections!, "G").sections;
      assert.deepEqual(viaPanels, viaSections);
    }
  });
});
