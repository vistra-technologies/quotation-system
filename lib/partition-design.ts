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
  /** Stage 34 S34-3: the panel is frozen. Present only as `true`; `false` is stored as absent.
   * The server stores the flag and does not enforce the freeze. */
  locked?: true;
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
  /** Stage 34 S34-3: frozen panel (maps to the section's `locked`). */
  locked?: boolean;
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

/** Sane upper bound (mm) for any section width / cell height / summed wall width — keeps derived
 * `Partition.widthMm` well inside Int4 so absurd input is a 400, not a DB-range 500. */
export const MAX_DESIGN_MM = 100000;

/** True for an integer mm value in `1..MAX_DESIGN_MM` — the one definition of the cap (Stage 31 S31-9). */
export function isDesignMm(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_DESIGN_MM;
}

function positiveInt(v: unknown, label: string): number {
  if (!isDesignMm(v)) {
    fail(`${label} must be a positive integer (mm) of at most ${MAX_DESIGN_MM}`);
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
  let totalWidth = 0;
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
    totalWidth += widthMm;
    if (totalWidth > MAX_DESIGN_MM) {
      fail(`design.sections widths sum to more than ${MAX_DESIGN_MM}mm`);
    }
    const section: DesignSectionV2 = { id: rawSection.id, widthMm, cells };
    // Stage 34 S34-3: `locked: true` is kept, `false`/absent is stored as absent, anything else is a 400.
    if (rawSection.locked !== undefined && rawSection.locked !== false) {
      if (rawSection.locked !== true) fail(`design.sections[${i}].locked must be true or false`);
      section.locked = true;
    }
    return section;
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
  const lockedPart = sec.locked ? { locked: true } : {};
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
    ...lockedPart,
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
      ...lockedPart,
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
    const section = panelToSection(p);
    return p.locked ? { ...section, locked: true } : section;
  });
  return out;

  function panelToSection(p: DesignPanel): DesignSectionV2 {
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
  }
}

/**
 * Glass to give a panel whose door was just shortened below the wall height (so a glass strip
 * appears above it) when it has none (Hotfix 2026-10-01 H-7). A partition has one glass type, so it is
 * the glass the other panels use (most common if they somehow differ), else the design default, else null.
 */
export function pickTransomGlass(
  panels: { id: string; selectionId: string | null }[],
  panelId: string,
  defaultGlassId?: string | null,
): string | null {
  const counts = new Map<string, number>();
  for (const p of panels) {
    if (p.id !== panelId && p.selectionId) counts.set(p.selectionId, (counts.get(p.selectionId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return best ?? defaultGlassId ?? null;
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

/** Fresh v2 design for a door-only convert (Stage 34 S34-4): one full-width section holding one
 * full-height door cell with the project's first door Selection, hinged left. */
export function seedDoorOnlyDesign(
  widthMm: number,
  heightMm: number,
  doorSelectionId: string,
  newId: () => string,
): PartitionDesignV2 {
  return {
    schemaVersion: 2,
    sections: [
      {
        id: newId(),
        widthMm,
        cells: [{ id: newId(), heightMm, selectionId: doorSelectionId, hinging: "left" }],
      },
    ],
  };
}

// ─── Duplicate room (Stage 34 S34-5) ─────────────────────────────────────────

/**
 * Deep copy of a stored `Partition.design` for a duplicated room: every section and cell gets a fresh
 * id; everything else (widths, heights, `selectionId`, `hinging`, `locked`, `stops`, `defaults`,
 * `measurements`, `distribution`) is kept verbatim. Non-mutating and shares no object with the input
 * (`structuredClone` first; the JSONB holds JSON values only). A non-object (null) is returned as is;
 * a legacy v1 `panels` doc or a malformed section is cloned without id changes, never thrown on.
 */
export function cloneDesignWithFreshIds(design: unknown, newId: () => string): unknown {
  if (!isObject(design)) return design;
  const copy = structuredClone(design) as Record<string, unknown>;
  if (Array.isArray(copy.sections)) {
    for (const section of copy.sections) {
      if (!isObject(section)) continue;
      section.id = newId();
      if (!Array.isArray(section.cells)) continue;
      for (const cell of section.cells) {
        if (isObject(cell)) cell.id = newId();
      }
    }
  }
  return copy;
}

// ─── Default glass (Stage 34 S34-7) ──────────────────────────────────────────

/**
 * A glass cell, as opposed to a door cell: a door cell carries `hinging`. A one-cell section is glass
 * unless it has `hinging`; in a two-cell section (transom over a door) `cells[0]` is the glass strip
 * and `cells[1]` is the door.
 */
export function isGlassCell(section: DesignSectionV2, cellIndex: number): boolean {
  const cell = section.cells[cellIndex];
  if (!cell || cell.hinging) return false;
  if (section.cells.length === 1) return true;
  return section.cells.length === 2 && cellIndex === 0;
}

/**
 * Fill every unassigned glass cell with `glassId` (the project's default glass Selection). Never touches
 * a cell that already has a selection, a door cell, or anything when `glassId` is null. Non-mutating:
 * returns the input array itself when nothing changes.
 */
export function fillDefaultGlass(
  sections: DesignSectionV2[],
  glassId: string | null | undefined,
): { sections: DesignSectionV2[]; changed: boolean } {
  if (!glassId) return { sections, changed: false };
  let changed = false;
  const next = sections.map((section) => {
    // Stored JSON can be malformed (Phase A tolerates it too): never throw on a section without cells.
    if (!section || !Array.isArray(section.cells)) return section;
    let sectionChanged = false;
    const cells = section.cells.map((cell, i) => {
      if (cell.selectionId || !isGlassCell(section, i)) return cell;
      sectionChanged = true;
      return { ...cell, selectionId: glassId };
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, cells };
  });
  return changed ? { sections: next, changed } : { sections, changed: false };
}

// ─── Default glass, panel view (Stage 34 S34-7 client mirror) ─────────────────

/**
 * True when the panel owns a glass cell that is still unassigned: a glass panel, or a door panel
 * shorter than the wall (its transom). Mirrors `isGlassCell` on the stored shape; a full-height door
 * has no glass cell. Same rounding as `panelsToV2`, so both agree on where a transom exists.
 */
export function panelNeedsGlass(p: DesignPanel, wallHeightMm: number): boolean {
  if (p.selectionId) return false;
  if (!p.door) return true;
  const doorH = Math.min(Math.max(1, Math.round(p.door.outerFrame?.h ?? wallHeightMm)), wallHeightMm);
  return doorH < wallHeightMm;
}

/** Panel-view twin of `fillDefaultGlass`: fills every unassigned glass cell with `glassId`. Non-mutating;
 * returns the input array itself when nothing changes. Ignores locks (a null cell is not a "change"). */
export function fillDefaultGlassPanels(
  panels: DesignPanel[],
  wallHeightMm: number,
  glassId: string | null | undefined,
): { panels: DesignPanel[]; changed: boolean } {
  if (!glassId) return { panels, changed: false };
  let changed = false;
  const next = panels.map((p) => {
    if (!panelNeedsGlass(p, wallHeightMm)) return p;
    changed = true;
    return { ...p, selectionId: glassId };
  });
  return changed ? { panels: next, changed } : { panels, changed: false };
}
