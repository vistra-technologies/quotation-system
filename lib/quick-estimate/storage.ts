import { isSupportedCurrency, type SupportedCurrency } from "@/lib/currency";
import { isAreaUnit } from "./area-units";
import { validateValueLine, parseQty, parseUnitPrice, MAX_LINE_DESCRIPTION, SUGGESTED_UNITS, UNIT_AREA, UNIT_SQFT, type EstimateUnit, type SuggestedUnit } from "./estimate";
import type { EstimateType } from "./palette";
import { emptyDraft, type DraftLine, type EstimateDraft } from "./lines";

/**
 * sessionStorage mirror (S33-8): key `qe:v1:<orgSlug>`. Stored inputs are strings; flags and the draft dot
 * are derived, not stored. Restore never throws: unparsable data is an empty draft, and a line whose type
 * is no longer usable (or that fails validation) is dropped. A line whose variant is no longer offered is
 * kept: it carries its own variant text.
 */
export const storageKey = (orgSlug: string) => `qe:v1:${orgSlug}`;

/**
 * The saved draft is only read and written once the setup guard has really passed (enabled, with usable
 * types). A failed or empty component-types read (a transient 500, or an admin mid-edit) yields no types;
 * restoring against that would drop every line and the persist step would then erase them from storage.
 */
export const draftStorageActive = (enabled: boolean, types: readonly unknown[]): boolean => enabled && types.length > 0;

interface StoredLine {
  typeCode: string;
  itemName: string;
  variantText: string;
  qty: string;
  rate: string;
  /** Stage 36 (F-4): absent in a draft saved before Stage 36, which loads with the defaults. */
  suggestedUnitPrice?: number | null;
  suggestedUnit?: SuggestedUnit | null;
  combinationKey?: string | null;
  description?: string;
  descriptionEdited?: boolean;
  attachDescription?: boolean;
}

interface StoredDraft {
  currency: string;
  /** Stage 36 S36-13: absent in a draft saved before Batch 5, which loads as m². */
  areaUnit?: string;
  discountMode: string;
  discountValue: string;
  taxPct: string;
  lines: StoredLine[];
}

export function serializeDraft(d: EstimateDraft): string {
  const lines: StoredLine[] = [];
  for (const l of d.lines) {
    if (l.typeCode === null) continue;
    lines.push({
      typeCode: l.typeCode,
      itemName: l.itemName,
      variantText: l.variantText,
      qty: l.qty,
      rate: l.rate,
      suggestedUnitPrice: l.suggestedUnitPrice,
      suggestedUnit: l.suggestedUnit,
      combinationKey: l.combinationKey,
      description: l.description,
      descriptionEdited: l.descriptionEdited,
      attachDescription: l.attachDescription,
    });
  }
  const stored: StoredDraft = {
    currency: d.currency,
    areaUnit: d.areaUnit,
    discountMode: d.discountMode,
    discountValue: d.discountValue,
    taxPct: d.taxPct,
    lines,
  };
  return JSON.stringify(stored);
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseStoredDraft(
  raw: string | null,
  types: EstimateType[],
  defaultCurrency: SupportedCurrency,
  nextId: () => string,
): EstimateDraft {
  const empty = emptyDraft(defaultCurrency);
  if (!raw) return empty;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return empty;
  const s = o as Record<string, unknown>;

  const lines: DraftLine[] = [];
  const areaUnit = s.areaUnit === UNIT_SQFT ? UNIT_SQFT : UNIT_AREA;
  if (Array.isArray(s.lines)) {
    for (const item of s.lines) {
      if (typeof item !== "object" || item === null) continue;
      const l = item as Record<string, unknown>;
      const type = types.find((t) => t.code === l.typeCode);
      if (!type) continue;
      const qty = str(l.qty);
      const rate = str(l.rate);
      // An area type's line always shows the draft's area unit (the stored qty is in that unit).
      const unit: EstimateUnit = isAreaUnit(type.unit) ? areaUnit : type.unit;
      const check = validateValueLine({
        itemName: l.itemName,
        variantText: l.variantText,
        unit,
        qty: parseQty(qty, unit),
        unitPrice: parseUnitPrice(rate),
      });
      if (!check.ok) continue;
      // Stage 36: each new key is read defensively; a bad or missing one takes its default, never drops the line.
      const sp = l.suggestedUnitPrice;
      const suggestedUnitPrice = typeof sp === "number" && Number.isFinite(sp) && sp >= 0 ? sp : null;
      const suggestedUnit = (SUGGESTED_UNITS as readonly unknown[]).includes(l.suggestedUnit) ? (l.suggestedUnit as SuggestedUnit) : null;
      const key = typeof l.combinationKey === "string" && l.combinationKey.length <= 1000 ? l.combinationKey : null;
      lines.push({
        id: nextId(),
        typeCode: type.code,
        itemName: check.line.itemName,
        variantText: check.line.variantText,
        unit,
        qty,
        rate,
        flag: false,
        suggestedUnitPrice,
        suggestedUnit: suggestedUnitPrice === null ? null : suggestedUnit,
        combinationKey: key,
        description: str(l.description).slice(0, MAX_LINE_DESCRIPTION),
        descriptionEdited: l.descriptionEdited === true,
        attachDescription: l.attachDescription === true,
      });
    }
  }

  return {
    currency: isSupportedCurrency(s.currency) ? s.currency : defaultCurrency,
    areaUnit,
    discountMode: s.discountMode === "amount" ? "amount" : "pct",
    discountValue: str(s.discountValue),
    taxPct: str(s.taxPct),
    lines,
  };
}
