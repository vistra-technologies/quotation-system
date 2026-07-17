"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { createComponentType } from "../actions";
import type { FieldEntry } from "@/lib/data/components";

// ─── Inner status helpers ─────────────────────────────────────────────────────

function PendingOverlay() {
  const { pending } = useFormStatus();
  return <LoadingOverlay visible={pending} />;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {label}
    </button>
  );
}

// ─── Shared field row types ───────────────────────────────────────────────────

const FIELD_TYPES: FieldEntry["type"][] = ["text", "number", "boolean", "select"];

function FieldRow({
  index,
  entry,
  onChange,
  onRemove,
  labels: { keyLabel, labelLabel, typeLabel, requiredLabel, removeLabel },
}: {
  index: number;
  entry: FieldEntry;
  onChange: (updated: FieldEntry) => void;
  onRemove: () => void;
  labels: {
    keyLabel: string;
    labelLabel: string;
    typeLabel: string;
    requiredLabel: string;
    removeLabel: string;
  };
}) {
  const inputBase =
    "rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50";

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {keyLabel}
        </label>
        <input
          type="text"
          value={entry.key}
          onChange={(e) => onChange({ ...entry, key: e.target.value })}
          placeholder={`field_${index + 1}`}
          className={inputBase}
        />
      </div>
      <div className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {labelLabel}
        </label>
        <input
          type="text"
          value={entry.label}
          onChange={(e) => onChange({ ...entry, label: e.target.value })}
          placeholder="Display label"
          className={inputBase}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {typeLabel}
        </label>
        <select
          value={entry.type}
          onChange={(e) => onChange({ ...entry, type: e.target.value as FieldEntry["type"] })}
          className={inputBase}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {requiredLabel}
        </label>
        <input
          type="checkbox"
          checked={entry.required}
          onChange={(e) => onChange({ ...entry, required: e.target.checked })}
          className="mt-1.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 dark:border-zinc-600"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="self-end rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-500 hover:border-red-200 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:text-red-400"
      >
        {removeLabel}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface CreateComponentFormProps {
  orgSlug: string;
  labels: {
    fieldCodeLabel: string;
    fieldCodeHint: string;
    fieldNameLabel: string;
    fieldsSchemaLabel: string;
    addFieldLabel: string;
    removeFieldLabel: string;
    fieldKeyLabel: string;
    fieldLabelLabel: string;
    fieldTypeLabel: string;
    fieldRequiredLabel: string;
    fieldStatusLabel: string;
    submitLabel: string;
  };
}

/**
 * Create-ComponentType form (Client Component).
 *
 * Manages the field-list editor state with useState.
 * Serialises the fields array to JSON in a hidden input before submission.
 */
export function CreateComponentForm({ orgSlug, labels }: CreateComponentFormProps) {
  const [fields, setFields] = useState<FieldEntry[]>([]);

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { key: "", label: "", type: "text", required: false },
    ]);
  };

  const updateField = (index: number, updated: FieldEntry) => {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)));
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <form action={createComponentType} className="flex flex-col gap-5">
      <PendingOverlay />

      <input type="hidden" name="orgSlug" value={orgSlug} />
      {/* Serialised field list — React keeps this in sync with state */}
      <input type="hidden" name="fieldsSchema" value={JSON.stringify(fields)} />

      {/* Code */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="code"
          className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          {labels.fieldCodeLabel}
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          autoComplete="off"
          placeholder="e.g. WALL_TYPE"
          className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
        />
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{labels.fieldCodeHint}</p>
      </div>

      {/* Name */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="name"
          className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          {labels.fieldNameLabel}
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="off"
          placeholder="e.g. Wall Type"
          className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
        />
      </div>

      {/* Field list editor */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {labels.fieldsSchemaLabel}
          </span>
          <button
            type="button"
            onClick={addField}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
          >
            + {labels.addFieldLabel}
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-200 px-4 py-3 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
            No fields yet — click &quot;+ {labels.addFieldLabel}&quot; to add one.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {fields.map((field, i) => (
              <FieldRow
                key={i}
                index={i}
                entry={field}
                onChange={(updated) => updateField(i, updated)}
                onRemove={() => removeField(i)}
                labels={{
                  keyLabel: labels.fieldKeyLabel,
                  labelLabel: labels.fieldLabelLabel,
                  typeLabel: labels.fieldTypeLabel,
                  requiredLabel: labels.fieldRequiredLabel,
                  removeLabel: labels.removeFieldLabel,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <SubmitButton label={labels.submitLabel} />
    </form>
  );
}
