/**
 * Unit tests for the pure exports of prisma/migrate-design-v1-to-v2.ts (Stage 22 Batch 2/7).
 *
 * Importing the script module is safe without a DB: `main()` only runs when the module is the
 * process entrypoint (`process.argv[1]` check at the bottom of the file), and the top-level
 * `dotenv.config()` calls just read .env files, never open a connection. Pure functions only.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  endpointOf,
  classifyDesign,
  convertV1ToV2,
} from "../../prisma/migrate-design-v1-to-v2";
import { PartitionDesignError } from "../../lib/partition-design";

describe("endpointOf — Neon endpoint parsing (guard building block)", () => {
  test("extracts the endpoint id from a plain connection string", () => {
    assert.equal(
      endpointOf("postgresql://user:pass@ep-dark-term-ai0ufj4k.us-east-2.aws.neon.tech/db"),
      "ep-dark-term-ai0ufj4k",
    );
  });

  test("strips a -pooler suffix", () => {
    assert.equal(
      endpointOf("postgresql://user:pass@ep-dark-term-ai0ufj4k-pooler.us-east-2.aws.neon.tech/db"),
      "ep-dark-term-ai0ufj4k",
    );
  });

  test("returns null for an unparseable URL", () => {
    assert.equal(endpointOf("not a url"), null);
  });
});

describe("classifyDesign", () => {
  test("classifies a v2 doc", () => {
    assert.deepEqual(classifyDesign({ schemaVersion: 2, sections: [] }), { kind: "v2" });
  });
  test("classifies a v1 doc", () => {
    assert.deepEqual(classifyDesign({ panels: [] }), { kind: "v1" });
  });
  test("classifies a no-geometry doc (stops only)", () => {
    assert.deepEqual(classifyDesign({ stops: { top: "x" } }), { kind: "no-geometry" });
  });
  test("classifies null/non-object as malformed", () => {
    assert.equal(classifyDesign(null).kind, "malformed");
    assert.equal(classifyDesign("x").kind, "malformed");
  });
  test("classifies a doc with both panels and sections as malformed", () => {
    assert.equal(classifyDesign({ panels: [], sections: [] }).kind, "malformed");
  });
});

describe("convertV1ToV2", () => {
  const partition = { widthMm: 2100, heightMm: 4000 };
  const doorPartition = { widthMm: 1200, heightMm: 4000 }; // matches the single 1200mm-wide door panel below

  test("converts a glass panel to a single-cell section", () => {
    const result = convertV1ToV2(
      {
        panels: [
          { id: "p1", type: "glass", widthMm: 2100, heightMm: 4000, selectionId: "sel-glass-1" },
        ],
      },
      partition,
    );
    assert.equal((result.design as { schemaVersion: number }).schemaVersion, 2);
    const sections = (result.design as { sections: unknown[] }).sections as Array<{
      widthMm: number;
      cells: Array<{ heightMm: number; selectionId: string | null }>;
    }>;
    assert.equal(sections.length, 1);
    assert.equal(sections[0].cells.length, 1);
    assert.equal(sections[0].cells[0].selectionId, "sel-glass-1");
    assert.equal(result.nullTransomCells, 0);
  });

  test("converts a door-with-transom panel, falling back to design.defaults.glassSelectionId " +
    "when the panel's own selectionId is null (human decision, review-3 #5)", () => {
    const result = convertV1ToV2(
      {
        defaults: { glassSelectionId: "default-glass" },
        panels: [
          {
            id: "p1",
            type: "door",
            widthMm: 1200,
            heightMm: 4000,
            selectionId: null, // panel's own is absent -> falls back to defaults
            door: { selectionId: "sel-door-1", hinging: "left", outerFrame: { w: 1200, h: 2800 } },
          },
        ],
      },
      doorPartition,
    );
    const sections = (result.design as { sections: unknown[] }).sections as Array<{
      cells: Array<{ heightMm: number; selectionId: string | null }>;
    }>;
    assert.equal(sections[0].cells.length, 2);
    assert.equal(sections[0].cells[0].heightMm, 1200); // 4000 - 2800
    assert.equal(sections[0].cells[0].selectionId, "default-glass");
    assert.equal(result.nullTransomCells, 0);
  });

  test("uses the panel's own selectionId over defaults when both are present", () => {
    const result = convertV1ToV2(
      {
        defaults: { glassSelectionId: "default-glass" },
        panels: [
          {
            id: "p1",
            type: "door",
            widthMm: 1200,
            heightMm: 4000,
            selectionId: "own-glass",
            door: { selectionId: "sel-door-1", hinging: "left", outerFrame: { w: 1200, h: 2800 } },
          },
        ],
      },
      doorPartition,
    );
    const sections = (result.design as { sections: unknown[] }).sections as Array<{
      cells: Array<{ selectionId: string | null }>;
    }>;
    assert.equal(sections[0].cells[0].selectionId, "own-glass");
  });

  test("null transom selectionId is valid v2 and counted, not an error", () => {
    const result = convertV1ToV2(
      {
        panels: [
          {
            id: "p1",
            type: "door",
            widthMm: 1200,
            heightMm: 4000,
            selectionId: null,
            door: { selectionId: "sel-door-1", hinging: "left", outerFrame: { w: 1200, h: 2800 } },
          },
        ],
      },
      doorPartition,
    );
    assert.equal(result.nullTransomCells, 1);
  });

  test("rejects a glass panel whose heightMm doesn't match Partition.heightMm (anomalous geometry)", () => {
    assert.throws(
      () =>
        convertV1ToV2(
          {
            panels: [
              { id: "p1", type: "glass", widthMm: 2100, heightMm: 3900, selectionId: "sel-1" },
            ],
          },
          partition,
        ),
      PartitionDesignError,
    );
  });

  test("rejects a door whose outerFrame.h is outside 1..wallHeight", () => {
    assert.throws(
      () =>
        convertV1ToV2(
          {
            panels: [
              {
                id: "p1",
                type: "door",
                widthMm: 1200,
                heightMm: 4000,
                selectionId: null,
                door: { selectionId: "sel-door-1", hinging: "left", outerFrame: { w: 1200, h: 4500 } },
              },
            ],
          },
          partition,
        ),
      PartitionDesignError,
    );
  });

  test("rejects when the converted section widths don't sum to Partition.widthMm", () => {
    assert.throws(
      () =>
        convertV1ToV2(
          {
            panels: [
              { id: "p1", type: "glass", widthMm: 900, heightMm: 4000, selectionId: "sel-1" },
            ],
          },
          partition, // partition.widthMm is 2100, panel is only 900
        ),
      PartitionDesignError,
    );
  });
});
