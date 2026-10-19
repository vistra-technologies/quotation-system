/**
 * Unit tests for lib/divider-snap.ts (Stage 34 S34-3, Batch 4): 1000 mm / 12 px and 100 mm / 7 px pulls,
 * both-round wins, free past the threshold. Pure functions only. Run via `npm run test:unit`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { snapDivider } from "../../lib/divider-snap";

// 2 mm per px: 12 px = 24 mm, 7 px = 14 mm.
const S = 2;

describe("snapDivider: 1000 mm pull (12 px)", () => {
  test("snaps the left width within 12 px, free at 13 px", () => {
    assert.deepEqual(snapDivider({ leftMm: 1020, pairMm: 3000, mmPerPx: S }), { leftMm: 1000, step: 1000, sides: [0, 1] });
    assert.equal(snapDivider({ leftMm: 1026, pairMm: 3000, mmPerPx: S }), null); // 13 px from 1000: past both pulls
  });
  test("snaps the RIGHT width to a multiple of 1000", () => {
    // pair 3300: right 1000 -> left 2300. Left 2310 is 5 px from there.
    assert.deepEqual(snapDivider({ leftMm: 2310, pairMm: 3300, mmPerPx: S }), { leftMm: 2300, step: 1000, sides: [1] });
  });
  test("the 1000 pass beats a nearer 100 candidate", () => {
    // left 1018: 1000 is 9 px away (<= 12) and 1000 is also the 100 candidate; step must report 1000.
    const r = snapDivider({ leftMm: 1018, pairMm: 3000, mmPerPx: S });
    assert.equal(r?.step, 1000);
    assert.equal(r?.leftMm, 1000);
  });
});

describe("snapDivider: 100 mm pull (7 px)", () => {
  test("snaps within 7 px, free at 8 px", () => {
    assert.deepEqual(snapDivider({ leftMm: 1214, pairMm: 3050, mmPerPx: S }), { leftMm: 1200, step: 100, sides: [0] });
    assert.equal(snapDivider({ leftMm: 1216, pairMm: 3050, mmPerPx: S }), null); // 8 px from 1200; the right-hand candidate is 17 px away
  });
});

describe("snapDivider: both widths round wins", () => {
  test("pair that is a multiple of the step reports both sides", () => {
    assert.deepEqual(snapDivider({ leftMm: 1004, pairMm: 2000, mmPerPx: S }), { leftMm: 1000, step: 1000, sides: [0, 1] });
    assert.deepEqual(snapDivider({ leftMm: 1204, pairMm: 2000, mmPerPx: S }), { leftMm: 1200, step: 100, sides: [0, 1] });
  });
  test("pair that is not a multiple snaps only the side that can be round", () => {
    const r = snapDivider({ leftMm: 1004, pairMm: 2150, mmPerPx: S });
    assert.deepEqual(r, { leftMm: 1000, step: 1000, sides: [0] });
  });
});

describe("snapDivider: minimum width and scale", () => {
  test("never snaps a neighbour below the minimum", () => {
    // left 96 -> would round to 100 (ok), left 40 -> rounds to 0 (< 100): rejected.
    assert.equal(snapDivider({ leftMm: 40, pairMm: 3000, mmPerPx: S }), null);
    assert.deepEqual(snapDivider({ leftMm: 104, pairMm: 3000, mmPerPx: S }), { leftMm: 100, step: 100, sides: [0, 1] });
  });
  test("thresholds scale with mm per px (zoom)", () => {
    assert.equal(snapDivider({ leftMm: 1020, pairMm: 3000, mmPerPx: 0.5 }), null); // 40 px away
    assert.equal(snapDivider({ leftMm: 1020, pairMm: 3000, mmPerPx: 2 })?.leftMm, 1000); // 10 px away
  });
  test("sweep: result is whole mm, within the pull, left + right = pair, minimum kept", () => {
    const pair = 2750;
    for (let left = 100; left <= pair - 100; left++) {
      const r = snapDivider({ leftMm: left, pairMm: pair, mmPerPx: S });
      if (!r) continue;
      assert.ok(Number.isInteger(r.leftMm));
      assert.ok(r.leftMm >= 100 && pair - r.leftMm >= 100);
      const px = r.step === 1000 ? 12 : 7;
      assert.ok(Math.abs(r.leftMm - left) / S <= px, `left ${left} -> ${r.leftMm}`);
      for (const side of r.sides) {
        const w: number = side === 0 ? r.leftMm : pair - r.leftMm;
        assert.equal(w % r.step, 0);
      }
      assert.ok(r.sides.length >= 1);
    }
  });
});
