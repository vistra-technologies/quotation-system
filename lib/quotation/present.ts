/**
 * Quotation page presentation helpers (Stage 38 Batch 4). PURE and client-safe: no Prisma, no React.
 * Money stays integer cents or a 2 dp string; nothing here does float math on money (lib/money.ts).
 */
import { centsToFixed, decimalToCents, parseMoneyToCents } from "@/lib/money";
import { unitForQuantity, unitSymbol } from "@/lib/units";
import { rebuildDoorKpis, SHARED_MATERIALS_TITLE } from "@/lib/summary/view";
import type { Summary } from "@/lib/summary/types";
import type { ConfigSnapshot } from "@/lib/config-snapshot";
import type { QuotationLineView, QuotationView } from "./view";
import type { DiscountType } from "./types";

/** The quotation as the page receives it over JSON (the view's `Date` fields are ISO strings). */
export type QuotationDto = Omit<QuotationView, "pricedAt" | "quantitiesAt" | "validUntil" | "discountAppliedAt" | "createdAt"> & {
  pricedAt: string;
  quantitiesAt: string;
  validUntil: string;
  discountAppliedAt: string | null;
  createdAt: string;
};

/** "2650" and "2650.5" and "2650.00" all become "2,650.00" (2 dp, thousands separators, no float). */
export function formatMoney(value: string): string {
  const cents = decimalToCents(value);
  if (cents === null) return value;
  const [whole, frac] = centsToFixed(cents).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/** Integer cents as "2,650.00". */
export function formatCents(cents: number): string {
  return formatMoney(centsToFixed(cents));
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "20 Nov 2026" in UTC, so the server render and the browser agree. */
export function formatDate(iso: string | Date): string {
  return DATE.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** A quantity as stored (up to 3 dp), thousands separators, trailing zeros dropped. */
export function formatQuantity(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** "pc" / "pcs" for pieces, otherwise the unit symbol (plural for sets and rolls above 1). */
export function unitText(unit: string, quantity: number): string {
  if (unit === "pieces") return quantity === 1 ? "pc" : "pcs";
  return unitForQuantity(unit, quantity);
}

/** Q-D16: a pack item reads "14 packs of 6 m" (the muted tail is the second part); others "86.42 m²". */
export function quantityParts(line: Pick<QuotationLineView, "quantity" | "perUnitQuantity" | "unit">): { main: string; muted: string } {
  if (line.perUnitQuantity > 1) {
    return {
      main: `${formatQuantity(line.quantity)} ${line.quantity === 1 ? "pack" : "packs"}`,
      muted: `of ${formatQuantity(line.perUnitQuantity)} ${unitText(line.unit, line.perUnitQuantity)}`,
    };
  }
  return { main: formatQuantity(line.quantity), muted: unitText(line.unit, line.quantity) };
}

/** The unit a unit price is for: "pack" for a pack item, else the unit symbol ("m", "pc", "m²"). */
export function priceUnit(line: Pick<QuotationLineView, "perUnitQuantity" | "unit">): string {
  return line.perUnitQuantity > 1 ? "pack" : unitSymbol(line.unit);
}

export interface LineSection<L> {
  /** The ComponentType.code of the slot, or "shared" for a line with several slots. */
  code: string;
  title: string;
  lines: L[];
}

/**
 * S38-D8: sections come from the data (`slot`), never from hard-coded codes. Titles and order follow the project's
 * frozen config snapshot; a slot the snapshot lacks is appended in first-seen order titled with its code; lines with
 * several slots go to "Shared materials", last. Same rules as `buildMaterialSections` (lib/summary/view.ts).
 */
export function sectionsOf<L extends { slot: string | string[] }>(lines: ReadonlyArray<L>, snapshot: ConfigSnapshot | null): LineSection<L>[] {
  const types = snapshot?.componentTypes ?? [];
  const order = new Map<string, number>();
  types.forEach((ct, i) => order.set(ct.code, i));
  const bySlot = new Map<string, LineSection<L>>();
  const seen: string[] = [];
  const shared: LineSection<L> = { code: "shared", title: SHARED_MATERIALS_TITLE, lines: [] };
  for (const line of lines) {
    if (Array.isArray(line.slot)) {
      shared.lines.push(line);
      continue;
    }
    let sec = bySlot.get(line.slot);
    if (!sec) {
      sec = { code: line.slot, title: types.find((ct) => ct.code === line.slot)?.name ?? line.slot, lines: [] };
      bySlot.set(line.slot, sec);
      seen.push(line.slot);
    }
    sec.lines.push(line);
  }
  const known = seen.filter((c) => order.has(c)).sort((a, b) => order.get(a)! - order.get(b)!);
  const unknown = seen.filter((c) => !order.has(c));
  const out = [...known, ...unknown].map((c) => bySlot.get(c)!);
  if (shared.lines.length > 0) out.push(shared);
  return out;
}

/** The sum of the lines' stored amounts, in cents. */
export function sectionTotalCents(lines: ReadonlyArray<Pick<QuotationLineView, "amount">>): number {
  return lines.reduce((sum, l) => sum + (parseMoneyToCents(l.amount) ?? 0), 0);
}

/** Lines whose unit price differs from the stored default (staff payloads only; an external payload has none). */
export function editedLineCount(lines: ReadonlyArray<Pick<QuotationLineView, "unitPrice" | "defaultPrice">>): number {
  return lines.filter((l) => l.defaultPrice !== undefined && l.unitPrice !== l.defaultPrice).length;
}

export interface Kpis {
  glassM2: number;
  glassTypes: number;
  doors: number;
  doorTypes: number;
}

/** Q-D1: unpriced KPI figures from the project's calculation summary. */
export function kpisOf(summary: Summary): Kpis {
  const glass = summary.kpis.sqmByGlassType;
  const doors = rebuildDoorKpis(summary);
  return {
    glassM2: glass.reduce((s, g) => s + g.areaM2, 0),
    glassTypes: glass.length,
    doors: doors.reduce((s, d) => s + d.quantity, 0),
    doorTypes: new Set(doors.map((d) => d.doorType ?? "")).size,
  };
}

/** "1,234.50" typed with separators is read as 1234.50. */
const norm = (v: string): string => v.replace(/,/g, "").trim();
const pm = (v: string): number | null => parseMoneyToCents(norm(v));

/** The typed charges as the form holds them (strings). */
export interface ChargesForm {
  transport: string;
  otherCharges: string;
  discountType: DiscountType;
  discount: string;
  taxPercent: string;
}

export function chargesFormOf(q: Pick<QuotationDto, "transport" | "otherCharges" | "discountType" | "discount" | "taxPercent">): ChargesForm {
  return { transport: q.transport, otherCharges: q.otherCharges, discountType: q.discountType, discount: q.discount, taxPercent: q.taxPercent };
}

/**
 * Q-D33 client precheck mirroring the server: a typed FIXED discount above the subtotal (lines total + the typed
 * Transport + the typed Other charges) is refused. Returns the largest allowed amount as "1,234.00" when refused,
 * else null. Unparseable fields return null here: the Save button's own validity check reports them.
 */
export function discountCapExceeded(linesTotalCents: number, form: ChargesForm): string | null {
  if (form.discountType !== "FIXED") return null;
  const transport = pm(form.transport);
  const other = pm(form.otherCharges);
  const discount = pm(form.discount);
  if (transport === null || other === null || discount === null) return null;
  const subtotal = linesTotalCents + transport + other;
  return discount > subtotal ? formatCents(subtotal) : null;
}

/** Whether every typed field parses (money to 2 dp; discount and tax percents 0 to 100). Save is disabled otherwise. */
export function chargesFormValid(form: ChargesForm): boolean {
  const money = [form.transport, form.otherCharges].every((v) => pm(v) !== null);
  const discount = pm(form.discount);
  const tax = pm(form.taxPercent);
  if (!money || discount === null || tax === null || tax > 10000) return false;
  return form.discountType === "PERCENT" ? discount <= 10000 : true;
}

/** The PATCH body for the fields that changed (the server takes any subset, at least one); null when nothing changed. */
export function chargesPatch(q: ChargesForm, next: ChargesForm): Partial<ChargesForm> | null {
  const patch: Partial<ChargesForm> = {};
  const money = pm;
  if (money(next.transport) !== money(q.transport)) patch.transport = norm(next.transport);
  if (money(next.otherCharges) !== money(q.otherCharges)) patch.otherCharges = norm(next.otherCharges);
  if (next.discountType !== q.discountType || money(next.discount) !== money(q.discount)) {
    patch.discountType = next.discountType;
    patch.discount = norm(next.discount);
  }
  if (money(next.taxPercent) !== money(q.taxPercent)) patch.taxPercent = norm(next.taxPercent);
  return Object.keys(patch).length > 0 ? patch : null;
}

/** "5" for "5.00", "18.5" for "18.50": how a percent reads in a label. */
export function percentLabel(fixed: string): string {
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
