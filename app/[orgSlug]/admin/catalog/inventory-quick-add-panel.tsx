"use client";

import { useState } from "react";
import { SelectField } from "@/components/select-field";
import { MEASUREMENT_UNITS } from "@/lib/units";
import { apiErrorMessage } from "@/lib/api-error-message";
import { CUBE_ICON } from "./catalog-tree";

interface InventoryQuickAddPanelProps {
  orgSlug: string;
  typeId: string;
  typeName: string;
  /** The missing value; becomes the item's `code`. Locked. */
  code: string;
  onCancel: () => void;
  /** Fires once, after the item exists (POST …/inventory returned 201). */
  onAdded: (name: string) => void;
}

const inputCls =
  "h-10 w-full rounded-[10px] border border-border bg-bg-white px-3 text-[13.5px] font-semibold text-text-heading focus:border-primary focus:outline-none";
const lockedCls =
  "flex h-10 w-full items-center justify-between rounded-[10px] border border-border bg-bg-page px-3 text-[13.5px] font-bold text-text-heading";

const LOCK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8A8177" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Locked">
    <title>Locked</title>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);

/**
 * Stage 35 S35-8 / G0-c — "Add to inventory" side panel of the attribute editor. Creates the missing item
 * through the existing `POST /api/v1/orgs/[orgSlug]/inventory` (MANAGE_PRICING enforced there). Code and
 * component type are prefilled and locked; there is no price field and no ItemPrice write. A refusal (409
 * duplicate code, 400, 5xx) shows inline and keeps what was typed (the state lives here, never reset).
 */
export function InventoryQuickAddPanel({ orgSlug, typeId, typeName, code, onCancel, onAdded }: InventoryQuickAddPanelProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>(MEASUREMENT_UNITS[0].value);
  const [qty, setQty] = useState("1");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setCodeError(null);
    setFormError(null);
    const perUnitQuantity = Number(qty);
    if (name.trim() === "") return setFormError("Name is required.");
    if (!Number.isFinite(perUnitQuantity) || perUnitQuantity <= 0) return setFormError("Per-unit qty must be greater than 0.");
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name: name.trim(), measurementUnit: unit, componentTypeId: typeId, perUnitQuantity }),
      });
      if (res.status === 201) {
        onAdded(name.trim());
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) setCodeError("An item with this code already exists");
      else setFormError(apiErrorMessage(body, `Could not add the item (HTTP ${res.status})`));
    } catch {
      setFormError("Could not add the item — network error");
    }
    setSaving(false);
  }

  return (
    <form
      onSubmit={submit}
      data-testid="quick-add-panel"
      className="flex w-[330px] flex-shrink-0 flex-col gap-3.5 border-l border-border bg-bg-white px-5.5 py-4.5"
    >
      <div className="flex items-center gap-2 text-[#0B6E99]">
        {CUBE_ICON(18)}
        <h3 className="m-0 text-[15px] font-extrabold text-text-heading">Add to inventory</h3>
      </div>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-muted">
        Code
        <div className={`${lockedCls} ${codeError ? "border-[#F2B8B0]" : ""}`} data-testid="quick-add-code">
          {code}
          {LOCK}
        </div>
        {codeError && (
          <span role="alert" className="text-[11.5px] font-bold text-status-failed-text">
            {codeError}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-muted">
        Component type
        <div className={lockedCls} data-testid="quick-add-type">
          {typeName}
          {LOCK}
        </div>
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-text-muted">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 text-xs font-bold text-text-muted">
          Measurement unit
          <SelectField value={unit} onChange={(e) => setUnit(e.target.value)}>
            {MEASUREMENT_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </SelectField>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-bold text-text-muted">
          Per-unit qty
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label="Per-unit qty"
            className={inputCls}
          />
        </label>
      </div>
      {formError && (
        <div role="alert" className="text-[11.5px] font-bold text-status-failed-text">
          {formError}
        </div>
      )}
      <div className="mt-auto flex justify-end gap-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-pill border border-border bg-bg-white px-4 py-2.5 text-[13px] font-extrabold text-text-body hover:border-primary-soft disabled:opacity-55"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-pill bg-primary px-4 py-2.5 text-[13px] font-extrabold text-text-on-primary hover:bg-primary-dark disabled:opacity-55"
        >
          {saving ? "Adding…" : "Add item"}
        </button>
      </div>
    </form>
  );
}
