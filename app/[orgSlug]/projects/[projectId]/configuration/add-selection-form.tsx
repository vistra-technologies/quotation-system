"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  createSelection,
  updateSelection,
  type CreateSelectionState,
  type UpdateSelectionState,
} from "./actions";

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

interface SelectionRow {
  id: string;
  label: string;
  orderIndex: number;
  componentType: { id: string; name: string; code: string };
  config: Record<string, string | boolean | number | null>;
}

interface AddSelectionFormProps {
  orgSlug: string;
  projectId: string;
  orderIndex: number;
  componentTypes: ComponentTypeOption[];
  selections: SelectionRow[];
}

const initialCreateState: CreateSelectionState = { error: null };
const initialUpdateState: UpdateSelectionState = { error: null };

// ─── Main form component ─────────────────────────────────────────────────────

/**
 * Client Component for the Configuration page — Stage 17 rework.
 *
 * Renders the finalized 3-column mockup layout:
 *   Left (200px) : ComponentType sidebar — click to select
 *   Center (1fr) : Add/Edit form — basic fields always visible;
 *                  "Configure" button reveals advanced fields (only when present)
 *   Right (300px): Saved Components list — click a row to enter edit mode
 *
 * Edit mode state machine:
 *   - Null editingSelectionId = add mode (blank form, sidebar clickable)
 *   - Non-null editingSelectionId = edit mode (form pre-filled from sel.config,
 *     sidebar locked, submit calls updateSelection, Cancel resets to add mode)
 *
 * Schema-drift safety: when pre-filling from sel.config, keys that no longer
 * exist in the current fieldsSchema are silently dropped. Keys in the schema
 * with no matching config entry render blank (default state).
 *
 * Reuses: FieldInput sub-component (unchanged), LoadingOverlay, useActionState.
 */
export function AddSelectionForm({
  orgSlug,
  projectId,
  orderIndex,
  componentTypes,
  selections,
}: AddSelectionFormProps) {
  const t = useTranslations("selections");
  const [createState, createFormAction, isCreatePending] = useActionState(
    createSelection,
    initialCreateState,
  );
  const [updateState, updateFormAction, isUpdatePending] = useActionState(
    updateSelection,
    initialUpdateState,
  );

  const isPending = isCreatePending || isUpdatePending;

  // ── Form state ─────────────────────────────────────────────────────────────
  const [selectedTypeId, setSelectedTypeId] = useState(
    componentTypes[0]?.id ?? "",
  );
  const [fieldValues, setFieldValues] = useState<Record<string, string | boolean>>({});
  const [label, setLabel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editingSelectionId, setEditingSelectionId] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const selectedType = componentTypes.find((ct) => ct.id === selectedTypeId) ?? null;

  const basicFields = selectedType?.fieldsSchema.filter((f) => f.basic) ?? [];
  const advancedFields = selectedType?.fieldsSchema.filter((f) => !f.basic) ?? [];

  const configJson = JSON.stringify(fieldValues);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleTypeChange = (typeId: string) => {
    // Sidebar is locked in edit mode.
    if (editingSelectionId !== null) return;
    setSelectedTypeId(typeId);
    setFieldValues({});
    setShowAdvanced(false);
    setClientError(null);
  };

  const updateField = (key: string, value: string | boolean) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleEditSelection = (sel: SelectionRow) => {
    setEditingSelectionId(sel.id);
    setSelectedTypeId(sel.componentType.id);
    setLabel(sel.label);
    setShowAdvanced(false);
    setClientError(null);

    // Schema-drift safety: only keep config keys that exist in the current
    // fieldsSchema for this componentType. Extra keys are silently dropped.
    const ct = componentTypes.find((c) => c.id === sel.componentType.id);
    if (ct) {
      const schemaKeys = new Set(ct.fieldsSchema.map((f) => f.key));
      const filtered: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(sel.config)) {
        if (schemaKeys.has(k) && (typeof v === "string" || typeof v === "boolean")) {
          filtered[k] = v;
        }
      }
      setFieldValues(filtered);
    } else {
      setFieldValues({});
    }
  };

  const handleCancelEdit = () => {
    setEditingSelectionId(null);
    setSelectedTypeId(componentTypes[0]?.id ?? "");
    setLabel("");
    setFieldValues({});
    setShowAdvanced(false);
    setClientError(null);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
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
    setClientError(null);
  };

  // ── Shared Sage Ease input class ────────────────────────────────────────────
  const inputClass =
    "w-full rounded-sm border border-border bg-bg-white px-3.5 py-2.5 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary/30";

  const activeError = clientError ?? createState.error ?? updateState.error;

  return (
    <>
      <LoadingOverlay visible={isPending} />

      {/* 3-column grid layout matching the finalized mockup */}
      <div className="grid grid-cols-[200px_1fr_300px] gap-6 p-7">

        {/* ── Left: ComponentType sidebar ──────────────────────────────────── */}
        <div>
          <p className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
            Components
          </p>
          <div className="flex flex-col gap-1">
            {componentTypes.map((ct) => {
              const isSelected = ct.id === selectedTypeId;
              return (
                <button
                  key={ct.id}
                  type="button"
                  onClick={() => handleTypeChange(ct.id)}
                  className={[
                    "w-full rounded-sm px-3 py-2.5 text-left text-sm font-bold transition-colors",
                    isSelected
                      ? "bg-primary text-text-on-primary"
                      : editingSelectionId !== null
                        ? "cursor-default text-text-muted opacity-60"
                        : "text-text-body hover:bg-primary-softer hover:text-text-heading",
                  ].join(" ")}
                  disabled={editingSelectionId !== null && !isSelected}
                  aria-pressed={isSelected}
                >
                  {ct.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Center: Add / Edit form ──────────────────────────────────────── */}
        <div>
          {selectedType && (
            <h2 className="mb-5 text-lg font-extrabold text-text-heading">
              {editingSelectionId !== null
                ? `Edit ${selectedType.name}`
                : `Configure ${selectedType.name}`}
            </h2>
          )}

          {activeError && (
            <div className="mb-4 rounded-sm border border-red-300 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{activeError}</p>
            </div>
          )}

          <form
            action={editingSelectionId !== null ? updateFormAction : createFormAction}
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            {/* Hidden context fields */}
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="componentTypeId" value={selectedTypeId} />
            <input type="hidden" name="orderIndex" value={String(orderIndex)} />
            <input type="hidden" name="config" value={configJson} />
            {editingSelectionId !== null && (
              <input type="hidden" name="selectionId" value={editingSelectionId} />
            )}

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

            {/* Basic fields (always visible when a type is selected) */}
            {selectedType && basicFields.length > 0 && (
              <div className="flex flex-col gap-4">
                {basicFields.map((field) => (
                  <FieldInput
                    key={field.key}
                    field={field}
                    value={fieldValues[field.key]}
                    onChange={(val) => updateField(field.key, val)}
                  />
                ))}
              </div>
            )}

            {/* Configure button — only when advanced fields exist */}
            {selectedType && advancedFields.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  className="self-start rounded-sm border border-border bg-bg-white px-4 py-2 text-sm font-bold text-text-body hover:bg-primary-softer hover:text-text-heading"
                >
                  {showAdvanced ? "Hide Advanced" : `⚙️ Configure`}
                </button>

                {showAdvanced && (
                  <div className="flex flex-col gap-4 rounded-sm border border-border bg-bg-page p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-text-placeholder">
                      {t("advancedFields")}
                    </p>
                    {advancedFields.map((field) => (
                      <FieldInput
                        key={field.key}
                        field={field}
                        value={fieldValues[field.key]}
                        onChange={(val) => updateField(field.key, val)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={isPending}
                className="rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
              >
                {editingSelectionId !== null ? "Save Changes" : t("submitAdd")}
              </button>

              {editingSelectionId !== null && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-sm font-bold text-text-muted underline-offset-2 hover:underline"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* ── Right: Saved Components list ─────────────────────────────────── */}
        <div>
          <p className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
            Saved Components
          </p>

          {selections.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-8 text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary-softer text-primary">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                </svg>
              </div>
              <p className="text-sm font-bold text-text-heading">
                {t("noSelections")}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Configure and add a component to see it here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {selections.map((sel) => {
                const isEditing = sel.id === editingSelectionId;
                return (
                  <button
                    key={sel.id}
                    type="button"
                    onClick={() => handleEditSelection(sel)}
                    className={[
                      "w-full rounded-sm border px-3 py-2.5 text-left transition-colors",
                      isEditing
                        ? "border-primary bg-primary-softer"
                        : "border-border bg-bg-white hover:border-primary/40 hover:bg-primary-softer/50",
                    ].join(" ")}
                  >
                    <p className="text-sm font-bold text-text-heading leading-tight">
                      {sel.label}
                    </p>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {sel.componentType.name}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
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
