/**
 * `Partition.design` — v1 (`panels[]`) / v2 (`sections[].cells[]`) types, parsing, and serialization.
 *
 * PURE module: no prisma, no server-only imports — used by the DAL, the PATCH route, the Design page's
 * client code, and (Stage 22 B2) the migration script. THIS FILE IS THE ONLY PLACE that branches on
 * `panels` vs `sections` (Stage 22 Batch 1 reviewer check).
 *
 * Shape spec: design-docs/04-data-model.md § `Partition.design` JSONB shape.
 *
 * Two representations live here:
 *   - the STORED shape (v2 `sections`, or legacy v1 `panels` until Batch 2's migration runs), and
 *   - the PANEL VIEW — the Design page reducer's internal shape (one panel per section, a door panel
 *     carrying its door). The panel view is deliberately unchanged from Stage 21 (Stage 22 decision D-6:
 *     convert once at the client fetch boundaries, don't rewrite the consumers).
 *
 * Door/transom mapping (Stage 22 decision D-4): a panel maps to ONE or TWO cells.
 *   - glass panel               -> [glass cell]
 *   - door panel, door.h == wall -> [door cell]
 *   - door panel, door.h <  wall -> [transom glass cell (wall - door.h), door cell (door.h)]  (top -> bottom)
 * The transom's glass pointer lives on the panel view's own `selectionId`. On save (panelsToV2), the
 * fallback order is: the panel's own selectionId -> design.defaults.glassSelectionId -> null (human
 * decision, Stage 22 B2 review-3 #5 — NOT "v1 always had null there": pre-B1 TOGGLE_DOOR preserved the
 * glass id on the panel, so real v1 rows can carry a non-null value here).
 */

// ─── Stored v2 shape ─────────────────────────────────────────────────────────

export type Hinging = "left" | "right";

export interface DesignCellV2 {
  id: string;
  heightMm: number;
  selectionId: string | null;
  hinging?: Hinging;
}

export interface DesignSectionV2 {
  id: string;
  widthMm: number;
  cells: DesignCellV2[];
}

export interface DesignStops {
  top?: string | null;
  bottom?: string | null;
  left?: string | null;
  right?: string | null;
}

export interface DesignDefaults {
  glassSelectionId?: string | null;
}

/** A full v2 document as stored. */
export interface PartitionDesignV2 {
  schemaVersion: 2;
  defaults?: DesignDefaults;
  measurements?: unknown;
  distribution?: unknown;
  stops?: DesignStops;
  sections: DesignSectionV2[];
}

/** The validated body of a PATCH's `design` key — partial-replace; only `sections` is v2-specific. */
export interface PartitionDesignPatch {
  schemaVersion?: 2;
  defaults?: DesignDefaults;
  measurements?: unknown;
  distribution?: unknown;
  stops?: DesignStops;
  sections?: DesignSectionV2[];
}

// ─── Panel view (the Design page reducer's shape) ────────────────────────────

/** A door placed on a panel. `hinging` defaults to "left" (no picker in the UI yet). */
export interface DesignDoor {
  selectionId: string;
  hinging: Hinging;
  outerFrame?: { w: number; h: number };
}

/** One pane in the panel view. No `index` — array position is authoritative. */
export interface DesignPanel {
  id: string;
  type: "glass" | "door";
  widthMm: number;
  heightMm: number;
  /** Glass pointer. For a door panel this is the TRANSOM's glass (null when there is no transom). */
  selectionId: string | null;
  door?: DesignDoor | null;
}

export interface PanelViewDesign {
  defaults?: DesignDefaults;
  measurements?: unknown;
  distribution?: unknown;
  stops?: DesignStops;
  /** Undefined only for a stored doc that carried no geometry at all (see parseStoredDesign). */
  panels?: DesignPanel[];
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Thrown for any malformed design document or invariant violation. The DAL maps it to
 * `InvalidDesignError` (-> 400); stored-doc parse failures surface it as-is (never guess). */
export class PartitionDesignError extends Error {}

function fail(message: string): never {
  throw new PartitionDesignError(message);
}

// ─── Shape validation (untrusted input / stored docs) ────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positiveInt(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    fail(`${label} must be a positive integer (mm)`);
  }
  return v;
}

function parseStops(raw: unknown): DesignStops {
  if (!isObject(raw)) fail("design.stops must be an object");
  const stops: DesignStops = {};
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const value = raw[side];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") {
      fail(`design.stops.${side} must be a string or null`);
    }
    stops[side] = value;
  }
  return stops;
}

function parseDefaults(raw: unknown): DesignDefaults {
  if (!isObject(raw)) fail("design.defaults must be an object");
  const v = raw.glassSelectionId;
  if (v !== undefined && v !== null && typeof v !== "string") {
    fail("design.defaults.glassSelectionId must be a string or null");
  }
  return v === undefined ? {} : { glassSelectionId: v };
}

/** Structural validation of `sections` (types, ids, positive integer dims). Does NOT check the
 * width/height sums — see assertSectionInvariants. */
function parseSections(raw: unknown): DesignSectionV2[] {
  if (!Array.isArray(raw)) fail("design.sections must be an array");
  const seen = new Set<string>();
  const claim = (id: string, label: string) => {
    if (seen.has(id)) fail(`${label} id "${id}" is not unique within the design`);
    seen.add(id);
  };
  return raw.map((rawSection, i) => {
    if (!isObject(rawSection)) fail(`design.sections[${i}] must be an object`);
    if (typeof rawSection.id !== "string" || !rawSection.id) {
      fail(`design.sections[${i}].id is required`);
    }
    claim(rawSection.id, `design.sections[${i}]`);
    const widthMm = positiveInt(rawSection.widthMm, `design.sections[${i}].widthMm`);
    if (!Array.isArray(rawSection.cells) || rawSection.cells.length === 0) {
      fail(`design.sections[${i}].cells must be a non-empty array`);
    }
    const cells = rawSection.cells.map((rawCell: unknown, j: number): DesignCellV2 => {
      const label = `design.sections[${i}].cells[${j}]`;
      if (!isObject(rawCell)) fail(`${label} must be an object`);
      if (typeof rawCell.id !== "string" || !rawCell.id) fail(`${label}.id is required`);
      claim(rawCell.id, label);
      const heightMm = positiveInt(rawCell.heightMm, `${label}.heightMm`);
      const sel = rawCell.selectionId;
      if (sel !== null && sel !== undefined && typeof sel !== "string") {
        fail(`${label}.selectionId must be a string or null`);
      }
      const cell: DesignCellV2 = { id: rawCell.id, heightMm, selectionId: sel ?? null };
      if (rawCell.hinging !== undefined) {
        if (rawCell.hinging !== "left" && rawCell.hinging !== "right") {
          fail(`${label}.hinging must be "left" or "right"`);
        }
        cell.hinging = rawCell.hinging;
      }
      return cell;
    });
    return { id: rawSection.id, widthMm, cells };
  });
}

/**
 * Validate a PATCH body's `design` value. Partial-replace semantics (same as before v2): only keys
 * present are validated and returned. A legacy `panels` body is rejected outright (Stage 22 D-8) —
 * v1 is read-only history now.
 */
export function parseDesignPatch(raw: unknown): PartitionDesignPatch | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) fail("design must be an object");
  if (raw.panels !== undefined) {
    fail("design.panels is no longer accepted — send design.sections with schemaVersion 2");
  }
  const design: PartitionDesignPatch = {};
  if (raw.schemaVersion !== undefined) {
    if (raw.schemaVersion !== 2) fail("design.schemaVersion, if provided, must be 2");
    design.schemaVersion = 2;
    // A version stamp with no geometry would be stored as an unreadable doc (parseStoredDesign throws).
    if (raw.sections === undefined) fail("design.schemaVersion: 2 requires design.sections");
  }
  if (raw.measurements !== undefined) design.measurements = raw.measurements;
  if (raw.distribution !== undefined) design.distribution = raw.distribution;
  if (raw.stops !== undefined) design.stops = parseStops(raw.stops);
  if (raw.defaults !== undefined) design.defaults = parseDefaults(raw.defaults);
  if (raw.sections !== undefined) {
    if (raw.schemaVersion !== 2) fail("design.sections requires design.schemaVersion: 2");
    design.sections = parseSections(raw.sections);
  }
  return design;
}

// ─── Invariants ──────────────────────────────────────────────────────────────

/** `sum(sections[].widthMm)` — the value the server derives `Partition.widthMm` from. */
export function sumSectionWidths(sections: DesignSectionV2[]): number {
  return sections.reduce((s, sec) => s + sec.widthMm, 0);
}

/** Per section, `sum(cells[].heightMm) === heightMm` — the v2 replacement for v1's silent height
 * normalization. Throws PartitionDesignError naming the first offending section. */
export function assertSectionHeights(sections: DesignSectionV2[], heightMm: number): void {
  sections.forEach((sec, i) => {
    const sum = sec.cells.reduce((s, c) => s + c.heightMm, 0);
    if (sum !== heightMm) {
      fail(
        `design.sections[${i}] cell heights sum to ${sum}mm but the partition height is ${heightMm}mm`,
      );
    }
  });
}

/** Every `selectionId` a v2 doc points at (cells + stops) — for the cross-tenant existence check.
 * `defaults.glassSelectionId` is editor-only convenience and deliberately excluded (spec). */
export function collectSelectionIds(design: {
  stops?: DesignStops;
  sections?: DesignSectionV2[];
}): Set<string> {
  const ids = new Set<string>();
  for (const sec of design.sections ?? []) {
    for (const cell of sec.cells) if (cell.selectionId) ids.add(cell.selectionId);
  }
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const id = design.stops?.[side];
    if (id) ids.add(id);
  }
  return ids;
}

// ─── Stored -> panel view ────────────────────────────────────────────────────

export interface ParseStoredOptions {
  /** The partition row's own dimensions — used to validate a v2 doc's sums. */
  widthMm: number;
  heightMm: number;
  /** Resolves whether a selection is a DOOR (cells carry no `kind`; the Design page has the
   * project's Selections as props). Only consulted for one-cell sections. */
  isDoorSelection: (selectionId: string) => boolean;
}

/**
 * Normalize a stored `design` (v1 or v2) into the panel view. Never writes anywhere.
 *   - `panels` array, no `schemaVersion`        => v1 (mapped 1:1)
 *   - `sections` array + `schemaVersion === 2`  => v2 (invariants validated, then converted)
 *   - a doc with none of those keys (e.g. only `stops`) carries no geometry => view with no `panels`
 *   - anything else                             => throws (never guess)
 */
export function parseStoredDesign(raw: unknown, opts: ParseStoredOptions): PanelViewDesign {
  if (!isObject(raw)) fail("stored design is not an object");
  const hasPanels = raw.panels !== undefined;
  const hasSections = raw.sections !== undefined;
  const hasVersion = raw.schemaVersion !== undefined;

  const carried: PanelViewDesign = {};
  if (raw.defaults !== undefined) carried.defaults = raw.defaults as DesignDefaults;
  if (raw.measurements !== undefined) carried.measurements = raw.measurements;
  if (raw.distribution !== undefined) carried.distribution = raw.distribution;
  if (raw.stops !== undefined) carried.stops = raw.stops as DesignStops;

  if (hasPanels && !hasSections && !hasVersion) {
    if (!Array.isArray(raw.panels)) fail("stored design.panels is not an array");
    return { ...carried, panels: raw.panels as DesignPanel[] };
  }

  if (hasSections && !hasPanels && raw.schemaVersion === 2) {
    const sections = parseSections(raw.sections);
    assertSectionHeights(sections, opts.heightMm);
    const width = sumSectionWidths(sections);
    if (width !== opts.widthMm) {
      fail(`design.sections widths sum to ${width}mm but the partition width is ${opts.widthMm}mm`);
    }
    return { ...carried, panels: sections.map((sec) => sectionToPanel(sec, opts)) };
  }

  if (!hasPanels && !hasSections && !hasVersion) return carried;

  return fail("stored design is neither a v1 (panels) nor a v2 (sections, schemaVersion 2) document");
}

function sectionToPanel(sec: DesignSectionV2, opts: ParseStoredOptions): DesignPanel {
  const wallHeightMm = opts.heightMm;
  const doorOf = (cell: DesignCellV2, transomSelectionId: string | null): DesignPanel => ({
    id: sec.id,
    type: "door",
    widthMm: sec.widthMm,
    heightMm: wallHeightMm,
    selectionId: transomSelectionId,
    door: {
      selectionId: cell.selectionId ?? "",
      hinging: cell.hinging ?? "left",
      outerFrame: { w: sec.widthMm, h: cell.heightMm },
    },
  });

  if (sec.cells.length === 1) {
    const cell = sec.cells[0];
    if (cell.selectionId && opts.isDoorSelection(cell.selectionId)) return doorOf(cell, null);
    return {
      id: sec.id,
      type: "glass",
      widthMm: sec.widthMm,
      heightMm: wallHeightMm,
      selectionId: cell.selectionId,
      door: null,
    };
  }
  if (sec.cells.length === 2) {
    // [transom, door] by convention (top -> bottom) — matches the v1 -> v2 migration rule.
    const bottom = sec.cells[1].selectionId;
    if (bottom && !opts.isDoorSelection(bottom)) {
      fail(`design section "${sec.id}": bottom cell is not a door selection; cannot map to a door panel`);
    }
    return doorOf(sec.cells[1], sec.cells[0].selectionId);
  }
  return fail(`design section "${sec.id}" has ${sec.cells.length} cells; the editor supports 1 or 2`);
}

// ─── Panel view -> stored v2 ─────────────────────────────────────────────────

/** Serialize the panel view to a v2 PATCH body. `panels === undefined` (a geometry-less doc) yields
 * a body with no `sections`, so the server leaves the stored geometry and width untouched. */
export function panelsToV2(
  view: PanelViewDesign,
  wallHeightMm: number,
): PartitionDesignPatch {
  const out: PartitionDesignPatch = {};
  if (view.defaults !== undefined) out.defaults = view.defaults;
  if (view.measurements !== undefined) out.measurements = view.measurements;
  if (view.distribution !== undefined) out.distribution = view.distribution;
  if (view.stops !== undefined) out.stops = view.stops;
  if (view.panels === undefined) return out;

  out.schemaVersion = 2;
  out.sections = view.panels.map((p): DesignSectionV2 => {
    if (!p.door) {
      return {
        id: p.id,
        widthMm: p.widthMm,
        cells: [{ id: `${p.id}-c`, heightMm: wallHeightMm, selectionId: p.selectionId }],
      };
    }
    const requested = Math.round(p.door.outerFrame?.h ?? wallHeightMm);
    const doorH = Math.min(Math.max(1, requested), wallHeightMm);
    const doorCell = (id: string, h: number): DesignCellV2 => ({
      id,
      heightMm: h,
      selectionId: p.door!.selectionId || null,
      hinging: p.door!.hinging,
    });
    if (doorH === wallHeightMm) {
      return { id: p.id, widthMm: p.widthMm, cells: [doorCell(`${p.id}-c`, wallHeightMm)] };
    }
    return {
      id: p.id,
      widthMm: p.widthMm,
      cells: [
        {
          id: `${p.id}-t`,
          heightMm: wallHeightMm - doorH,
          selectionId: p.selectionId ?? view.defaults?.glassSelectionId ?? null,
        },
        doorCell(`${p.id}-d`, doorH),
      ],
    };
  });
  return out;
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/** Fresh v2 design for a just-converted partition: `count` equal-width, single-cell glass sections
 * (last absorbs the width remainder), each full wall height, glass unassigned. */
export function seedSectionsDesign(
  widthMm: number,
  heightMm: number,
  count: number,
  newId: () => string,
): PartitionDesignV2 {
  const base = Math.floor(widthMm / count);
  return {
    schemaVersion: 2,
    sections: Array.from({ length: count }, (_, i) => ({
      id: newId(),
      widthMm: i === count - 1 ? widthMm - base * (count - 1) : base,
      cells: [{ id: newId(), heightMm, selectionId: null }],
    })),
  };
}
