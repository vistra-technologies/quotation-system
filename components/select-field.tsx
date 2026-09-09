"use client";

import React from "react";

/**
 * Shared select-field wrapper.
 *
 * Renders a styled <select> element with a consistent appearance across all
 * form pages. Translation-free: labels/options come from callers who translate
 * before passing. Use the `children` prop for <option> elements.
 *
 * The `placeholder` prop renders a disabled first <option value=""> with plain
 * wording — no "--" decoration. Omit it for selects that always have a valid
 * first selected value (e.g. a role list seeded from the server with no empty
 * state).
 *
 * The `className` prop replaces the standard style entirely — use it for selects
 * that need non-standard sizing or appearance (e.g. floor-bar's compact UI
 * control, or field-editor rows that use a smaller inputBase).
 */

const STANDARD_CLS =
  "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body focus:border-primary focus:outline-none focus:[box-shadow:0_0_0_4px_var(--color-primary-softer)]";

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
  return (
    <select
      id={id}
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      disabled={disabled}
      required={required}
      title={title}
      className={className ?? STANDARD_CLS}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {children}
    </select>
  );
}
