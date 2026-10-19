/**
 * Divider snapping (Stage 34 S34-3, Batch 4). PURE module: no DOM, no React.
 *
 * While a divider between two neighbouring panels is dragged, either neighbour's width is pulled to a
 * multiple of 1000 mm (within 12 px) or of 100 mm (within 7 px). The 1000 pass is tried first. A position
 * that makes BOTH widths round wins. Past the threshold the drag is free (null).
 *
 * Pixel thresholds are converted to mm with `mmPerPx` (wall mm per screen px), so the caller passes the
 * current scale and this function never touches the DOM.
 */

import { MIN_PANEL_MM } from "@/lib/panel-widths";

export interface SnapInput {
  /** The left neighbour's width under the pointer (whole mm). */
  leftMm: number;
  /** Left + right neighbour widths (constant during the drag). */
  pairMm: number;
  mmPerPx: number;
  minMm?: number;
}

export interface SnapResult {
  /** The snapped left width (the right one is `pairMm - leftMm`). */
  leftMm: number;
  step: 1000 | 100;
  /** Which neighbour widths are round at the snapped position: 0 = left, 1 = right. */
  sides: (0 | 1)[];
}

/** [step in mm, pull in px], tried in this order. */
export const SNAP_PASSES: readonly [1000 | 100, number][] = [
  [1000, 12],
  [100, 7],
];

export function snapDivider({ leftMm, pairMm, mmPerPx, minMm = MIN_PANEL_MM }: SnapInput): SnapResult | null {
  for (const [step, px] of SNAP_PASSES) {
    const cands: { left: number; dist: number }[] = [];
    for (const side of [0, 1] as const) {
      const width = side === 0 ? leftMm : pairMm - leftMm;
      const round = Math.round(width / step) * step;
      const left = side === 0 ? round : pairMm - round;
      const dist = Math.abs(left - leftMm) / mmPerPx;
      if (left >= minMm && pairMm - left >= minMm && dist <= px) cands.push({ left, dist });
    }
    if (cands.length === 0) continue;
    const both = (c: { left: number }) => (c.left % step === 0 && (pairMm - c.left) % step === 0 ? 1 : 0);
    cands.sort((a, b) => a.dist - b.dist || both(b) - both(a));
    const best = cands[0]!;
    const sides: (0 | 1)[] = [];
    if (best.left % step === 0) sides.push(0);
    if ((pairMm - best.left) % step === 0) sides.push(1);
    return { leftMm: best.left, step, sides };
  }
  return null;
}
