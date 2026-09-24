/**
 * Summary page view helpers (Stage 26 Batch 1). Prisma-free — pure functions over the plain data shapes
 * in lib/summary/types.ts and lib/config-snapshot.ts, following that same convention. Consumed by Batch 2's
 * Summary page component (not built yet — this file only owns the derivation/formatting logic so it can be
 * unit-tested without a DB or a page).
 *
 * No `formatName` function here on purpose — stage-26.md is explicit that a material line's `name` needs
 * no helper ("no `cleanName` string-stripping... shown as stored"). Callers read `line.name` directly.
 * Don't add one without checking the doc first.
 */
import type { DoorRow, MaterialListLine, Summary } from "./types";
import type { ConfigSnapshot } from "../config-snapshot";

// ─── Door KPI rebuild (S26-3) ─────────────────────────────────────────────────

export interface DoorKpiRow {
  category: string | null;
  doorType: string | null;
  quantity: number;
}

/**
 * `SummaryKpis.doorsByType` (built at compute time, Stage 23) groups doors by `doorType` only — it has
 * no `category` field. The Summary page's Doors KPI table needs both dimensions, so this walks the raw
 * per-wall `summary.floors[].rooms[].walls[].doors[]` rows at READ time and re-groups by
 * `(category, doorType)` instead (S26-3) — no change to the stored/computed shape, purely a view-layer
 * rebuild.
 *
 * Null-safe grouping key: `category`/`doorType` may each independently be null (an unset field on the
 * door's Selection config) — both are treated as a distinct group value, not coalesced together.
 */
export function rebuildDoorKpis(summary: Summary): DoorKpiRow[] {
  const groups = new Map<string, DoorKpiRow>();

  for (const floor of summary.floors) {
    for (const room of floor.rooms) {
      for (const wall of room.walls) {
        for (const door of wall.doors as DoorRow[]) {
          const key = `${door.category ?? "\u0000"}\u0001${door.doorType ?? "\u0000"}`;
          const existing = groups.get(key);
          if (existing) {
            existing.quantity += door.quantity;
          } else {
            groups.set(key, {
              category: door.category,
              doorType: door.doorType,
              quantity: door.quantity,
            });
          }
        }
      }
    }
  }

  return Array.from(groups.values());
}

// ─── Material list sectioning ─────────────────────────────────────────────────

export const SHARED_MATERIALS_TITLE = "Shared materials";

export interface MaterialSection {
  title: string;
  /** The ComponentType.code this section groups, or "shared" for array-slot lines. */
  code: string | "shared";
  lines: MaterialListLine[];
}

/**
 * Group `materialList` into per-slot sections for the Material List table, titled from the org's frozen
 * `configSnapshot` (falling back to the raw slot code if the snapshot has no matching ComponentType —
 * e.g. a since-deleted/renamed type). Section order follows `snapshot.componentTypes` array order; any
 * slot codes present in `materialList` but absent from the snapshot are appended afterward, titled with
 * the raw code, in first-seen `materialList` order (stage-26.md doesn't specify ordering for that edge
 * case beyond "titled with the raw code" — first-seen order is the least surprising default, called out
 * here rather than silently decided per the Batch 1 plan).
 *
 * A line whose `slot` is `string[]` (two slots merged into one resolved code, per MaterialListLine's own
 * doc comment) always goes into a single "Shared materials" section instead — never duplicated into any
 * per-slot section. Lines keep `materialList`'s incoming order within each section (already sorted
 * (code, unit) upstream, per stage-26.md).
 */
export function buildMaterialSections(
  materialList: MaterialListLine[],
  snapshot: ConfigSnapshot,
): MaterialSection[] {
  const sectionsByCode = new Map<string, MaterialSection>();
  const sharedSection: MaterialSection = {
    title: SHARED_MATERIALS_TITLE,
    code: "shared",
    lines: [],
  };
  let sharedHasLines = false;

  // Index snapshot order (not pre-seeded — a section is only created below when a materialList line
  // actually lands in it) so that whichever sections do end up with lines come out in snapshot order.
  const snapshotOrder = new Map<string, number>();
  (snapshot.componentTypes ?? []).forEach((ct, i) => snapshotOrder.set(ct.code, i));

  const firstSeenOrder: string[] = [];

  for (const line of materialList) {
    if (Array.isArray(line.slot)) {
      sharedSection.lines.push(line);
      sharedHasLines = true;
      continue;
    }

    const code = line.slot;
    let section = sectionsByCode.get(code);
    if (!section) {
      const name = snapshot.componentTypes?.find((ct) => ct.code === code)?.name ?? code;
      section = { title: name, code, lines: [] };
      sectionsByCode.set(code, section);
      firstSeenOrder.push(code);
    }
    section.lines.push(line);
  }

  const inSnapshot = firstSeenOrder
    .filter((code) => snapshotOrder.has(code))
    .sort((a, b) => snapshotOrder.get(a)! - snapshotOrder.get(b)!);
  const notInSnapshot = firstSeenOrder.filter((code) => !snapshotOrder.has(code));

  const ordered: MaterialSection[] = [...inSnapshot, ...notInSnapshot].map(
    (code) => sectionsByCode.get(code)!,
  );

  if (sharedHasLines) ordered.push(sharedSection);

  return ordered;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

const EM_DASH = "—";

/**
 * `null` -> em dash, any real value passed through unchanged. Shared by every "show as stored, or a dash
 * if unset" field (glass type, door category, door type, ...) so later batches reuse this instead of
 * re-inlining `?? "—"` or reaching for `formatGlassLabel` on a non-glass field.
 */
export function orDash(value: string | null): string {
  return value ?? EM_DASH;
}

/** `null` glassType renders as an em dash; a real value is shown as stored (no relabeling). */
export function formatGlassLabel(glassType: string | null): string {
  return orDash(glassType);
}

const NUMERIC_THICKNESS = /^\d+(\.\d+)?$/;

/**
 * `null` -> em dash. A purely numeric thickness (e.g. "12") gets " mm" appended. A thickness that
 * already carries its own unit (e.g. "12mm", from Stage 23 F-9 data) is returned as-is, unchanged.
 */
export function formatThickness(thickness: string | null): string {
  if (thickness === null) return EM_DASH;
  return NUMERIC_THICKNESS.test(thickness) ? `${thickness} mm` : thickness;
}

/** Always 2 decimal places. */
export function formatAreaM2(value: number): string {
  return value.toFixed(2);
}

/**
 * "metres" -> "m"; "pieces" -> "pc" (quantity === 1) or "pcs" (otherwise) — stage-26.md specifies
 * "pc"/"pcs" for pieces without pinning down the singular/plural rule; this defaults to ordinary English
 * pluralization as the least surprising reading (Batch 1 plan). Any other unit string passes through
 * unchanged.
 */
export function formatUnit(unit: string, quantity?: number): string {
  if (unit === "metres") return "m";
  if (unit === "pieces") return quantity === 1 ? "pc" : "pcs";
  return unit;
}
