"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { parsePack } from "@/lib/inventory-draft";
import type { DraftRow, DraftValidation, ItemDraft } from "@/lib/inventory-draft";
import { partFields } from "@/lib/inventory-list";
import type { ListItem, ListType } from "@/lib/inventory-list";
import { MEASUREMENT_UNITS, unitForQuantity } from "@/lib/units";
import { MatchesEditor } from "./_matches-editor";
import { AlsoMatchedBy, InfoTip } from "./_parts";
import { C } from "./_styles";

/**
 * The drawer's edit and create form (mockup A rev 7 `detailsEdit` + inline Matches rows): Code, Name, Component
 * type, Part, Unit, Pack size, Sold in whole packs, Active, then the Matches rows editor. Presentational: the
 * drawer owns the draft, the confirms and the save.
 */

interface ItemFormProps {
  draft: ItemDraft;
  types: ListType[];
  draftType: ListType | undefined;
  /** Field-level errors, already filtered to what is visible (empty before the first save attempt). */
  errors: DraftValidation["fields"];
  /** The server said this code is taken. */
  codeTaken: boolean;
  /** Show every Matches row message (after the first save attempt). */
  showAllRowErrors: boolean;
  saving: boolean;
  alsoMatched: ListItem[];
  onPatch: (patch: Partial<ItemDraft>) => void;
  onTypeChange: (typeId: string) => void;
  onRows: (rows: DraftRow[]) => void;
  onOpenItem: (id: string) => void;
  /** Catalog quick-add: these fields show their prefilled value read-only with a lock (D2, D3). */
  locks?: { code?: boolean; type?: boolean; part?: boolean };
}

const LOCK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-text-muted">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

function LockedValue({ value, mono, label, testId }: { value: string; mono?: boolean; label: string; testId: string }) {
  return (
    <div
      aria-disabled="true"
      data-testid={testId}
      className={`${C.input} ${C.inOk} flex items-center justify-between gap-2 bg-bg-subtle text-text-heading ${mono ? "font-mono text-[13px]" : ""}`}
    >
      <span className="truncate">{value}</span>
      <span role="img" aria-label={label} title={label}>
        {LOCK_ICON}
      </span>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className={C.label}>
        {label}
        {required ? <span className="text-[var(--color-status-failed-text)]"> *</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs font-bold text-[var(--color-status-failed-text)]">{error}</p> : null}
    </div>
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
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-card transition-all ${on ? "left-[19px]" : "left-[3px]"}`}
      />
    </button>
  );
}

export function ItemForm({
  draft,
  types,
  draftType,
  errors,
  codeTaken,
  showAllRowErrors,
  saving,
  alsoMatched,
  onPatch,
  onTypeChange,
  onRows,
  onOpenItem,
  locks,
}: ItemFormProps) {
  const t = useTranslations("inventory");
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const err = (code: string | undefined) => (code ? t(code as Parameters<typeof t>[0]) : null);
  const codeError = codeTaken ? t("codeInUse") : err(errors.code);
  const parts = partFields(draftType);
  const partValue = draft.partKey && parts.some((p) => p.key === draft.partKey) ? draft.partKey : "";
  const pack = parsePack(draft.pack);
  const adornment = draft.measurementUnit ? unitForQuantity(draft.measurementUnit, pack ?? 1) : t("unitsFallback");
  const inputCls = (bad: boolean) => `${C.input} ${bad ? C.inErr : C.inOk}`;

  return (
    <>
      <section aria-labelledby={id("h-det")}>
        <h3 id={id("h-det")} className={`${C.sectionH} mb-3`}>
          {t("detailsHeading")}
        </h3>
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t("fieldCode")} htmlFor={id("code")} required error={codeError}>
              {locks?.code ? (
                <LockedValue value={draft.code} mono label={t("locked")} testId="quick-add-code" />
              ) : (
                <input
                  id={id("code")}
                  value={draft.code}
                  disabled={saving}
                  onChange={(e) => onPatch({ code: e.target.value })}
                  placeholder={t("codePlaceholder")}
                  className={`${inputCls(!!codeError)} font-mono text-[13px] placeholder:font-sans placeholder:text-text-muted`}
                />
              )}
            </Field>
            <Field label={t("fieldName")} htmlFor={id("name")} required error={err(errors.name)}>
              <input
                id={id("name")}
                value={draft.name}
                disabled={saving}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder={t("namePlaceholder")}
                className={`${inputCls(!!errors.name)} placeholder:text-text-muted`}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t("fieldComponent")} htmlFor={id("type")} error={err(errors.component)}>
              {locks?.type ? (
                <LockedValue value={draftType?.name ?? ""} label={t("locked")} testId="quick-add-type" />
              ) : (
                <SelectField
                  id={id("type")}
                  value={draft.componentTypeId}
                  placeholder={t("selectNone")}
                  disabled={saving}
                  className={`${inputCls(!!errors.component)} text-left`}
                  onChange={(e) => onTypeChange(e.target.value)}
                >
                  {types.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  {t("fieldPart")} <InfoTip text={t("tipPart")} />
                </span>
              }
              htmlFor={id("part")}
            >
              {locks?.part ? (
                <LockedValue
                  value={parts.find((p) => p.key === partValue)?.label ?? t("partOther")}
                  label={t("locked")}
                  testId="quick-add-part"
                />
              ) : (
                <SelectField
                  id={id("part")}
                  value={partValue}
                  disabled={saving || !draft.componentTypeId}
                  className={`${inputCls(false)} text-left`}
                  onChange={(e) => onPatch({ partKey: e.target.value === "" ? null : e.target.value })}
                >
                  {parts.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                  <option value="">{t("partOther")}</option>
                </SelectField>
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t("fieldUnit")} htmlFor={id("unit")} required error={err(errors.unit)}>
              <SelectField
                id={id("unit")}
                value={draft.measurementUnit}
                placeholder={t("selectUnit")}
                disabled={saving}
                className={`${inputCls(!!errors.unit)} text-left`}
                onChange={(e) => onPatch({ measurementUnit: e.target.value })}
              >
                {MEASUREMENT_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </SelectField>
            </Field>
            <Field label={t("fieldPackSize")} htmlFor={id("pack")} error={err(errors.pack)}>
              <div className="flex">
                <input
                  id={id("pack")}
                  value={draft.pack}
                  inputMode="decimal"
                  disabled={saving}
                  onChange={(e) => onPatch({ pack: e.target.value })}
                  className={`${inputCls(!!errors.pack)} rounded-r-none text-right tabular-nums`}
                />
                <span className="flex h-[34px] items-center rounded-r-sm border border-l-0 border-border bg-bg-subtle px-2.5 text-[13px] font-bold text-text-muted">
                  {adornment}
                </span>
              </div>
            </Field>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-sm border border-border bg-bg-card px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-text-heading">
              {t("fieldWholePacks")} <InfoTip text={t("tipWholePacks")} />
            </span>
            <Switch
              on={draft.soldInWholePacks}
              label={t("fieldWholePacks")}
              disabled={saving}
              onToggle={() => onPatch({ soldInWholePacks: !draft.soldInWholePacks })}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-sm border border-border bg-bg-card px-3 py-2.5">
            <span className="text-[13px] font-bold text-text-heading">{t("fieldActive")}</span>
            <Switch
              on={draft.active}
              label={t("fieldActive")}
              disabled={saving}
              onToggle={() => onPatch({ active: !draft.active })}
            />
          </div>
        </div>
      </section>

      {draftType ? (
        <section aria-labelledby={id("h-m")}>
          <h3 id={id("h-m")} className={`${C.sectionH} mb-2 flex items-center justify-between gap-1.5`}>
            <span className="inline-flex items-center gap-1.5">
              {t("matchesHeading")} <InfoTip text={t("tipMatches")} />
            </span>
          </h3>
          <MatchesEditor type={draftType} rows={draft.rows} onChange={onRows} showAll={showAllRowErrors} disabled={saving || !!locks?.type} />
          <AlsoMatchedBy others={alsoMatched} onOpenItem={onOpenItem} />
        </section>
      ) : null}
    </>
  );
}
