"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { apiErrorMessage } from "@/lib/api-error-message";
import { formatPriceAmount, priceSuffix, priceUnitLabel } from "@/lib/price-format";
import { DrawerShell } from "../inventory/_drawer-shell";
import {
  hasPair,
  MAX_DESCRIPTION_LENGTH,
  MAX_PRICE_ENTRIES,
  PRICE_CURRENCIES,
  sortEntries,
  type PriceCurrency,
  type PriceEntry,
  type PriceUnit,
} from "@/lib/product-pricing/price-entries";
import type { StoredPricingRow } from "@/lib/product-pricing/grid";

/** Display label of a Product Pricing price unit (the Quick Estimate labels). Shared formatter: `lib/price-format`. */
export const unitLabel = priceUnitLabel;

export const formatAmount = formatPriceAmount;

/**
 * One price as text (Q-D22, Q-D28): the amount in bold, then a muted `<currency>/<unit>`. No pill: the amount and the
 * suffix are separate elements with a plain space between them, so the text reads "2,800 INR/m²".
 */
export function PriceText({ amount, currency, unit, className = "" }: { amount: number; currency: string; unit: string; className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap ${className}`}>
      <strong data-testid="price-amount" className="font-extrabold tabular-nums text-text-heading">
        {formatPriceAmount(amount)}
      </strong>{" "}
      <span data-testid="price-suffix" className="ml-1 text-[12.5px] text-text-muted">
        {priceSuffix(currency, priceUnitLabel(unit))}
      </span>
    </span>
  );
}

const AMOUNT_PATTERN = /^(\d+\.?\d{0,2}|\.\d{1,2})$/;

const INPUT_CLS =
  "h-[34px] rounded-md border border-border bg-bg-white px-2 text-[13px] font-bold text-text-heading focus:border-primary focus:outline-none focus:shadow-[0_0_0_3px_var(--color-primary-softer)]";
const SELECT_CLS =
  "h-[34px] rounded-md border border-border bg-bg-white px-2 text-[13px] font-bold text-text-heading focus:border-primary focus:outline-none";
const LABEL_CLS = "text-[10px] font-extrabold uppercase tracking-[.05em] text-text-muted";

interface FormState {
  /** `null` = adding; a number = the index of the entry being edited. */
  index: number | null;
  currency: PriceCurrency;
  unit: PriceUnit;
  amount: string;
}

export interface DrawerTarget {
  typeId: string;
  isArea: boolean;
  key: string;
  label: string;
  row: StoredPricingRow | null;
}

interface Props {
  orgSlug: string;
  target: DrawerTarget;
  onClose: () => void;
  /** `row` is the stored row after the PUT, or null when the PUT deleted it (empty drawer). */
  onSaved: (row: StoredPricingRow | null) => void;
}

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[13px] w-[13px]" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const TrashSmall = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[13px] w-[13px]" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

/**
 * Right drawer (360px, Stage 36 S36-15, mockup pricing-page-drawer.html). One combination's price entries and
 * description. Edits are local until "Save changes": one PUT carrying the whole row, always including the current
 * description (PUT replaces the row, a missing description would clear it). Rules come from the same module the
 * server runs (`lib/product-pricing/price-entries`).
 */
export function PricingDrawer({ orgSlug, target, onClose, onSaved }: Props) {
  const t = useTranslations("productPricing");
  const savedEntries = useMemo(() => sortEntries(target.row?.prices ?? []), [target.row]);
  const savedDescription = target.row?.description ?? "";

  const [tab, setTab] = useState<"prices" | "description">("prices");
  const [entries, setEntries] = useState<PriceEntry[]>(savedEntries);
  const [description, setDescription] = useState(savedDescription);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [dupIndex, setDupIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleId = useId();

  const dirty =
    JSON.stringify(sortEntries(entries)) !== JSON.stringify(savedEntries) || description.trim() !== savedDescription;

  const defaultUnit: PriceUnit = target.isArea ? "m2" : "pcs";
  const unitOptions: PriceUnit[] = target.isArea ? ["m2", "sqft"] : ["pcs"];

  function openAdd() {
    setFormError(null);
    setDupIndex(null);
    setForm({ index: null, currency: "INR", unit: defaultUnit, amount: "" });
  }
  function openEdit(i: number) {
    setFormError(null);
    setDupIndex(null);
    const e = entries[i];
    setForm({ index: i, currency: e.currency, unit: e.unit, amount: String(e.amount) });
  }
  function closeForm() {
    setForm(null);
    setFormError(null);
    setDupIndex(null);
  }
  function patchForm(p: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...p } : f));
    setFormError(null);
    setDupIndex(null);
  }

  const amountValid = form !== null && AMOUNT_PATTERN.test(form.amount.trim());

  function confirmForm() {
    if (!form || !amountValid) return;
    const others = entries.filter((_, i) => i !== form.index);
    if (hasPair(others, form.currency, form.unit)) {
      setFormError(t("duplicate", { currency: form.currency, unit: unitLabel(form.unit) }));
      setDupIndex(entries.findIndex((e, i) => i !== form.index && e.currency === form.currency && e.unit === form.unit));
      return;
    }
    const entry: PriceEntry = { currency: form.currency, unit: form.unit, amount: Math.round(Number(form.amount) * 100) / 100 };
    setEntries((prev) => {
      const next = form.index === null ? [...prev, entry] : prev.map((e, i) => (i === form.index ? entry : e));
      return sortEntries(next);
    });
    closeForm();
  }

  function removeEntry(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
    closeForm();
  }

  function discard() {
    setEntries(savedEntries);
    setDescription(savedDescription);
    setSaveError(null);
    closeForm();
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/product-pricing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentTypeId: target.typeId,
          combinationKey: target.key,
          combinationLabel: target.label,
          prices: sortEntries(entries),
          description: description.trim(),
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveError(apiErrorMessage(body, t("saveFailed")));
        return;
      }
      onSaved((body as { row: StoredPricingRow | null }).row ?? null);
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function renderForm() {
    if (!form) return null;
    return (
      <div className={`rounded-lg border px-3 py-3 ${formError ? "border-danger-border bg-danger-bg" : "border-border bg-bg-subtle"} ${form.index === null ? "mt-2.5" : "mb-1.5"}`}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-[3px]">
            <span className={LABEL_CLS}>{t("currency")}</span>
            <div className="w-[76px]">
              <SelectField
                value={form.currency}
                onChange={(e) => patchForm({ currency: e.target.value as PriceCurrency })}
                className={SELECT_CLS}
                aria-label={t("currency")}
              >
                {PRICE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
          <div className="flex flex-col gap-[3px]">
            <span className={LABEL_CLS}>{t("unit")}</span>
            {target.isArea ? (
              <div className="w-[84px]">
                <SelectField
                  value={form.unit}
                  onChange={(e) => patchForm({ unit: e.target.value as PriceUnit })}
                  className={SELECT_CLS}
                  aria-label={t("unit")}
                >
                  {unitOptions.map((u) => (
                    <option key={u} value={u}>
                      {unitLabel(u)}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : (
              <span className="flex h-[34px] items-center rounded-md border border-border bg-bg-subtle px-2 text-[13px] font-bold text-text-muted">
                {unitLabel("pcs")}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-[3px]">
            <span className={LABEL_CLS}>{t("amount")}</span>
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => patchForm({ amount: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmForm();
                }
              }}
              aria-label={t("amount")}
              placeholder="0.00"
              className={`${INPUT_CLS} w-[96px] text-right tabular-nums ${formError ? "border-red-600 bg-danger-bg" : ""}`}
            />
          </div>
        </div>
        {formError && <p className="mt-1.5 text-[11.5px] font-semibold text-red-700">{formError}</p>}
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={confirmForm}
            disabled={!amountValid}
            className="h-7 rounded-sm border border-primary-dark bg-primary px-2.5 text-xs font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {form.index === null ? t("add") : t("update")}
          </button>
          <button
            type="button"
            onClick={closeForm}
            className="h-7 rounded-sm border border-border-strong bg-bg-white px-2.5 text-xs font-bold text-text-body hover:bg-bg-hover"
          >
            {t("cancel")}
          </button>
        </div>
      </div>
    );
  }

  // Q-D29: modal. The shell owns the scrim (a click closes), the inert page, Escape (a SelectField that closes its
  // own list consumes that Escape first) and the focus return to the row that opened the drawer.
  return (
    <DrawerShell
      titleId={titleId}
      onRequestClose={onClose}
      widthClass="w-[360px]"
      getRestoreTarget={() => document.querySelector<HTMLElement>(`[data-combination="${CSS.escape(target.key)}"]`)}
    >
      <>
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-gradient-to-b from-bg-card to-bg-white px-[18px] py-[15px]">
          <span id={titleId} className="text-sm font-extrabold text-text-heading">
            {target.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-text-muted hover:bg-bg-hover"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div role="tablist" className="flex shrink-0 border-b border-border px-[18px]">
          {(["prices", "description"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${
                tab === k ? "border-primary font-extrabold text-primary-dark" : "border-transparent font-bold text-text-muted"
              }`}
            >
              {k === "prices" ? t("tabPrices") : t("tabDescription")}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-[18px] py-4">
          {tab === "prices" ? (
            <>
              {entries.length === 0 ? (
                !form && <p className="mb-3 text-[13px] text-text-muted">{t("noEntries")}</p>
              ) : (
                <p className="mb-3 text-xs text-text-muted">{t("entryCount", { count: entries.length })}</p>
              )}
              {entries.map((e, i) =>
                form && form.index === i ? (
                  <div key={`${e.currency}-${e.unit}`}>{renderForm()}</div>
                ) : (
                  <div
                    key={`${e.currency}-${e.unit}`}
                    data-testid="price-entry"
                    className={`group mb-1.5 flex items-center gap-2 rounded-lg border px-2.5 py-[9px] hover:bg-bg-subtle ${
                      dupIndex === i ? "border-red-600 bg-danger-bg" : "border-border bg-bg-white"
                    }`}
                  >
                    <span className="flex-1 text-sm">
                      <PriceText amount={e.amount} currency={e.currency} unit={e.unit} />
                    </span>
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        onClick={() => openEdit(i)}
                        aria-label={t("edit")}
                        title={t("edit")}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-text-placeholder opacity-0 hover:bg-bg-hover hover:text-text-body focus:opacity-100 group-hover:opacity-100"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(i)}
                        aria-label={t("removeEntry")}
                        title={t("removeEntry")}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-text-placeholder hover:bg-danger-bg hover:text-red-700"
                      >
                        <TrashSmall />
                      </button>
                    </div>
                  </div>
                ),
              )}
              {form && form.index === null && renderForm()}
              {!form && entries.length < MAX_PRICE_ENTRIES && (
                <button
                  type="button"
                  onClick={openAdd}
                  className="mt-2 flex h-7 w-full items-center justify-center rounded-sm border border-dashed border-border-strong text-xs font-bold text-primary-dark hover:bg-primary-softer"
                >
                  {t("addPrice")}
                </button>
              )}
            </>
          ) : (
            <>
              <label htmlFor="pp-description" className={`${LABEL_CLS} mb-1.5 block`}>
                {t("descriptionLabel")}
              </label>
              <textarea
                id="pp-description"
                value={description}
                maxLength={MAX_DESCRIPTION_LENGTH}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[80px] w-full resize-y rounded-lg border border-border bg-bg-white px-2.5 py-2 text-[13.5px] leading-normal text-text-body focus:border-primary focus:outline-none focus:shadow-[0_0_0_3px_var(--color-primary-softer)]"
              />
              <p className="mt-1 text-right text-[11.5px] text-text-muted">
                {t("descriptionCounter", { count: description.length, max: MAX_DESCRIPTION_LENGTH })}
              </p>
            </>
          )}
        </div>

        {saveError && (
          <p role="alert" className="mx-[18px] mb-2 rounded-sm border border-danger-border bg-danger-bg px-3 py-2 text-xs font-semibold text-red-700">
            {saveError}
          </p>
        )}
        <div className="flex shrink-0 gap-2 border-t border-border px-[18px] py-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="h-[34px] flex-1 rounded-sm border border-primary-dark bg-primary px-3.5 text-[13px] font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("save")}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={!dirty || saving}
            className="h-[34px] rounded-sm border border-border-strong bg-bg-white px-3.5 text-[13px] font-bold text-text-body hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("discard")}
          </button>
        </div>
      </>
    </DrawerShell>
  );
}
