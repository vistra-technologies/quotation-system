import { isSupportedCurrency, type SupportedCurrency } from "@/lib/currency";
import { validateValueLine, parseQty, parseUnitPrice } from "./estimate";
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
}

interface StoredDraft {
  currency: string;
  discountMode: string;
  discountValue: string;
  taxPct: string;
  lines: StoredLine[];
}

export function serializeDraft(d: EstimateDraft): string {
  const lines: StoredLine[] = [];
  for (const l of d.lines) {
    if (l.typeCode === null) continue;
    lines.push({ typeCode: l.typeCode, itemName: l.itemName, variantText: l.variantText, qty: l.qty, rate: l.rate });
  }
  const stored: StoredDraft = {
    currency: d.currency,
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
  if (Array.isArray(s.lines)) {
    for (const item of s.lines) {
      if (typeof item !== "object" || item === null) continue;
      const l = item as Record<string, unknown>;
      const type = types.find((t) => t.code === l.typeCode);
      if (!type) continue;
      const qty = str(l.qty);
      const rate = str(l.rate);
      const check = validateValueLine({
        itemName: l.itemName,
        variantText: l.variantText,
        unit: type.unit,
        qty: parseQty(qty, type.unit),
        unitPrice: parseUnitPrice(rate),
      });
      if (!check.ok) continue;
      lines.push({
        id: nextId(),
        typeCode: type.code,
        itemName: check.line.itemName,
        variantText: check.line.variantText,
        unit: type.unit,
        qty,
        rate,
        flag: false,
      });
    }
  }

  return {
    currency: isSupportedCurrency(s.currency) ? s.currency : defaultCurrency,
    discountMode: s.discountMode === "amount" ? "amount" : "pct",
    discountValue: str(s.discountValue),
    taxPct: str(s.taxPct),
    lines,
  };
}
