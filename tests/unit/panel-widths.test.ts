/**
 * Unit tests for lib/panel-widths.ts (Stage 34 S34-3 / D-10): the shared redistribution module.
 * Pure functions only. Run via `npm run test:unit`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PANEL_MM,
  absorbDelta,
  planAddPanel,
  planEqualize,
  planRemove,
  planSetWidths,
  planWallWidth,
  type WidthPanel,
  type WidthPlan,
} from "../../lib/panel-widths";

const P = (id: string, widthMm: number, locked = false): WidthPanel => ({ id, widthMm, ...(locked ? { locked } : {}) });
const total = (ps: WidthPanel[]) => ps.reduce((s, p) => s + p.widthMm, 0);
function applied(ps: WidthPanel[], plan: WidthPlan): WidthPanel[] {
  assert.equal(plan.ok, true);
  if (!plan.ok) throw new Error("unreachable");
  return ps.map((p) => ({ ...p, widthMm: plan.widths[p.id] ?? p.widthMm }));
}

describe("MIN_PANEL_MM", () => {
  test("is 100 (D-10)", () => assert.equal(MIN_PANEL_MM, 100));
});

describe("absorbDelta", () => {
  test("proportional, whole mm, last absorber takes the remainder", () => {
    const next = absorbDelta([P("a", 333), P("b", 333), P("c", 334)], -100)!;
    assert.deepEqual(next, [300, 300, 300]);
    const odd = absorbDelta([P("a", 100), P("b", 100), P("c", 100)], 1)!;
    assert.equal(odd.reduce((s, v) => s + v, 0), 301);
    assert.equal(odd[2], 301 - odd[0] - odd[1]);
  });
  test("refuses when an absorber would shrink below the minimum", () => {
    assert.equal(absorbDelta([P("a", 150), P("b", 150)], -150), null);
  });
  test("an absorber already under the minimum may hold or grow", () => {
    assert.deepEqual(absorbDelta([P("a", 60)], 0), [60]);
    assert.deepEqual(absorbDelta([P("a", 60), P("b", 500)], 40)!.reduce((s, v) => s + v, 0), 600);
  });
  test("nothing to absorb with: null", () => assert.equal(absorbDelta([], 10), null));
});

describe("planSetWidths", () => {
  test("user scenario: 3 x 1000, P1=1000 then P2=1000 keeps P1 and only P3 changes", () => {
    const start = [P("p1", 1000), P("p2", 1000), P("p3", 1000)];
    // first make the wall uneven so the edits are real: 800 / 1000 / 1200
    let ps = [P("p1", 800), P("p2", 1000), P("p3", 1200)];
    const a = planSetWidths(ps, ["p1"], 1000);
    assert.equal(a.ok, true);
    if (!a.ok) return;
    assert.deepEqual(a.lockIds, ["p1"]);
    ps = applied(ps, a).map((p) => (p.id === "p1" ? { ...p, locked: true } : p));
    assert.equal(ps[0].widthMm, 1000);
    assert.equal(total(ps), total(start));
    const b = planSetWidths(ps, ["p2"], 1000);
    assert.equal(b.ok, true);
    if (!b.ok) return;
    assert.equal(b.widths.p1, undefined, "locked P1 is untouched");
    ps = applied(ps, b);
    assert.deepEqual(ps.map((p) => p.widthMm), [1000, 1000, 1000]);
    assert.deepEqual(b.lockIds, ["p2"]);
  });
  test("only unlocked non-targets move; locked widths never appear in the plan", () => {
    const ps = [P("a", 500, true), P("b", 700), P("c", 800), P("d", 1000)];
    const plan = planSetWidths(ps, ["b"], 900);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal("a" in plan.widths, false);
    const after = applied(ps, plan);
    assert.equal(total(after), total(ps));
    assert.equal(after[1].widthMm, 900);
  });
  test("all others locked: NO_ABSORBER", () => {
    const ps = [P("a", 1000, true), P("b", 1000), P("c", 1000, true)];
    const r = planSetWidths(ps, ["b"], 900);
    assert.deepEqual(r, { ok: false, reason: "NO_ABSORBER" });
  });
  test("value equal to the current width: ok, nothing changes, nothing locks", () => {
    const r = planSetWidths([P("a", 1000), P("b", 1000, true)], ["a"], 1000);
    assert.deepEqual(r, { ok: true, widths: {}, lockIds: [] });
  });
  test("a locked target is refused", () => {
    assert.deepEqual(planSetWidths([P("a", 1000, true), P("b", 1000)], ["a"], 900), { ok: false, reason: "TARGET_LOCKED" });
  });
  test("below the minimum: TOO_NARROW; not a number: INVALID", () => {
    const ps = [P("a", 1000), P("b", 1000)];
    assert.deepEqual(planSetWidths(ps, ["a"], 99), { ok: false, reason: "TOO_NARROW" });
    assert.deepEqual(planSetWidths(ps, ["a"], NaN), { ok: false, reason: "INVALID" });
    assert.deepEqual(planSetWidths(ps, ["a"], -5), { ok: false, reason: "INVALID" });
    assert.deepEqual(planSetWidths(ps, ["nope"], 500), { ok: false, reason: "INVALID" });
  });
  test("an absorber would drop under 100: TOO_WIDE", () => {
    assert.deepEqual(planSetWidths([P("a", 1000), P("b", 150)], ["a"], 1100), { ok: false, reason: "TOO_WIDE" });
  });
  test("multi-target: every target gets the width, only the changed ones lock", () => {
    const ps = [P("a", 1000), P("b", 800), P("c", 1200)];
    const r = planSetWidths(ps, ["a", "b"], 1000);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.lockIds, ["b"]);
    const after = applied(ps, r);
    assert.deepEqual(after.map((p) => p.widthMm), [1000, 1000, 1000]);
  });
});

describe("planWallWidth", () => {
  test("only unlocked panels grow, proportionally; total becomes the new width", () => {
    const ps = [P("a", 500, true), P("b", 1000), P("c", 1500)];
    const r = planWallWidth(ps, 3500);
    const after = applied(ps, r);
    assert.equal(total(after), 3500);
    assert.equal(after[0].widthMm, 500);
  });
  test("shrinks proportionally", () => {
    const ps = [P("a", 1000), P("b", 1000)];
    assert.equal(total(applied(ps, planWallWidth(ps, 1500))), 1500);
  });
  test("all locked: NO_ABSORBER; unchanged total: ok with no change", () => {
    const ps = [P("a", 1000, true), P("b", 1000, true)];
    assert.deepEqual(planWallWidth(ps, 2500), { ok: false, reason: "NO_ABSORBER" });
    assert.deepEqual(planWallWidth(ps, 2000), { ok: true, widths: {}, lockIds: [] });
  });
  test("shrinking so an absorber would go under 100: refused; absurd values refused", () => {
    const ps = [P("a", 1000), P("b", 150)];
    assert.deepEqual(planWallWidth(ps, 600), { ok: false, reason: "TOO_NARROW" });
    assert.deepEqual(planWallWidth(ps, 50), { ok: false, reason: "TOO_NARROW" });
    assert.deepEqual(planWallWidth(ps, 1e9), { ok: false, reason: "TOO_WIDE" });
    assert.deepEqual(planWallWidth(ps, NaN), { ok: false, reason: "INVALID" });
  });
});

describe("planEqualize", () => {
  test("whole wall: floor share, last takes the remainder, sum kept", () => {
    const ps = [P("a", 500), P("b", 1000), P("c", 901)];
    const after = applied(ps, planEqualize(ps, null));
    assert.deepEqual(after.map((p) => p.widthMm), [800, 800, 801]);
  });
  test("locked panels are untouched; only unlocked are evened", () => {
    const ps = [P("a", 500, true), P("b", 700), P("c", 1100)];
    const r = planEqualize(ps, null);
    const after = applied(ps, r);
    assert.deepEqual(after.map((p) => p.widthMm), [500, 900, 900]);
    assert.deepEqual((r as { lockIds: string[] }).lockIds, []);
  });
  test("scoped to a selection", () => {
    const ps = [P("a", 500), P("b", 700), P("c", 1100)];
    const after = applied(ps, planEqualize(ps, ["b", "c"]));
    assert.deepEqual(after.map((p) => p.widthMm), [500, 900, 900]);
  });
  test("fewer than two unlocked in scope: NO_ABSORBER", () => {
    assert.deepEqual(planEqualize([P("a", 500, true), P("b", 700), P("c", 1100, true)], null), { ok: false, reason: "NO_ABSORBER" });
    assert.deepEqual(planEqualize([P("a", 500), P("b", 700)], ["a"]), { ok: false, reason: "NO_ABSORBER" });
  });
  test("already equal: ok, empty plan", () => {
    assert.deepEqual(planEqualize([P("a", 500), P("b", 500)], null), { ok: true, widths: {}, lockIds: [] });
  });
});

describe("planAddPanel", () => {
  test("no locks: same result as the old even re-divide (2400 over 3 -> 600 x 4)", () => {
    const ps = [P("a", 800), P("b", 800), P("c", 800)];
    const r = planAddPanel(ps);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.newWidthMm, 600);
    const after = ps.map((p) => r.widths[p.id] ?? p.widthMm);
    assert.deepEqual(after, [600, 600, 600]);
    assert.equal(after.reduce((s, v) => s + v, 0) + r.newWidthMm, 2400);
  });
  test("locked panels are untouched; the new panel shares the unlocked width only", () => {
    const ps = [P("a", 1000, true), P("b", 700), P("c", 700)];
    const r = planAddPanel(ps);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal("a" in r.widths, false);
    assert.equal(r.newWidthMm, 466);
    assert.equal(ps[1].widthMm + ps[2].widthMm, (r.widths.b ?? 700) + (r.widths.c ?? 700) + r.newWidthMm);
  });
  test("none unlocked: NO_ABSORBER; too little room for a 100 mm panel: TOO_NARROW", () => {
    assert.deepEqual(planAddPanel([P("a", 1000, true)]), { ok: false, reason: "NO_ABSORBER" });
    assert.deepEqual(planAddPanel([P("a", 120), P("b", 120)]), { ok: false, reason: "TOO_NARROW" });
  });
});

describe("planRemove", () => {
  test("freed width goes to the unlocked survivors only", () => {
    const ps = [P("a", 500, true), P("b", 700), P("c", 800), P("d", 400)];
    const r = planRemove(ps, ["d"]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal("a" in r.widths, false);
    const survivors = ps.filter((p) => p.id !== "d").map((p) => ({ ...p, widthMm: r.widths[p.id] ?? p.widthMm }));
    assert.equal(total(survivors), total(ps));
  });
  test("no unlocked survivor: NO_ABSORBER", () => {
    assert.deepEqual(planRemove([P("a", 500, true), P("b", 700)], ["b"]), { ok: false, reason: "NO_ABSORBER" });
  });
});

describe("invariants over a seeded table", () => {
  test("total preserved and no locked id in any plan", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 300; n++) {
      const count = 2 + Math.floor(rnd() * 5);
      const ps = Array.from({ length: count }, (_, i) => P(`p${i}`, 100 + Math.floor(rnd() * 1500), rnd() < 0.3));
      const t = total(ps);
      const target = ps[Math.floor(rnd() * count)];
      const plans: WidthPlan[] = [
        planSetWidths(ps, [target.id], 100 + Math.floor(rnd() * 1500)),
        planWallWidth(ps, 200 + Math.floor(rnd() * 8000)),
        planEqualize(ps, null),
      ];
      for (const plan of plans) {
        if (!plan.ok) continue;
        for (const p of ps) if (p.locked) assert.equal(p.id in plan.widths, false, "locked id in plan");
        const after = applied(ps, plan);
        for (const p of after) assert.equal(Number.isInteger(p.widthMm), true);
        if (plan !== plans[1]) assert.equal(total(after), t);
      }
    }
  });
});
