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

/** Short symbol shown next to a quantity ("m", "pc", "m²", "set"). An unknown legacy value is shown as stored. */
const UNIT_SYMBOLS: Record<MeasurementUnit, string> = {
  metres: "m",
  pieces: "pc",
  "m²": "m²",
  mm: "mm",
  ft: "ft",
  "ft²": "ft²",
  set: "set",
  roll: "roll",
};

/** Symbols that take an "s" when the quantity is above 1 (a pack of 3 sets), the rest are unit symbols. */
const PLURAL_SYMBOLS: ReadonlySet<string> = new Set(["set", "roll"]);

export function unitSymbol(value: string): string {
  return isMeasurementUnit(value) ? UNIT_SYMBOLS[value] : value;
}

/** The unit as it reads next to a pack size: singular at 1 or less, plural for sets and rolls above 1. */
export function unitForQuantity(value: string, quantity: number): string {
  const symbol = unitSymbol(value);
  return quantity > 1 && PLURAL_SYMBOLS.has(symbol) ? `${symbol}s` : symbol;
}

/** "1 m", "3 sets", "2.5 m": the Pack column and the drawer's Pack size row. */
export function packLabel(value: string, pack: number | string): string {
  const n = Number(pack);
  const shown = Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : String(pack);
  return `${shown} ${unitForQuantity(value, n)}`;
}
