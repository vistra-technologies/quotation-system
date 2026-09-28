/**
 * The one list of measurement units shared by formula sets and inventory items.
 *
 * The formula engine hard-matches `FormulaDef.unit` against `InventoryItem.measurementUnit`
 * (lib/materials/resolve.ts → UNIT_MISMATCH), so both sides must draw from this list.
 * Adding a unit here makes it valid for formula authoring, the Inventory dropdown, and the API at once.
 *
 * Hotfix 2026-09-28 (U-1).
 */
export const MEASUREMENT_UNITS = [
  { value: "metres", label: "m — Metre" },
  { value: "pieces", label: "piece" },
  { value: "m²", label: "m² — Square metre" },
  { value: "mm", label: "mm — Millimetre" },
  { value: "ft", label: "ft — Feet" },
  { value: "set", label: "set" },
] as const;

export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number]["value"];

const UNIT_VALUES: ReadonlySet<string> = new Set(MEASUREMENT_UNITS.map((u) => u.value));

export function isMeasurementUnit(v: unknown): v is MeasurementUnit {
  return typeof v === "string" && UNIT_VALUES.has(v);
}

export const MEASUREMENT_UNIT_LIST = MEASUREMENT_UNITS.map((u) => `"${u.value}"`).join(" or ");
