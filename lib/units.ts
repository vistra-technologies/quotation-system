/**
 * The one list of measurement units shared by formula sets and inventory items.
 *
 * The formula engine hard-matches `FormulaDef.unit` against `InventoryItem.measurementUnit`
 * (lib/materials/resolve.ts → UNIT_MISMATCH), so both sides must draw from this list.
 * Adding a unit here makes it valid for formula authoring, the Inventory dropdown, and the API at once.
 *
 * Hotfix 2026-09-28 (U-1). Stage 37 (Q-D23, Q-D25): added `ft²` and `roll`; labels are "symbol (Name)".
 * No unit conversion: a formula unit must still equal the inventory unit exactly.
 */
export const MEASUREMENT_UNITS = [
  { value: "metres", label: "m (Metre)" },
  { value: "pieces", label: "pc (Pieces)" },
  { value: "m²", label: "m² (Square metre)" },
  { value: "mm", label: "mm (Millimetre)" },
  { value: "ft", label: "ft (Feet)" },
  { value: "ft²", label: "ft² (Square feet)" },
  { value: "set", label: "set (Sets)" },
  { value: "roll", label: "roll (Rolls)" },
] as const;

export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number]["value"];

const UNIT_VALUES: ReadonlySet<string> = new Set(MEASUREMENT_UNITS.map((u) => u.value));

export function isMeasurementUnit(v: unknown): v is MeasurementUnit {
  return typeof v === "string" && UNIT_VALUES.has(v);
}

export const MEASUREMENT_UNIT_LIST = MEASUREMENT_UNITS.map((u) => `"${u.value}"`).join(" or ");
