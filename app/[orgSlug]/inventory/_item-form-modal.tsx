"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ItemFormData {
  id: string;
  code: string;
  name: string;
  measurementUnit: string;
  /** Decimal from Prisma serialises to string via JSON; accept both. */
  perUnitQuantity: number | string;
  active: boolean;
}

interface ItemFormModalProps {
  mode: "create" | "edit";
  /** Pre-populated item for edit mode. Omit for create. */
  item?: ItemFormData;
  orgSlug: string;
  onSuccess: () => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Create / edit modal for InventoryItems (Client Component).
 *
 * Supports both create (POST /inventory) and edit (PATCH /inventory/[itemId])
 * modes. All form fields are controlled state (React 19 uncontrolled-input
 * reset gotcha — see profile.md "Recurring gotcha").
 *
 * Error handling:
 *   - Client-side required-field errors appear per-field before any API call.
 *   - API-level errors (409 duplicate code, unexpected 500) appear as an inline
 *     banner at the top of the dialog body; the dialog stays open for correction.
 *
 * Follows the `confirm-dialog.tsx` overlay pattern: fixed inset-0 z-50 bg-black/40,
 * Escape-to-close, click-outside-to-close, stop-propagation on the dialog card.
 *
 * Stage 25 Batch 8.
 */
export function ItemFormModal({
  mode,
  item,
  orgSlug,
  onSuccess,
  onClose,
}: ItemFormModalProps) {
  // ── Controlled field state ────────────────────────────────────────────────
  const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [measurementUnit, setMeasurementUnit] = useState(
    item?.measurementUnit ?? "",
  );
  const [perUnitQuantity, setPerUnitQuantity] = useState(
    item?.perUnitQuantity != null ? String(item.perUnitQuantity) : "",
  );
  const [active, setActive] = useState(item?.active ?? true);

  // ── Error state ───────────────────────────────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // ── Escape-to-close ───────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Client-side validation ────────────────────────────────────────────────
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!code.trim()) errors.code = "Code is required.";
    if (!name.trim()) errors.name = "Name is required.";
    if (!measurementUnit.trim())
      errors.measurementUnit = "Unit of measure is required.";
    if (
      perUnitQuantity !== "" &&
      (isNaN(Number(perUnitQuantity)) || Number(perUnitQuantity) <= 0)
    ) {
      errors.perUnitQuantity = "Qty per unit must be a positive number.";
    }
    return errors;
  }

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    const body: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      measurementUnit: measurementUnit.trim(),
      active,
    };
    if (perUnitQuantity !== "") {
      body.perUnitQuantity = Number(perUnitQuantity);
    }

    const url =
      mode === "create"
        ? `/api/v1/orgs/${orgSlug}/inventory`
        : `/api/v1/orgs/${orgSlug}/inventory/${item!.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    setIsPending(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSuccess();
        return;
      }

      const data = await res.json().catch(() => ({ error: "Unexpected error." }));
      const message =
        (data as { error?: string }).error ?? "An unexpected error occurred.";

      if (res.status === 409) {
        // Duplicate code — show banner + highlight the code field.
        setApiError(message);
        setFieldErrors((prev) => ({
          ...prev,
          code: "This code is already in use.",
        }));
      } else {
        setApiError(message);
      }
    } catch {
      setApiError("Network error — please try again.");
    } finally {
      setIsPending(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const title = mode === "create" ? "New inventory item" : "Edit inventory item";

  function inputClass(field: string) {
    return [
      "w-full rounded-sm border px-3 py-2 text-sm text-text-heading outline-none",
      "focus:border-primary focus:shadow-[0_0_0_2px_rgba(78,127,88,.15)]",
      fieldErrors[field]
        ? "border-[var(--color-danger-border)] bg-[#FFF5F5]"
        : "border-border bg-bg-white",
    ].join(" ");
  }

  return (
    /* Fixed overlay — blocks page interaction behind the dialog. */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      {/* Dialog card — stop propagation so clicking inside does not dismiss. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-form-dialog-title"
        className="mx-4 w-full max-w-lg rounded-md border border-border bg-bg-white shadow-[0_24px_48px_-16px_rgba(27,40,30,.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2
            id="item-form-dialog-title"
            className="text-[15px] font-extrabold text-text-heading"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-text-muted hover:bg-primary-softer hover:text-text-heading"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1 1l10 10M11 1L1 11"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* ── Form ───────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit}>
          <div
            className="flex flex-col gap-4 overflow-y-auto px-5 py-5"
            style={{ maxHeight: "calc(100vh - 200px)" }}
          >
            {/* API error banner — shown after a failed submit */}
            {apiError && (
              <div className="flex items-start gap-2.5 rounded-sm border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3.5 py-2.5">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="mt-0.5 shrink-0"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="7"
                    stroke="var(--color-status-failed-text)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M8 4.5v4M8 10.5v1"
                    stroke="var(--color-status-failed-text)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-sm font-bold text-[var(--color-status-failed-text)]">
                  {apiError}
                </span>
              </div>
            )}

            {/* Code + Name row */}
            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="item-form-code"
                  className="text-xs font-extrabold text-text-heading"
                >
                  Code{" "}
                  <span
                    className="text-[var(--color-status-failed-text)]"
                    aria-hidden="true"
                  >
                    *
                  </span>
                </label>
                <input
                  id="item-form-code"
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    // Clear both the field error and the API banner when the
                    // user starts correcting the duplicate-code field.
                    setApiError(null);
                    setFieldErrors((prev) => ({ ...prev, code: "" }));
                  }}
                  placeholder="e.g. GL-CLR-10"
                  className={inputClass("code")}
                  autoComplete="off"
                />
                <span className="text-[11px] text-text-muted">
                  Unique within your org. Used in formula references.
                </span>
                {fieldErrors.code && (
                  <span
                    role="alert"
                    className="text-xs font-bold text-[var(--color-status-failed-text)]"
                  >
                    {fieldErrors.code}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="item-form-name"
                  className="text-xs font-extrabold text-text-heading"
                >
                  Name{" "}
                  <span
                    className="text-[var(--color-status-failed-text)]"
                    aria-hidden="true"
                  >
                    *
                  </span>
                </label>
                <input
                  id="item-form-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, name: "" }));
                  }}
                  placeholder="e.g. Clear Glass 10mm"
                  className={inputClass("name")}
                />
                {fieldErrors.name && (
                  <span
                    role="alert"
                    className="text-xs font-bold text-[var(--color-status-failed-text)]"
                  >
                    {fieldErrors.name}
                  </span>
                )}
              </div>
            </div>

            {/* Unit of measure + Qty per unit row */}
            <div className="grid grid-cols-[1fr_130px] gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="item-form-uom"
                  className="text-xs font-extrabold text-text-heading"
                >
                  Unit of measure{" "}
                  <span
                    className="text-[var(--color-status-failed-text)]"
                    aria-hidden="true"
                  >
                    *
                  </span>
                </label>
                <input
                  id="item-form-uom"
                  type="text"
                  value={measurementUnit}
                  onChange={(e) => {
                    setMeasurementUnit(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, measurementUnit: "" }));
                  }}
                  placeholder="e.g. m², m, set, unit"
                  className={inputClass("measurementUnit")}
                />
                <span className="text-[11px] text-text-muted">
                  Free text — matches what your formulas expect.
                </span>
                {fieldErrors.measurementUnit && (
                  <span
                    role="alert"
                    className="text-xs font-bold text-[var(--color-status-failed-text)]"
                  >
                    {fieldErrors.measurementUnit}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="item-form-qty"
                  className="text-xs font-extrabold text-text-heading"
                >
                  Qty per unit
                </label>
                <input
                  id="item-form-qty"
                  type="number"
                  min="0.0001"
                  step="any"
                  value={perUnitQuantity}
                  onChange={(e) => {
                    setPerUnitQuantity(e.target.value);
                    setFieldErrors((prev) => ({ ...prev, perUnitQuantity: "" }));
                  }}
                  placeholder="1"
                  className={inputClass("perUnitQuantity")}
                />
                <span className="text-[11px] text-text-muted">Defaults to 1.</span>
                {fieldErrors.perUnitQuantity && (
                  <span
                    role="alert"
                    className="text-xs font-bold text-[var(--color-status-failed-text)]"
                  >
                    {fieldErrors.perUnitQuantity}
                  </span>
                )}
              </div>
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-sm border border-border bg-bg-card px-3.5 py-3">
              <div>
                <p className="text-sm font-bold text-text-heading">Active</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Inactive items are hidden from formula references in new
                  projects.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                aria-label="Active"
                onClick={() => setActive((a) => !a)}
                className={[
                  "relative inline-flex h-6 w-[42px] shrink-0 cursor-pointer rounded-full",
                  "border-2 border-transparent transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "bg-primary" : "bg-[#C4C9BC]",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow",
                    "transition-transform",
                    active ? "translate-x-[18px]" : "translate-x-0",
                  ].join(" ")}
                />
              </button>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2.5 border-t border-border bg-bg-card px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-border bg-bg-white px-4 py-2 text-sm font-bold text-text-body hover:border-[#b9c2ae] hover:text-text-heading"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-sm border border-primary-dark bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
