"use client";

import React, { useEffect, useId, useRef, useState } from "react";

/**
 * Shared select-field wrapper.
 *
 * Renders a custom-styled trigger + listbox popup (visual pattern copied from
 * `list-page-controls.tsx`'s date-range filter / `company-dropdown.tsx`) while
 * keeping a real, visually-hidden native `<select>` in sync underneath — that
 * hidden select is what makes native `required` validation and
 * `formData.get(name)` server-action submission keep working with zero
 * server-side changes, for the ~third of call sites that are genuinely
 * uncontrolled (`defaultValue`/no `onChange`, relying on native form
 * submission rather than React state).
 *
 * Translation-free: labels/options come from callers who translate before
 * passing. Use the `children` prop for <option> elements — they're parsed
 * internally (`getOptionsFromChildren`) to build the visible listbox; no call
 * site needs to change how it renders its options.
 *
 * Controlled/uncontrolled hybrid, mirroring a real `<select>`: pass `value`
 * for a controlled select (selecting an option calls `onChange` with a
 * synthetic `{ target: { value } }` event); pass only `defaultValue` (or
 * neither) for an uncontrolled one — the component owns its own state,
 * seeded from `defaultValue` or the first non-disabled option.
 *
 * The `placeholder` prop renders a disabled first <option value=""> with plain
 * wording — no "--" decoration. Omit it for selects that always have a valid
 * first selected value (e.g. a role list seeded from the server with no empty
 * state).
 *
 * The `className` prop replaces the standard trigger style entirely — use it
 * for selects that need non-standard sizing or appearance (e.g. floor-bar's
 * compact UI control, or field-editor rows that use a smaller inputBase).
 */

const STANDARD_TRIGGER_CLS =
  "flex w-full items-center justify-between gap-2 rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)] disabled:cursor-not-allowed disabled:opacity-50";

interface SelectFieldOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

/**
 * Walks `children` (expected to be `<option>` elements, as rendered by every
 * current call site) and extracts the {value, label, disabled, title} shape
 * the custom listbox needs. Skips anything that isn't an `<option>` element
 * (defensive — shouldn't happen given current call sites).
 */
export function getOptionsFromChildren(children: React.ReactNode): SelectFieldOption[] {
  const options: SelectFieldOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "option") return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    options.push({
      value: String(props.value ?? ""),
      label: props.children,
      disabled: props.disabled,
      title: props.title,
    });
  });
  return options;
}

interface SelectFieldProps {
  id?: string;
  name?: string;
  /** Controlled value. */
  value?: string;
  /** Uncontrolled default value (for native form submission without React state). */
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  /**
   * Renders a disabled first <option value=""> before children.
   * Text is plain wording — no "--" decoration.
   * Omit for selects that always have a meaningful selected value.
   */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /**
   * Replaces the standard style entirely — for selects that need non-standard
   * sizing or appearance (e.g. floor-bar's compact UI control).
   */
  className?: string;
  title?: string;
  /** The <option> elements. */
  children: React.ReactNode;
}

export function SelectField({
  id,
  name,
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  required,
  className,
  title,
  children,
}: SelectFieldProps) {
  const generatedId = useId();
  const resolvedId = id ?? generatedId;

  const options = getOptionsFromChildren(children);
  const isControlled = value !== undefined;

  const [internalValue, setInternalValue] = useState(
    () => defaultValue ?? options.find((o) => !o.disabled)?.value ?? "",
  );
  const currentValue = isControlled ? value : internalValue;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click — mirrors list-page-controls.tsx's date-range filter.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (v: string) => {
    if (!isControlled) setInternalValue(v);
    onChange?.({ target: { value: v } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  const currentIndex = options.findIndex((o) => o.value === currentValue);

  const openAt = (index: number | null) => {
    setOpen(true);
    setActiveIndex(index ?? (currentIndex >= 0 ? currentIndex : 0));
  };

  const moveActive = (delta: number) => {
    if (!options.length) return;
    setActiveIndex((prev) => {
      const base = prev ?? (currentIndex >= 0 ? currentIndex : 0);
      let next = base;
      for (let i = 0; i < options.length; i++) {
        next = (next + delta + options.length) % options.length;
        if (!options[next].disabled) break;
      }
      return next;
    });
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) openAt(null);
        else moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openAt(null);
        else moveActive(-1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) {
          openAt(null);
        } else if (activeIndex !== null && options[activeIndex] && !options[activeIndex].disabled) {
          handleSelect(options[activeIndex].value);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
        break;
      default:
        break;
    }
  };

  const selectedOption = options.find((o) => o.value === currentValue);
  const triggerLabel = selectedOption?.label ?? placeholder ?? "";

  return (
    <div ref={containerRef} className="relative">
      {/* Real, visually-hidden select — drives native form participation
          (required validation, formData.get(name) on submit) unchanged. */}
      <select
        id={resolvedId}
        name={name}
        value={currentValue}
        onChange={() => {}}
        disabled={disabled}
        required={required}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>

      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${resolvedId}-listbox`}
        aria-activedescendant={
          open && activeIndex !== null ? `${resolvedId}-option-${activeIndex}` : undefined
        }
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openAt(null))}
        onKeyDown={handleTriggerKeyDown}
        className={className ?? STANDARD_TRIGGER_CLS}
      >
        <span className="truncate">{triggerLabel}</span>
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
          className={["shrink-0", open ? "rotate-180 transition-transform" : "transition-transform"].join(" ")}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={`${resolvedId}-listbox`}
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[160px] rounded-md border border-border bg-bg-white p-[7px] shadow-[0_16px_34px_-12px_rgba(27,40,30,0.28)]"
        >
          {options.map((opt, i) => (
            <button
              key={opt.value}
              id={`${resolvedId}-option-${i}`}
              type="button"
              role="option"
              aria-selected={opt.value === currentValue}
              disabled={opt.disabled}
              title={opt.title}
              onClick={() => !opt.disabled && handleSelect(opt.value)}
              onMouseEnter={() => setActiveIndex(i)}
              className={[
                "block w-full rounded-[7px] px-[9px] py-[7px] text-left text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50",
                opt.value === currentValue
                  ? "bg-primary text-text-on-primary"
                  : i === activeIndex
                    ? "bg-primary-softer text-text-heading"
                    : "text-text-body hover:bg-primary-softer hover:text-text-heading",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
