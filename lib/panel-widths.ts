/**
 * Panel-width redistribution (Stage 34 S34-3, D-10). PURE module: no prisma, no React, safe client-side.
 *
 * The one place that decides how a width change spreads over a wall. Used by the Design page reducer
 * (and, to pre-validate, by the menus, rail field and wall field).
 *
 * Rules:
 *   - Only UNLOCKED panels other than the edited ones absorb a change, proportionally to their current
 *     widths; the LAST absorber takes the rounding remainder. Locked panels are never in a plan.
 *   - Every edited target and every absorber ends >= MIN_PANEL_MM. An absorber already under the
 *     minimum may hold its width or grow, never shrink.
 *   - A refusal carries a code only (the UI maps it to a message); the draft is left unchanged.
 */

import { MAX_DESIGN_MM } from "@/lib/partition-design";

/** The one minimum panel width (mm), D-10. */
export const MIN_PANEL_MM = 100;

export interface WidthPanel {
  id: string;
  widthMm: number;
  locked?: boolean;
}

export type WidthRefusal = "NO_ABSORBER" | "TOO_NARROW" | "TOO_WIDE" | "TARGET_LOCKED" | "INVALID";

export type WidthPlan =
  | {
      ok: true;
      /** ONLY the panels whose width changes. */
      widths: Record<string, number>;
      /** Panels that become locked by this edit (typed / standard width targets that changed). */
      lockIds: string[];
    }
  | { ok: false; reason: WidthRefusal };

export type AddPanelPlan =
  | { ok: true; widths: Record<string, number>; newWidthMm: number }
  | { ok: false; reason: WidthRefusal };

/**
 * True when what the user typed is what the field showed (in DISPLAY units) for `widthMm`. Decide
 * "unchanged" here, before converting to mm: `toDisplay` rounds (0.1 in, 0.01 m), so a round-trip of an
 * untouched value can differ from the exact mm and would otherwise apply a drift and lock the panel.
 */
export function isUnchangedDisplayValue(
  typed: number,
  widthMm: number,
  toDisplay: (mm: number) => number,
): boolean {
  return typed === toDisplay(widthMm);
}

const refuse = (reason: WidthRefusal): { ok: false; reason: WidthRefusal } => ({ ok: false, reason });

/**
 * Spread `deltaMm` (positive = absorbers grow) over `absorbers`, proportional to their widths, whole mm,
 * last absorber takes the remainder. Null when an absorber would end under the minimum AND narrower than
 * it is now (or there is nothing to absorb with).
 */
export function absorbDelta(absorbers: WidthPanel[], deltaMm: number): number[] | null {
  if (absorbers.length === 0) return null;
  const old = absorbers.map((p) => p.widthMm);
  const oldSum = old.reduce((s, v) => s + v, 0);
  const newSum = oldSum + deltaMm;
  if (oldSum <= 0) return null;
  const next = old.map((v) => Math.round((v * newSum) / oldSum));
  next[next.length - 1] += newSum - next.reduce((s, v) => s + v, 0);
  for (let i = 0; i < next.length; i++) {
    if (next[i] < MIN_PANEL_MM && next[i] < old[i]) return null;
  }
  return next;
}

function changedOnly(
  pairs: { id: string; from: number; to: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pairs) if (p.to !== p.from) out[p.id] = p.to;
  return out;
}

function absorbed(
  absorbers: WidthPanel[],
  next: number[],
): { id: string; from: number; to: number }[] {
  return absorbers.map((p, i) => ({ id: p.id, from: p.widthMm, to: next[i] }));
}

/**
 * Typed width / standard-width button: every target gets `widthMm` and (when its width changed) becomes
 * locked; unlocked non-targets absorb the difference so the wall total is unchanged.
 */
export function planSetWidths(panels: WidthPanel[], targetIds: string[], widthMm: number): WidthPlan {
  if (!Number.isFinite(widthMm) || widthMm <= 0) return refuse("INVALID");
  const width = Math.round(widthMm);
  const targets = panels.filter((p) => targetIds.includes(p.id));
  if (targets.length === 0) return refuse("INVALID");
  if (targets.some((p) => p.locked)) return refuse("TARGET_LOCKED");
  if (width < MIN_PANEL_MM) return refuse("TOO_NARROW");
  const changed = targets.filter((p) => p.widthMm !== width);
  if (changed.length === 0) return { ok: true, widths: {}, lockIds: [] };
  const delta = targets.reduce((s, p) => s + (width - p.widthMm), 0);
  const widths: Record<string, number> = {};
  for (const t of changed) widths[t.id] = width;
  if (delta !== 0) {
    const absorbers = panels.filter((p) => !targetIds.includes(p.id) && !p.locked);
    if (absorbers.length === 0) return refuse("NO_ABSORBER");
    const next = absorbDelta(absorbers, -delta);
    if (!next) return refuse("TOO_WIDE");
    Object.assign(widths, changedOnly(absorbed(absorbers, next)));
  }
  return { ok: true, widths, lockIds: changed.map((p) => p.id) };
}

/** Wall total width: only unlocked panels grow or shrink (proportionally). Locks are untouched. */
export function planWallWidth(panels: WidthPanel[], totalMm: number): WidthPlan {
  if (!Number.isFinite(totalMm) || totalMm <= 0) return refuse("INVALID");
  const total = Math.round(totalMm);
  if (total < MIN_PANEL_MM) return refuse("TOO_NARROW");
  if (total > MAX_DESIGN_MM) return refuse("TOO_WIDE");
  const delta = total - panels.reduce((s, p) => s + p.widthMm, 0);
  if (delta === 0) return { ok: true, widths: {}, lockIds: [] };
  const absorbers = panels.filter((p) => !p.locked);
  if (absorbers.length === 0) return refuse("NO_ABSORBER");
  const next = absorbDelta(absorbers, delta);
  if (!next) return refuse("TOO_NARROW");
  return { ok: true, widths: changedOnly(absorbed(absorbers, next)), lockIds: [] };
}

/**
 * Make equal widths: evens out the UNLOCKED panels in `scopeIds` (null = the whole wall). Locked panels
 * are untouched and stay locked. Fewer than two unlocked panels in scope: refused.
 */
export function planEqualize(panels: WidthPanel[], scopeIds: string[] | null): WidthPlan {
  const free = panels.filter((p) => !p.locked && (scopeIds === null || scopeIds.includes(p.id)));
  if (free.length < 2) return refuse("NO_ABSORBER");
  const total = free.reduce((s, p) => s + p.widthMm, 0);
  const base = Math.floor(total / free.length);
  const next = free.map((_, i) => (i === free.length - 1 ? total - base * (free.length - 1) : base));
  for (let i = 0; i < free.length; i++) {
    if (next[i] < MIN_PANEL_MM && next[i] < free[i].widthMm) return refuse("TOO_NARROW");
  }
  return { ok: true, widths: changedOnly(absorbed(free, next)), lockIds: [] };
}

/**
 * Add Panel: the new panel (appended) takes an even share of the UNLOCKED width, the unlocked panels
 * shrink proportionally to make room. No unlocked panel: refused.
 */
export function planAddPanel(panels: WidthPanel[]): AddPanelPlan {
  const free = panels.filter((p) => !p.locked);
  if (free.length === 0) return refuse("NO_ABSORBER");
  const total = free.reduce((s, p) => s + p.widthMm, 0);
  const newWidthMm = Math.floor(total / (free.length + 1));
  if (newWidthMm < MIN_PANEL_MM) return refuse("TOO_NARROW");
  const next = absorbDelta(free, -newWidthMm);
  if (!next) return refuse("TOO_NARROW");
  return { ok: true, widths: changedOnly(absorbed(free, next)), newWidthMm };
}

/**
 * Remove panels: the freed width goes to the UNLOCKED survivors, proportionally. No unlocked survivor:
 * refused. (The caller handles "nothing survives".)
 */
export function planRemove(panels: WidthPanel[], removeIds: string[]): WidthPlan {
  const survivors = panels.filter((p) => !removeIds.includes(p.id));
  const freed = panels.filter((p) => removeIds.includes(p.id)).reduce((s, p) => s + p.widthMm, 0);
  const absorbers = survivors.filter((p) => !p.locked);
  if (absorbers.length === 0) return refuse("NO_ABSORBER");
  const next = absorbDelta(absorbers, freed);
  if (!next) return refuse("TOO_WIDE");
  return { ok: true, widths: changedOnly(absorbed(absorbers, next)), lockIds: [] };
}

// ─── Convert options (Stage 34 S34-4, D-22) ─────────────────────────────────

/** Most panels a convert may seed. */
export const MAX_CONVERT_PANELS = 20;
/** Panels seeded when a convert carries no options (back-compat). */
export const DEFAULT_CONVERT_PANELS = 3;

export type ConvertOptions = { ok: true; count: number; doorOnly: boolean } | { ok: false; error: string };

/**
 * Validate the optional `panelCount` / `doorOnly` of a NEW convert element (raw, unchecked values) and
 * resolve how many sections to seed. Neither sent -> 3 sections and no width check (legacy body unchanged);
 * either sent -> every panel must be >= MIN_PANEL_MM (D-22). `doorOnly` seeds exactly one section.
 */
export function resolveConvertOptions(input: { panelCount?: unknown; doorOnly?: unknown; widthMm: number }): ConvertOptions {
  const { panelCount, doorOnly, widthMm } = input;
  const hasCount = panelCount !== undefined;
  const hasDoorOnly = doorOnly !== undefined;
  if (hasDoorOnly && typeof doorOnly !== "boolean") return { ok: false, error: "doorOnly must be a boolean." };
  if (hasCount && (typeof panelCount !== "number" || !Number.isInteger(panelCount) || panelCount < 1 || panelCount > MAX_CONVERT_PANELS)) {
    return { ok: false, error: `panelCount must be an integer between 1 and ${MAX_CONVERT_PANELS}.` };
  }
  const door = doorOnly === true;
  if (door && hasCount && panelCount !== 1) return { ok: false, error: "doorOnly cannot be combined with a panelCount other than 1." };
  if (!hasCount && !hasDoorOnly) return { ok: true, count: DEFAULT_CONVERT_PANELS, doorOnly: false };
  const count = door ? 1 : hasCount ? (panelCount as number) : DEFAULT_CONVERT_PANELS;
  if (Math.floor(widthMm / count) < MIN_PANEL_MM) {
    return { ok: false, error: `Each panel must be at least ${MIN_PANEL_MM} mm wide.` };
  }
  return { ok: true, count, doorOnly: door };
}
