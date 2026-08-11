"use client";

import { useEffect, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompanyOption {
  id: string;
  name: string;
}

interface CompanyDropdownProps {
  /** Selectable company options. */
  options: CompanyOption[];
  /** Currently selected company id. Empty string = none/all selected. */
  value: string;
  /** Called with the newly selected id (empty string = none/all). */
  onChange: (id: string) => void;
  /** Label text shown when no company is selected (e.g. "All companies", "None"). */
  noneLabel: string;
  /**
   * When provided, a hidden `<input type="hidden" name={name}>` is rendered so
   * the selected value is included in `FormData` on form submission (server actions).
   */
  name?: string;
  /**
   * `id` forwarded to the trigger button — allows a `<label htmlFor={id}>` to
   * activate the dropdown, matching the native-select behaviour it replaces.
   */
  id?: string;
  /** Accessible label for the trigger button (falls back to `noneLabel` text). */
  ariaLabel?: string;
}

// ─── CompanyDropdown ─────────────────────────────────────────────────────────

/**
 * Styled custom company-selector dropdown.
 *
 * Replaces the plain native `<select>` used in create-inquiry-form,
 * create-project-form, and list-page-controls (company filter).
 *
 * Visual pattern is copied from the date-range filter popover already used
 * in `components/list-page-controls.tsx` — button triggers a popover list,
 * click-outside closes it. No search/filter is needed (company lists are short).
 *
 * When a `name` prop is provided the component renders a hidden `<input>` so
 * the selection is included in the server-action FormData on submit. In filter
 * (non-form) usage, only the `onChange` callback is used.
 *
 * Stage 13 Batch 5.
 */
export function CompanyDropdown({
  options,
  value,
  onChange,
  noneLabel,
  name,
  id,
  ariaLabel,
}: CompanyDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click — mirrors the date-range filter pattern.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedLabel =
    options.find((o) => o.id === value)?.name ?? noneLabel;

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Hidden input for form submission (server actions / FormData). */}
      {name && <input type="hidden" name={name} value={value} />}

      {/* Trigger button */}
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? selectedLabel}
        className="flex w-full items-center justify-between gap-2 rounded-sm border border-border bg-bg-white px-3 py-2 text-[13px] font-semibold text-text-body hover:bg-primary-softer"
      >
        {/* Building icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
        </svg>

        <span className="flex-1 text-left">{selectedLabel}</span>

        {/* Chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Popover list */}
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[200px] rounded-md border border-border bg-bg-white p-[7px] shadow-[0_16px_34px_-12px_rgba(27,40,30,0.28)]"
          role="listbox"
          aria-label={ariaLabel ?? "Select company"}
        >
          {/* None/all option */}
          <button
            key=""
            type="button"
            role="option"
            aria-selected={value === ""}
            onClick={() => handleSelect("")}
            className={[
              "block w-full rounded-[7px] px-[9px] py-[7px] text-left text-[12.5px] font-semibold",
              value === ""
                ? "bg-primary text-text-on-primary"
                : "text-text-body hover:bg-primary-softer hover:text-text-heading",
            ].join(" ")}
          >
            {noneLabel}
          </button>

          {/* Company options */}
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              aria-selected={value === opt.id}
              onClick={() => handleSelect(opt.id)}
              className={[
                "block w-full rounded-[7px] px-[9px] py-[7px] text-left text-[12.5px] font-semibold",
                value === opt.id
                  ? "bg-primary text-text-on-primary"
                  : "text-text-body hover:bg-primary-softer hover:text-text-heading",
              ].join(" ")}
            >
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
