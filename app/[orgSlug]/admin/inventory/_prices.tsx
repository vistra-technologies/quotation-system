"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { currencyOrder, freeCurrencies, PRICE_ISSUE_MESSAGE_KEY, sortPrices } from "@/lib/inventory-prices";
import type { PriceDraft, PriceIssue, StoredPrice } from "@/lib/inventory-prices";
import { formatPriceAmount, inventoryPriceBasis } from "@/lib/price-format";
import { InfoTip } from "./_parts";
import { C } from "./_styles";

/**
 * The drawer's Prices section (mockup A rev 7 `pricesView` / `pricesEdit`, Q-D31/Q-D32): one row per currency,
 * Max (the quotation default), Min and "No upper limit". Each amount is the bold number plus the muted currency
 * code; the unit is said once, in the heading ("per m²", "per pack of 3 m"). Read-only first; the owner (the
 * drawer) holds the draft and the single Save.
 */

const UP_ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const CLOSE_X = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

function AmountCurrency({ currency, value }: { currency: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="font-extrabold tabular-nums text-text-heading">{formatPriceAmount(value)}</span>{" "}
      <span className="text-[12.5px] text-text-muted">{currency}</span>
    </span>
  );
}

function Heading({ id, basis }: { id: string; basis: string }) {
  const t = useTranslations("inventory");
  return (
    <h3 id={id} className={`${C.sectionH} mb-2 flex items-baseline justify-between gap-2`}>
      <span>{t("pricesHeading")}</span>
      {basis ? <span className="text-[11.5px] font-semibold normal-case tracking-normal text-text-muted">{basis}</span> : null}
    </h3>
  );
}

function useBasis(measurementUnit: string, perUnitQuantity: string | number) {
  const t = useTranslations("inventory");
  if (!measurementUnit) return "";
  const b = inventoryPriceBasis(measurementUnit, perUnitQuantity);
  return b.pack ? t("pricesPerPack", { pack: b.label }) : t("pricesPerUnit", { unit: b.label });
}

const HD = "pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[.05em] text-text-muted";

/** Read-only view: every currency the item is priced in (default currency first), the unpriced ones named below. */
export function PricesView({
  prices,
  measurementUnit,
  perUnitQuantity,
  defaultCurrency,
  canEdit,
  onEdit,
}: {
  prices: StoredPrice[];
  measurementUnit: string;
  perUnitQuantity: string | number;
  defaultCurrency?: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("inventory");
  const hid = useId();
  const basis = useBasis(measurementUnit, perUnitQuantity);
  const rows = sortPrices(prices, defaultCurrency);
  const missing = currencyOrder(defaultCurrency).filter((c) => !rows.some((r) => r.currency === c));

  if (rows.length === 0) {
    return (
      <section aria-labelledby={hid} data-testid="prices-section">
        <Heading id={hid} basis={basis} />
        <div className="rounded-lg border border-dashed border-border-strong bg-bg-white px-4 py-5 text-center">
          <p className="text-[13px] font-bold text-text-heading">{t("pricesNone")}</p>
          {canEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="mt-2 inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-bold text-primary-dark hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-primary"
            >
              {t("addPrice")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={hid} data-testid="prices-section">
      <Heading id={hid} basis={basis} />
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left">
            <th className={HD}>
              <span className="inline-flex items-center gap-1">
                {t("priceMax")} <InfoTip text={t("tipMaxPrice")} />
              </span>
            </th>
            <th className={HD}>{t("priceMin")}</th>
            <th className={`${HD} text-right`}>{t("noUpperLimit")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.currency} className="border-t border-border" data-testid="price-row">
              <td className="whitespace-nowrap py-2.5">
                <AmountCurrency currency={r.currency} value={r.price} />
              </td>
              <td className="whitespace-nowrap py-2.5">
                <AmountCurrency currency={r.currency} value={r.minPrice} />
              </td>
              <td className="py-2.5 text-right text-text-body">
                {r.allowAbove ? (
                  <span className="inline-flex items-center gap-1 font-bold text-primary-dark">
                    {UP_ARROW}
                    {t("yes")}
                  </span>
                ) : (
                  <span className="text-text-muted">{t("no")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {missing.length > 0 ? (
        <p className="mt-2 border-t border-border pt-2.5 text-xs text-text-muted">{t("pricesMissing", { currencies: missing.join(", ") })}</p>
      ) : null}
    </section>
  );
}

function Switch({ on, label, disabled, onToggle }: { on: boolean; label: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${on ? "bg-primary" : "bg-border"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-card transition-all ${on ? "left-[19px]" : "left-[3px]"}`} />
    </button>
  );
}

const NUM_IN =
  "h-[34px] w-full rounded-sm border px-2 text-right text-[13px] font-bold tabular-nums text-text-heading outline-none placeholder:font-normal placeholder:text-text-muted focus:border-primary focus:shadow-[0_0_0_2px_rgba(78,127,88,.15)]";

/** Edit rows: Currency, Max, Min, No limit switch, remove; "Add price" while a currency is still free. */
export function PricesEdit({
  rows,
  issues,
  showErrors,
  measurementUnit,
  perUnitQuantity,
  defaultCurrency,
  saving,
  onChange,
}: {
  rows: PriceDraft[];
  issues: Array<PriceIssue | null>;
  /** Show the per-row messages (after the first save attempt). */
  showErrors: boolean;
  measurementUnit: string;
  perUnitQuantity: string | number;
  defaultCurrency?: string;
  saving: boolean;
  onChange: (rows: PriceDraft[]) => void;
}) {
  const t = useTranslations("inventory");
  const hid = useId();
  const basis = useBasis(measurementUnit, perUnitQuantity);
  const free = freeCurrencies(rows, defaultCurrency);
  const patchRow = (i: number, p: Partial<PriceDraft>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  const msg = (issue: PriceIssue | null) => (issue ? t(PRICE_ISSUE_MESSAGE_KEY[issue]) : null);

  return (
    <section aria-labelledby={hid} data-testid="prices-section">
      <Heading id={hid} basis={basis} />
      {rows.length > 0 ? (
        <div className="grid grid-cols-[92px_1fr_1fr_76px_28px] gap-2 pb-1 text-[10.5px] font-extrabold uppercase tracking-[.05em] text-text-muted">
          <span>{t("priceCurrency")}</span>
          <span className="flex items-center justify-end gap-1">
            {t("priceMax")} <InfoTip text={t("tipMaxPrice")} />
          </span>
          <span className="text-right">{t("priceMin")}</span>
          <span className="flex items-center justify-center gap-1 whitespace-nowrap">
            {t("priceNoLimit")} <InfoTip text={t("tipNoLimit")} />
          </span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => {
        const issue = showErrors ? issues[i] : null;
        const maxBad = issue === "maxInvalid";
        const minBad = issue === "minInvalid" || issue === "minAboveMax";
        return (
          <div key={i} data-testid="price-edit-row">
            <div className={`grid grid-cols-[92px_1fr_1fr_76px_28px] items-center gap-2 py-2 ${i ? "border-t border-border" : ""}`}>
              {r.fresh ? (
                <div className="w-[92px]">
                  <SelectField
                    value={r.currency}
                    disabled={saving}
                    onChange={(e) => patchRow(i, { currency: e.target.value })}
                    className={`${C.input} ${C.inOk} px-2 text-left text-[13px] font-bold`}
                    aria-label={t("priceCurrency")}
                  >
                    {[r.currency, ...free].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </SelectField>
                </div>
              ) : (
                <span className="inline-flex w-[92px] items-center whitespace-nowrap text-[13px] font-bold text-text-heading">{r.currency}</span>
              )}
              <input
                value={r.price}
                inputMode="decimal"
                placeholder="0"
                disabled={saving}
                aria-label={t("priceMaxLabel", { currency: r.currency })}
                onChange={(e) => patchRow(i, { price: e.target.value })}
                className={`${NUM_IN} ${maxBad ? C.inErr : C.inOk}`}
              />
              <input
                value={r.minPrice}
                inputMode="decimal"
                placeholder="0"
                disabled={saving}
                aria-label={t("priceMinLabel", { currency: r.currency })}
                onChange={(e) => patchRow(i, { minPrice: e.target.value })}
                className={`${NUM_IN} ${minBad ? C.inErr : C.inOk}`}
              />
              <div className="flex justify-center">
                <Switch
                  on={r.allowAbove}
                  disabled={saving}
                  label={t("priceNoUpperLimitFor", { currency: r.currency })}
                  onToggle={() => patchRow(i, { allowAbove: !r.allowAbove })}
                />
              </div>
              <button
                type="button"
                disabled={saving}
                aria-label={t("removePrice", { currency: r.currency })}
                onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-danger-bg hover:text-red-700 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {CLOSE_X}
              </button>
            </div>
            {msg(issue) ? <p className="-mt-1 mb-1 pl-[100px] text-xs font-bold text-[var(--color-status-failed-text)]">{msg(issue)}</p> : null}
          </div>
        );
      })}
      {free.length > 0 ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => onChange([...rows, { currency: free[0], price: "", minPrice: "", allowAbove: false, fresh: true }])}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-sm border border-dashed border-border-strong text-xs font-bold text-primary-dark hover:bg-primary-softer focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        >
          {t("addPrice")}
        </button>
      ) : null}
    </section>
  );
}
