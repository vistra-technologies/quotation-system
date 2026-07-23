"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createSelection, type CreateSelectionState } from "./actions";

// ─── Local type definitions ─────────────────────────────────────────────────
// Defined here (not imported from lib/data/components) to avoid bundling
// server-only DAL code into the client. Must match FieldEntry in lib/data/components.ts.

interface FieldEntry {
  key: string;
  label: string;
  type: "field" | "radio" | "dropdown" | "checkbox";
  options?: string[];
  hint?: string;
  required: boolean;
  basic: boolean;
}

interface ComponentTypeOption {
  id: string;
  name: string;
  code: string;
  category: { id: string; name: string };
  fieldsSchema: FieldEntry[];
  active: boolean;
}

interface AddSelectionFormProps {
  orgSlug: string;
  projectId: string;
  orderIndex: number;
  componentTypes: ComponentTypeOption[];
}

const initialState: CreateSelectionState = { error: null };

// ─── Main form component ─────────────────────────────────────────────────────

/**
 * Client Component form for adding a Selection to a project.
 *
 * Moved verbatim from [projectId]/add-selection-form.tsx (Stage 9 URL restructure).
 * The import for createSelection now resolves to ./actions (this directory).
 *
 * Step 1: pick an active ComponentType from a grouped <select> (by category).
 * Step 2: render dynamic fields from the chosen type's fieldsSchema.
 *         Basic fields shown by default; advanced fields in a collapsible <details>.
 *         All field values are serialised as JSON into a hidden `config` input.
 *
 * Defensive rendering: radio/dropdown fields with no configured options (options: [])
 * are displayed as "not configured" rather than crashing.
 *
 * Stage 10 (Task 1.7): restyled to Sage Ease tokens. All IDs, name attributes,
 * hidden inputs, action binding, validation logic, and createSelection call are
 * unchanged — parity-critical.
 */
export function AddSelectionForm({
  orgSlug,
  projectId,
  orderIndex,
  componentTypes,
}: AddSelectionFormProps) {
  const t = useTranslations("selections");
  const [state, formAction, isPending] = useActionState(createSelection, initialState);

  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});
  const [label, setLabel] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const selectedType = componentTypes.find((ct) => ct.id === selectedTypeId) ?? null;

  // Group component types by category (preserves insertion order per category)
  const byCategory = componentTypes.reduce<Record<string, ComponentTypeOption[]>>((acc, ct) => {
    const cat = ct.category.name || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(ct);
    return acc;
  }, {});

  const handleTypeChange = (typeId: string) => {
    setSelectedTypeId(typeId);
    setFieldValues({}); // reset values when type changes to avoid stale entries
    setClientError(null);
  };

  const updateField = (key: string, value: string | boolean) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Client-side validation before the server action fires.
    if (!selectedTypeId) {
      e.preventDefault();
      setClientError("Please select a component type.");
      return;
    }
    if (!label.trim()) {
      e.preventDefault();
      setClientError(`${t("fieldLabel")} is required.`);
      return;
    }
    if (selectedType) {
      for (const field of selectedType.fieldsSchema) {
        if (!field.required) continue;
        const val = fieldValues[field.key];
        const fieldName = field.label || field.key;
        const isEmpty =
          val === undefined ||
          val === "" ||
          (field.type === "checkbox" && val === false);
        if (isEmpty) {
          e.preventDefault();
          setClientError(`"${fieldName}" is required.`);
          return;
        }
      }
    }
    // Validation passed — clear any previous client error and let the action proceed.
    setClientError(null);
  };

  const basicFields = selectedType?.fieldsSchema.filter((f) => f.basic) ?? [];
  const advancedFields = selectedType?.fieldsSchema.filter((f) => !f.basic) ?? [];

  // The hidden `config` input always reflects the current fieldValues state.
  // React submits the current value at the time of form submission, so no ref
  // manipulation is needed.
  const configJson = JSON.stringify(fieldValues);

  // ── Shared Sage Ease input class ─────────────────────────────────────────
  const inputClass =
    "w-full rounded-sm border border-border bg-bg-white px-3.5 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {(clientError ?? state.error) && (
        <div className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{clientError ?? state.error}</p>
        </div>
      )}

      <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Hidden context fields — unchanged from Stage 9 */}
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="componentTypeId" value={selectedTypeId} />
        <input type="hidden" name="orderIndex" value={String(orderIndex)} />
        <input type="hidden" name="config" value={configJson} />

        {/* Selection label */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sel-label"
            className="text-xs font-bold uppercase tracking-wider text-text-muted"
          >
            {t("fieldLabel")} *
          </label>
          <input
            id="sel-label"
            name="label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
            className={inputClass}
          />
        </div>

        {/* Component type selector — grouped by category */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sel-type"
            className="text-xs font-bold uppercase tracking-wider text-text-muted"
          >
            {t("stepPickType")} *
          </label>
          <select
            id="sel-type"
            value={selectedTypeId}
            onChange={(e) => handleTypeChange(e.target.value)}
            className={inputClass}
          >
            <option value="">— {t("stepPickType")} —</option>
            {Object.entries(byCategory).map(([cat, types]) => (
              <optgroup key={cat} label={cat}>
                {types.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Dynamic fields — only shown when a type is selected */}
        {selectedType && (
          <div className="flex flex-col gap-4 rounded-sm border border-border bg-bg-page p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-text-placeholder">
              {t("stepConfigure")}
            </p>

            {/* Basic fields */}
            {basicFields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={fieldValues[field.key]}
                onChange={(val) => updateField(field.key, val)}
              />
            ))}

            {/* Advanced fields in a collapsible section */}
            {advancedFields.length > 0 && (
              <details className="rounded-sm border border-border">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold uppercase tracking-wider text-text-muted">
                  {t("advancedFields")}
                </summary>
                <div className="flex flex-col gap-4 px-3 pb-3 pt-2">
                  {advancedFields.map((field) => (
                    <FieldInput
                      key={field.key}
                      field={field}
                      value={fieldValues[field.key]}
                      onChange={(val) => updateField(field.key, val)}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
        >
          {t("submitAdd")}
        </button>
      </form>
    </>
  );
}

// ─── Field renderer ──────────────────────────────────────────────────────────

interface FieldInputProps {
  field: FieldEntry;
  value: string | boolean | undefined;
  onChange: (val: string | boolean) => void;
}

function FieldInput({ field, value, onChange }: FieldInputProps) {
  const inputClass =
    "w-full rounded-sm border border-border bg-bg-white px-3.5 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/30";
  const labelClass = "text-xs font-bold uppercase tracking-wider text-text-muted";

  const displayLabel = field.label || field.key;

  // Guard: radio and dropdown fields with empty options are rendered as a notice
  // rather than crashing. This matches the lenient-read behavior of DAL parseFieldsSchema
  // (which allows options: [] on corrupt DB rows) — Area 3 defensive rendering per review.
  if (
    (field.type === "radio" || field.type === "dropdown") &&
    (!field.options || field.options.length === 0)
  ) {
    return (
      <div className="flex flex-col gap-1">
        <span className={labelClass}>
          {displayLabel}
          {field.required && <span className="ml-1 text-red-500">*</span>}
        </span>
        <p className="text-xs italic text-text-placeholder">
          Options not configured for this field.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {field.type !== "checkbox" && (
        <label className={labelClass}>
          {displayLabel}
          {field.required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}

      {field.type === "field" && (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}

      {field.type === "radio" && (
        <div className="flex flex-col gap-2">
          {field.options!.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 text-sm text-text-body"
            >
              <input
                type="radio"
                name={`field-radio-${field.key}`}
                value={opt}
                checked={(value as string) === opt}
                onChange={() => onChange(opt)}
                className="accent-primary"
              />
              {opt}
            </label>
          ))}
        </div>
      )}

      {field.type === "dropdown" && (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          <option value="">— Select —</option>
          {field.options!.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {field.type === "checkbox" && (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-body">
          <input
            type="checkbox"
            checked={(value as boolean) ?? false}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-primary"
          />
          <span>
            {displayLabel}
            {field.required && <span className="ml-1 text-red-500">*</span>}
          </span>
        </label>
      )}

      {field.hint && (
        <p className="text-xs text-text-placeholder">{field.hint}</p>
      )}
    </div>
  );
}
