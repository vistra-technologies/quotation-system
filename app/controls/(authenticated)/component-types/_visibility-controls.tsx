"use client";

import { useState } from "react";
import { SelectField } from "@/components/select-field";
import type { FieldEntry } from "@/lib/types/field-entry";

/**
 * Stage 35 (S35-1/S35-2) — the two SuperAdmin-authored controls of a field row, shared by the create and
 * edit forms so the UI exists once: "Show when" (a controller + the values that show the field) and
 * "Linked to inventory". English literals: /controls is SuperAdmin-only and English-only, no i18n provider.
 * Only the shape is checked client-side (earlier dropdown/radio controller); the server's
 * `validateFieldsSchema` has the last word and its message shows inline on Save.
 */

const labelClass = "text-[10px] font-bold uppercase tracking-wide text-text-muted";

function InfoTip({ text }: { text: string }) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-text-muted text-[10px] font-extrabold normal-case tracking-normal text-text-muted"
    >
      i
    </span>
  );
}

export function ShowWhenControl({
  entry,
  controllers,
  inputBase,
  onChange,
}: {
  entry: FieldEntry;
  /** Earlier dropdown/radio fields — the only eligible controllers. */
  controllers: { key: string; label: string }[];
  inputBase: string;
  onChange: (updated: FieldEntry) => void;
}) {
  const [draft, setDraft] = useState("");
  const showWhen = entry.showWhen;

  const setController = (key: string) => {
    if (!key) {
      onChange({ ...entry, showWhen: undefined });
      return;
    }
    onChange({ ...entry, showWhen: { field: key, in: showWhen?.field === key ? showWhen.in : [] } });
  };
  const setValues = (values: string[]) => {
    if (showWhen) onChange({ ...entry, showWhen: { field: showWhen.field, in: values } });
  };
  const addValue = () => {
    const v = draft.trim();
    if (!v || !showWhen) return;
    if (!showWhen.in.includes(v)) setValues([...showWhen.in, v]);
    setDraft("");
  };

  return (
    <div className={showWhen ? "flex flex-col gap-2 border-l-[3px] border-dashed border-primary pl-3.5" : "flex flex-col gap-0.5"}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
          <span className={`${labelClass} flex items-center gap-1.5`}>
            Show when
            <InfoTip text="Shown only when the earlier field chosen here has one of the selected values." />
          </span>
          <SelectField
            value={showWhen?.field ?? ""}
            onChange={(e) => setController(e.target.value)}
            className={inputBase}
          >
            <option value="">Always shown</option>
            {controllers.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label || c.key}
              </option>
            ))}
          </SelectField>
        </div>
        {showWhen && (
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <span className={labelClass}>Values</span>
            <div className="flex flex-wrap items-center gap-2" data-testid="showwhen-values">
              {showWhen.in.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setValues(showWhen.in.filter((x) => x !== v))}
                  aria-label={`Remove ${v}`}
                  className="rounded-pill border border-primary bg-primary px-3 py-1 text-xs font-bold text-text-on-primary"
                >
                  {v} ✕
                </button>
              ))}
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addValue();
                  }
                }}
                placeholder="Add value"
                aria-label="Add value"
                className={`${inputBase} w-28 text-xs`}
              />
              <button
                type="button"
                onClick={addValue}
                aria-label="Add the value"
                className="rounded-sm border border-border px-2 py-1 text-xs font-bold text-text-muted hover:border-primary-soft hover:text-text-heading"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function LinkedToggle({
  entry,
  onChange,
}: {
  entry: FieldEntry;
  onChange: (updated: FieldEntry) => void;
}) {
  const on = entry.inventoryLinked === true;
  return (
    <div className="flex items-center gap-2.5 text-sm font-bold text-text-heading">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Linked to inventory"
        onClick={() => {
          const updated = { ...entry };
          if (on) delete updated.inventoryLinked;
          else updated.inventoryLinked = true;
          onChange(updated);
        }}
        className={`relative h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors ${on ? "bg-[#0B6E99]" : "bg-border"}`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[19px]" : "left-[3px]"}`}
        />
      </button>
      Linked to inventory
      <InfoTip text="Every option value must be an active inventory item of this component type." />
    </div>
  );
}

/**
 * Stage 36 (S36-3): "Product spec" switch, same markup as `LinkedToggle`. Rendered by the forms only for
 * dropdown/radio rows. `muted` dims it while the type-change confirmation is open (mockup guard state).
 */
export function ProductSpecToggle({
  entry,
  onChange,
  muted,
}: {
  entry: FieldEntry;
  onChange: (updated: FieldEntry) => void;
  muted?: boolean;
}) {
  const on = entry.productSpec === true;
  return (
    <div className={`flex items-center gap-2.5 text-sm font-bold text-text-heading ${muted ? "opacity-50" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Product spec"
        disabled={muted}
        onClick={() => {
          const updated = { ...entry };
          if (on) delete updated.productSpec;
          else updated.productSpec = true;
          onChange(updated);
        }}
        className={`relative h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-border"}`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[19px]" : "left-[3px]"}`}
        />
      </button>
      Product spec
      <InfoTip text="Mark this field as a pricing dimension. Only product spec fields generate combinations on the Product Pricing page." />
    </div>
  );
}

/**
 * Stage 36 (S36-3): the in-row confirmation shown when a field that has Product spec on is retyped to a type
 * that cannot carry it. Translation-free on purpose (/controls has no i18n provider, AGENTS.md), and no
 * loading overlay. Copy and actions are fixed by the UI spec.
 */
export function TypeChangeConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label="Change field type"
      className="flex flex-wrap items-center gap-2 rounded-sm border border-status-pending-border bg-status-pending-bg px-3 py-2 text-[12.5px] font-semibold text-status-pending-text"
    >
      <span className="min-w-[14rem] flex-1">
        <strong>Product spec requires Dropdown or Radio.</strong> Changing this field&apos;s type will clear the
        Product spec flag and may break existing pricing entries. Change type anyway?
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-sm border border-border bg-bg-white px-3 py-1 text-xs font-bold text-text-heading hover:border-primary-soft"
      >
        Keep type
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded-sm bg-primary px-3 py-1 text-xs font-bold text-text-on-primary hover:bg-primary-dark"
      >
        Change type
      </button>
    </div>
  );
}
