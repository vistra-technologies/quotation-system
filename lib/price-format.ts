/**
 * Stage 38 Batch 2 (Q-D22): the ONE place a price is turned into text, shared by Inventory and Product Pricing.
 * Pure, client-safe, no float math on money (the amount is read as integer cents).
 *
 * Content rule: `<price> <currency>/<unit>` ("2,800 INR/m²"). Presentation (Q-D28/Q-D30/Q-D31) is decided by the
 * components: they render `formatPriceAmount` and the muted suffix as separate elements.
 */
import { parseMoneyToCents } from "@/lib/money";
import { packLabel, unitSymbol } from "@/lib/units";

/** "2,800", "2,650.5", "40": thousands separators, up to 2 decimals, trailing zeros dropped. */
export function formatPriceAmount(value: string | number): string {
  const cents = typeof value === "number" ? Math.round(value * 100) : parseMoneyToCents(value);
  if (cents === null || !Number.isFinite(cents)) return String(value);
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  const fracText = frac === 0 ? "" : `.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
  return `${whole.toLocaleString("en-US")}${fracText}`;
}

/** Display label of a Product Pricing price unit (the Quick Estimate labels). */
export function priceUnitLabel(unit: string): string {
  return unit === "m2" ? "m²" : unit === "sqft" ? "sq ft" : unit;
}

/** The muted suffix: "INR/m²". */
export function priceSuffix(currency: string, unit: string): string {
  return `${currency}/${unit}`;
}

/** The full text: "2,800 INR/m²" (Q-D22). */
export function formatPriceText(amount: string | number, currency: string, unit: string): string {
  return `${formatPriceAmount(amount)} ${priceSuffix(currency, unit)}`;
}

/**
 * What an Inventory price is for, said once in the drawer heading (Q-D31): "per m²" for a pack of 1,
 * "per pack of 3 m" otherwise.
 */
export function inventoryPriceBasis(measurementUnit: string, perUnitQuantity: string | number): { pack: boolean; label: string } {
  const n = Number(perUnitQuantity);
  if (Number.isFinite(n) && n !== 1) return { pack: true, label: packLabel(measurementUnit, n) };
  return { pack: false, label: unitSymbol(measurementUnit) };
}
