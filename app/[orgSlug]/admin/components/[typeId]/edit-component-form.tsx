"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { LoadingOverlay } from "@/components/loading-overlay";
import { updateComponentType } from "../actions";
import type { FieldEntry } from "@/lib/data/components";

// ─── Inner status helpers ─────────────────────────────────────────────────────

function PendingOverlay() {
  const { pending } = useFormStatus();
  return <LoadingOverlay visible={pending} />;
}

function SubmitButton({ label, disabled: extraDisabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || extraDisabled}
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {label}
    </button>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldEntry["type"][] = ["field", "radio", "dropdown", "checkbox"];

// ─── Move helper ──────────────────────────────────────────────────────────────

/**
 * Swap a field with its adjacent neighbour *within the same section* (basic/advanced).
 * The flat array order is preserved; only same-section entries are considered.
 */
function moveFieldInSection(
  fields: FieldEntry[],
  globalIndex: number,
  direction: "up" | "down",
): FieldEntry[] {
  const isBasic = fields[globalIndex].basic;
  const sectionIndices = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.basic === isBasic)
    .map(({ i }) => i);

  const posInSection = sectionIndices.indexOf(globalIndex);

  if (direction === "up" && posInSection > 0) {
    const swapWith = sectionIndices[posInSection - 1];
    const next = [...fields];
    [next[globalIndex], next[swapWith]] = [next[swapWith], next[globalIndex]];
    return next;
  }
  if (direction === "down" && posInSection < sectionIndices.length - 1) {
    const swapWith = sectionIndices[posInSection + 1];
    const next = [...fields];
    [next[globalIndex], next[swapWith]] = [next[swapWith], next[globalIndex]];
    return next;
  }
  return fields;
}

// ─── OptionsBuilder ───────────────────────────────────────────────────────────

function OptionsBuilder({
  options,
  onChange,
  addOptionLabel,
}: {
  options: string[];
  onChange: (updated: string[]) => void;
  addOptionLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const inputBase =
    "rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50";

  const addOption = () => {
    const trimmed = draft.trim();
    if (trimmed && !options.includes(trimmed)) {
      onChange([...options, trimmed]);
    }
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {options.map((opt, oi) => (
            <span
              key={oi}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
            >
              {opt}
              <button
                type="button"
                onClick={() => onChange(options.filter((_, i) => i !== oi))}
                className="ml-0.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400"
                aria-label={`Remove option ${opt}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOption();
            }
          }}
          placeholder="Option text…"
          className={inputBase + " flex-1"}
        />
        <button
          type="button"
          onClick={addOption}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500"
        >
          {addOptionLabel}
        </button>
      </div>
    </div>
  );
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────

function FieldRow({
  globalIndex,
  sectionPos,
  sectionLength,
  entry,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  labels,
}: {
  globalIndex: number;
  sectionPos: number;
  sectionLength: number;
  entry: FieldEntry;
  onChange: (updated: FieldEntry) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  labels: {
    keyLabel: string;
    labelLabel: string;
    typeLabel: string;
    fieldTypeField: string;
    fieldTypeRadio: string;
    fieldTypeDropdown: string;
    fieldTypeCheckbox: string;
    fieldOptions: string;
    addOption: string;
    fieldHint: string;
    requiredLabel: string;
    moveUp: string;
    moveDown: string;
    removeLabel: string;
  };
}) {
  const inputBase =
    "rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50";

  const typeLabels: Record<FieldEntry["type"], string> = {
    field: labels.fieldTypeField,
    radio: labels.fieldTypeRadio,
    dropdown: labels.fieldTypeDropdown,
    checkbox: labels.fieldTypeCheckbox,
  };

  const needsOptions = entry.type === "radio" || entry.type === "dropdown";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
      {/* Row 1: key, label, type, move/remove */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {labels.keyLabel}
          </label>
          <input
            type="text"
            value={entry.key}
            onChange={(e) => onChange({ ...entry, key: e.target.value })}
            placeholder={`field_${globalIndex + 1}`}
            className={inputBase}
          />
        </div>
        <div className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {labels.labelLabel}
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
            {labels.typeLabel}
          </label>
          <select
            value={entry.type}
            onChange={(e) => {
              const newType = e.target.value as FieldEntry["type"];
              const updated: FieldEntry = { ...entry, type: newType };
              // Seed options when switching to a type that requires them
              if ((newType === "radio" || newType === "dropdown") && !updated.options) {
                updated.options = [];
              }
              // Clear options when switching away from option-requiring types
              if (newType !== "radio" && newType !== "dropdown") {
                delete updated.options;
              }
              onChange(updated);
            }}
            className={inputBase}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabels[t]}
              </option>
            ))}
          </select>
        </div>
        {/* Move and remove buttons */}
        <div className="flex items-end gap-1 self-end">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={sectionPos === 0}
            aria-label={labels.moveUp}
            title={labels.moveUp}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={sectionPos === sectionLength - 1}
            aria-label={labels.moveDown}
            title={labels.moveDown}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-500 hover:border-red-200 hover:text-red-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:text-red-400"
          >
            {labels.removeLabel}
          </button>
        </div>
      </div>

      {/* Row 2: options builder (radio/dropdown only) */}
      {needsOptions && (
        <div className="flex flex-col gap-0.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {labels.fieldOptions}
          </label>
          <OptionsBuilder
            options={entry.options ?? []}
            onChange={(opts) => onChange({ ...entry, options: opts })}
            addOptionLabel={labels.addOption}
          />
        </div>
      )}

      {/* Row 3: hint, required, core */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {labels.fieldHint}
          </label>
          <input
            type="text"
            value={entry.hint ?? ""}
            onChange={(e) =>
              onChange({ ...entry, hint: e.target.value || undefined })
            }
            placeholder="Helper text (optional)"
            className={inputBase + " text-xs"}
          />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {labels.requiredLabel}
          </label>
          <input
            type="checkbox"
            checked={entry.required}
            onChange={(e) => onChange({ ...entry, required: e.target.checked })}
            className="mt-1.5 h-4 w-4 rounded border-zinc-300 text-zinc-900 dark:border-zinc-600"
          />
        </div>
      </div>
    </div>
  );
}

// ─── SectionEditor ────────────────────────────────────────────────────────────

function SectionEditor({
  sectionLabel,
  isBasic,
  fields,
  onFieldsChange,
  fieldRowLabels,
  addFieldLabel,
}: {
  sectionLabel: string;
  isBasic: boolean;
  fields: FieldEntry[];
  onFieldsChange: (updated: FieldEntry[]) => void;
  fieldRowLabels: Parameters<typeof FieldRow>[0]["labels"];
  addFieldLabel: string;
}) {
  const sectionEntries = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.basic === isBasic);

  const addField = () => {
    onFieldsChange([
      ...fields,
      {
        key: "",
        label: "",
        type: "field",
        required: false,
        basic: isBasic,
      },
    ]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          {sectionLabel}
        </span>
        <button
          type="button"
          onClick={addField}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
        >
          + {addFieldLabel}
        </button>
      </div>
      {sectionEntries.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 px-4 py-3 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          No fields yet — click &quot;+ {addFieldLabel}&quot; to add one.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sectionEntries.map(({ f, i }, posInSection) => (
            <FieldRow
              key={i}
              globalIndex={i}
              sectionPos={posInSection}
              sectionLength={sectionEntries.length}
              entry={f}
              onChange={(updated) =>
                onFieldsChange(fields.map((x, xi) => (xi === i ? updated : x)))
              }
              onRemove={() => onFieldsChange(fields.filter((_, xi) => xi !== i))}
              onMoveUp={() => onFieldsChange(moveFieldInSection(fields, i, "up"))}
              onMoveDown={() => onFieldsChange(moveFieldInSection(fields, i, "down"))}
              labels={fieldRowLabels}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── JSON mode helpers ────────────────────────────────────────────────────────

/**
 * Thrown by validateJsonText when JSON.parse itself fails (syntax error).
 * Distinguishable from shape-validation errors in the catch block.
 */
class JsonParseError extends Error {}

/**
 * Client-side strict validation that mirrors the write-path parseFieldsSchema in actions.ts.
 * Runs when the user switches from JSON mode back to Form mode — gives immediate, specific
 * feedback without a round-trip.
 *
 * Throws JsonParseError on bad JSON, plain Error on valid-JSON-but-wrong-shape.
 * Returns a correctly-typed FieldEntry[] on success.
 */
function validateJsonText(text: string): FieldEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new JsonParseError((e as SyntaxError).message);
  }
  if (!Array.isArray(parsed)) throw new Error("Schema must be a JSON array.");
  const validTypes = new Set(["field", "radio", "dropdown", "checkbox"]);
  const optionRequiredTypes = new Set(["radio", "dropdown"]);
  return (parsed as unknown[])
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const obj = item as Record<string, unknown>;
      const type = (validTypes.has(obj.type as string)
        ? obj.type
        : "field") as FieldEntry["type"];
      const entry: FieldEntry = {
        key: String(obj.key ?? ""),
        label: String(obj.label ?? ""),
        type,
        required: Boolean(obj.required),
        basic: obj.basic !== undefined ? Boolean(obj.basic) : true,
      };
      if (optionRequiredTypes.has(type)) {
        const opts = Array.isArray(obj.options)
          ? (obj.options as unknown[]).map(String).filter(Boolean)
          : [];
        if (opts.length === 0) {
          throw new Error(
            `Field "${String(obj.label ?? obj.key ?? type)}": ${type} type requires at least one option.`,
          );
        }
        entry.options = opts;
      }
      if (obj.hint) {
        entry.hint = String(obj.hint);
      }
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);
}

// ─── Main component ───────────────────────────────────────────────────────────

interface EditComponentFormProps {
  orgSlug: string;
  typeId: string;
  initialName: string;
  initialCategoryId: string;
  initialActive: boolean;
  initialFields: FieldEntry[];
  categories: { id: string; name: string }[];
  labels: {
    fieldNameLabel: string;
    fieldCategoryLabel: string;
    fieldStatusLabel: string;
    fieldsSchemaLabel: string;
    sectionBasic: string;
    sectionAdvanced: string;
    addFieldLabel: string;
    removeFieldLabel: string;
    fieldKeyLabel: string;
    fieldLabelLabel: string;
    fieldTypeLabel: string;
    fieldTypeField: string;
    fieldTypeRadio: string;
    fieldTypeDropdown: string;
    fieldTypeCheckbox: string;
    fieldOptions: string;
    addOption: string;
    fieldHint: string;
    fieldRequiredLabel: string;
    moveUp: string;
    moveDown: string;
    submitLabel: string;
    fieldCategoryPlaceholder: string;
    modeForm: string;
    modeJson: string;
    jsonErrorBadJson: string;
    jsonErrorBadShape: string;
  };
}

/**
 * Edit-ComponentType form (Client Component).
 *
 * Pre-populated with the existing field schema from the server.
 * Fields are stored in a flat array; the UI splits them into Basic / Advanced
 * sections by the `basic` boolean on each entry.
 * Serialises the fields array to JSON in a hidden input before submission.
 */
export function EditComponentForm({
  orgSlug,
  typeId,
  initialName,
  initialCategoryId,
  initialActive,
  initialFields,
  categories,
  labels,
}: EditComponentFormProps) {
  const [fields, setFields] = useState<FieldEntry[]>(initialFields);
  const [active, setActive] = useState(initialActive);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const switchToJson = () => {
    if (mode !== "json") {
      setJsonText(JSON.stringify(fields, null, 2));
      setJsonError(null);
      setMode("json");
    }
  };

  const switchToForm = () => {
    if (mode === "json") {
      try {
        const validated = validateJsonText(jsonText);
        setFields(validated);
        setJsonError(null);
        setMode("form");
      } catch (e) {
        const msg = (e as Error).message;
        if (e instanceof JsonParseError) {
          setJsonError(labels.jsonErrorBadJson + " " + msg);
        } else {
          setJsonError(labels.jsonErrorBadShape + " " + msg);
        }
      }
    }
  };

  const fieldRowLabels = {
    keyLabel: labels.fieldKeyLabel,
    labelLabel: labels.fieldLabelLabel,
    typeLabel: labels.fieldTypeLabel,
    fieldTypeField: labels.fieldTypeField,
    fieldTypeRadio: labels.fieldTypeRadio,
    fieldTypeDropdown: labels.fieldTypeDropdown,
    fieldTypeCheckbox: labels.fieldTypeCheckbox,
    fieldOptions: labels.fieldOptions,
    addOption: labels.addOption,
    fieldHint: labels.fieldHint,
    requiredLabel: labels.fieldRequiredLabel,
    moveUp: labels.moveUp,
    moveDown: labels.moveDown,
    removeLabel: labels.removeFieldLabel,
  };

  return (
    <form action={updateComponentType} className="flex flex-col gap-5">
      <PendingOverlay />

      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="typeId" value={typeId} />
      <input type="hidden" name="active" value={String(active)} />
      {/* Serialised field list — React keeps this in sync with state */}
      <input type="hidden" name="fieldsSchema" value={JSON.stringify(fields)} />

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
          defaultValue={initialName}
          autoComplete="off"
          className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:ring-zinc-50"
        />
      </div>

      {/* Category */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="categoryId"
          className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        >
          {labels.fieldCategoryLabel}
        </label>
        <select
          id="categoryId"
          name="categoryId"
          required
          defaultValue={initialCategoryId}
          className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
        >
          <option value="" disabled>
            {labels.fieldCategoryPlaceholder}
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Active toggle */}
      <div className="flex items-center gap-2">
        <input
          id="activeToggle"
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-zinc-900 dark:border-zinc-600"
        />
        <label
          htmlFor="activeToggle"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {labels.fieldStatusLabel}
        </label>
      </div>

      {/* Field list editor — Basic / Advanced sections, with Form / JSON toggle */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {labels.fieldsSchemaLabel}
          </span>
          {/* Form / JSON view toggle */}
          <div className="flex text-xs font-medium">
            <button
              type="button"
              onClick={switchToForm}
              className={`rounded-l-md border px-2.5 py-1 ${
                mode === "form"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
              }`}
            >
              {labels.modeForm}
            </button>
            <button
              type="button"
              onClick={switchToJson}
              className={`rounded-r-md border-b border-r border-t px-2.5 py-1 ${
                mode === "json"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-zinc-50"
              }`}
            >
              {labels.modeJson}
            </button>
          </div>
        </div>

        {mode === "form" ? (
          <>
            <SectionEditor
              sectionLabel={labels.sectionBasic}
              isBasic={true}
              fields={fields}
              onFieldsChange={setFields}
              fieldRowLabels={fieldRowLabels}
              addFieldLabel={labels.addFieldLabel}
            />
            <SectionEditor
              sectionLabel={labels.sectionAdvanced}
              isBasic={false}
              fields={fields}
              onFieldsChange={setFields}
              fieldRowLabels={fieldRowLabels}
              addFieldLabel={labels.addFieldLabel}
            />
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                setJsonError(null);
              }}
              rows={20}
              spellCheck={false}
              className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-zinc-50"
            />
            {jsonError && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{jsonError}</p>
            )}
          </div>
        )}
      </div>

      {mode === "json" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Switch to Form mode to save.
        </p>
      )}
      <SubmitButton label={labels.submitLabel} disabled={mode === "json"} />
    </form>
  );
}
