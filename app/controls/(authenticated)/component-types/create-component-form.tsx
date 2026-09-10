"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { SelectField } from "@/components/select-field";
import { createSuperAdminComponentType } from "./actions";
import type { FieldEntry } from "@/lib/types/field-entry";

// ─── Inner status helpers ─────────────────────────────────────────────────────

/**
 * Deliberately does NOT use the shared @/components/loading-overlay — that
 * component calls next-intl's useTranslations() and requires a
 * NextIntlClientProvider ancestor. The /controls console has no such
 * provider, so using it here throws on mount and crashes to
 * app/global-error.tsx (same failure mode as the Stage 16 post-deploy bug,
 * 2026-09-02 — see app/controls/(authenticated)/roles/permission-toggle-button.tsx
 * for the original fix this mirrors; Stage 19 test-fix batch 1 fixes the
 * reintroduction of it here).
 */
function PendingOverlay() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50"
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white"
      />
      <p className="mt-3 text-sm font-medium text-white">Loading…</p>
    </div>
  );
}

function SubmitButton({ label, disabled: extraDisabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || extraDisabled}
      className="inline-flex items-center rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-50"
    >
      {label}
    </button>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldEntry["type"][] = ["field", "dropdown", "checkbox"];

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
    "rounded-sm border border-border bg-bg-white px-2 py-1 text-xs text-text-body focus:outline-none focus:ring-2 focus:ring-primary-soft focus:border-primary-soft";

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
              className="inline-flex items-center gap-1 rounded-pill bg-primary-softer px-2 py-0.5 text-xs text-primary-dark"
            >
              {opt}
              <button
                type="button"
                onClick={() => onChange(options.filter((_, i) => i !== oi))}
                className="ml-0.5 text-text-muted hover:text-status-failed-text"
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
          className="rounded-sm border border-border px-2 py-1 text-xs font-bold text-text-body hover:border-primary-soft hover:bg-primary-softer"
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
    "rounded-sm border border-border bg-bg-white px-2 py-1.5 text-sm text-text-body focus:outline-none focus:ring-2 focus:ring-primary-soft focus:border-primary-soft";

  const typeLabels: Record<FieldEntry["type"], string> = {
    field: labels.fieldTypeField,
    radio: labels.fieldTypeRadio,
    dropdown: labels.fieldTypeDropdown,
    checkbox: labels.fieldTypeCheckbox,
  };

  const needsOptions = entry.type === "radio" || entry.type === "dropdown";

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border bg-bg-page px-3 py-2.5">
      {/* Row 1: key, label, type, move/remove */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[8rem] flex-1 flex-col gap-0.5">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
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
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
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
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {labels.typeLabel}
          </label>
          <SelectField
            value={entry.type}
            onChange={(e) => {
              const newType = e.target.value as FieldEntry["type"];
              const updated: FieldEntry = { ...entry, type: newType };
              // Seed options when switching to dropdown type
              if (newType === "dropdown" && !updated.options) {
                updated.options = [];
              }
              // Clear options when switching away from dropdown
              if (newType !== "dropdown") {
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
          </SelectField>
        </div>
        {/* Move and remove buttons */}
        <div className="flex items-end gap-1 self-end">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={sectionPos === 0}
            aria-label={labels.moveUp}
            title={labels.moveUp}
            className="rounded-sm border border-border px-2 py-1.5 text-xs font-bold text-text-muted hover:border-primary-soft hover:text-text-heading disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={sectionPos === sectionLength - 1}
            aria-label={labels.moveDown}
            title={labels.moveDown}
            className="rounded-sm border border-border px-2 py-1.5 text-xs font-bold text-text-muted hover:border-primary-soft hover:text-text-heading disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-sm border border-border px-2 py-1.5 text-xs font-bold text-text-muted hover:border-status-failed-bg hover:text-status-failed-text"
          >
            {labels.removeLabel}
          </button>
        </div>
      </div>

      {/* Row 2: options builder (radio/dropdown only) */}
      {needsOptions && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {labels.fieldOptions}
          </label>
          <OptionsBuilder
            options={entry.options ?? []}
            onChange={(opts) => onChange({ ...entry, options: opts })}
            addOptionLabel={labels.addOption}
          />
        </div>
      )}

      {/* Row 3: hint, required */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
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
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {labels.requiredLabel}
          </label>
          <input
            type="checkbox"
            checked={entry.required}
            onChange={(e) => onChange({ ...entry, required: e.target.checked })}
            className="mt-1.5 h-4 w-4 rounded border-border accent-primary"
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
        <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
          {sectionLabel}
        </span>
        <button
          type="button"
          onClick={addField}
          className="rounded-sm border border-border px-2.5 py-1 text-xs font-bold text-text-body hover:border-primary-soft hover:bg-primary-softer"
        >
          + {addFieldLabel}
        </button>
      </div>
      {sectionEntries.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border px-4 py-3 text-xs text-text-placeholder italic">
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

class JsonParseError extends Error {}

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

interface CreateComponentFormProps {
  /** Organization ID (SuperAdmin context — explicit, not from session). */
  orgId: string;
  categories: { id: string; name: string }[];
  labels: {
    fieldCodeLabel: string;
    fieldCodeHint: string;
    fieldNameLabel: string;
    fieldCategoryLabel: string;
    fieldCategoryPlaceholder: string;
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
    fieldStatusLabel: string;
    submitLabel: string;
    modeForm: string;
    modeJson: string;
    jsonErrorBadJson: string;
    jsonErrorBadShape: string;
  };
}

/**
 * Create-ComponentType form (Client Component) — SuperAdmin console version.
 *
 * Moved from app/[orgSlug]/admin/components/new/create-component-form.tsx to
 * app/controls/(authenticated)/component-types/ in Stage 19 Batch 5.
 * Key difference: takes `orgId` instead of `orgSlug`; submits to
 * `createSuperAdminComponentType` (SuperAdmin API) instead of the org-scoped action.
 */
export function CreateComponentForm({ orgId, categories, labels }: CreateComponentFormProps) {
  const [fields, setFields] = useState<FieldEntry[]>([]);
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

  const inputBase =
    "rounded-sm border border-border bg-bg-white px-3 py-2 text-sm text-text-body placeholder:text-text-placeholder focus:outline-none focus:ring-2 focus:ring-primary-soft focus:border-primary-soft";

  return (
    <form action={createSuperAdminComponentType} className="flex flex-col gap-5">
      <PendingOverlay />

      {/* orgId identifies the org (SuperAdmin context — not from session). */}
      <input type="hidden" name="orgId" value={orgId} />
      {/* Serialised field list — React keeps this in sync with state */}
      <input type="hidden" name="fieldsSchema" value={JSON.stringify(fields)} />

      {/* Code */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="code"
          className="text-[10px] font-bold uppercase tracking-wide text-text-muted"
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
          className={inputBase}
        />
        <p className="text-xs text-text-placeholder">{labels.fieldCodeHint}</p>
      </div>

      {/* Name */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="name"
          className="text-[10px] font-bold uppercase tracking-wide text-text-muted"
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
          className={inputBase}
        />
      </div>

      {/* Category */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="categoryId"
          className="text-[10px] font-bold uppercase tracking-wide text-text-muted"
        >
          {labels.fieldCategoryLabel}
        </label>
        <SelectField
          id="categoryId"
          name="categoryId"
          required
          defaultValue=""
          className={inputBase}
          placeholder={labels.fieldCategoryPlaceholder}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </div>

      {/* Field list editor — Basic / Advanced sections, with Form / JSON toggle */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {labels.fieldsSchemaLabel}
          </span>
          <div className="flex text-xs font-bold">
            <button
              type="button"
              onClick={switchToForm}
              className={`rounded-l-sm border px-2.5 py-1 ${
                mode === "form"
                  ? "border-primary bg-primary text-text-on-primary"
                  : "border-border text-text-body hover:border-primary-soft hover:bg-primary-softer"
              }`}
            >
              {labels.modeForm}
            </button>
            <button
              type="button"
              onClick={switchToJson}
              className={`rounded-r-sm border-b border-r border-t px-2.5 py-1 ${
                mode === "json"
                  ? "border-primary bg-primary text-text-on-primary"
                  : "border-border text-text-body hover:border-primary-soft hover:bg-primary-softer"
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
              className="w-full rounded-sm border border-border bg-bg-page px-3 py-2 font-mono text-xs text-text-body focus:outline-none focus:ring-2 focus:ring-primary-soft focus:border-primary-soft"
            />
            {jsonError && (
              <p className="mt-1 text-sm text-status-failed-text">{jsonError}</p>
            )}
          </div>
        )}
      </div>

      {mode === "json" && (
        <p className="text-xs text-text-muted">
          Switch to Form mode to save.
        </p>
      )}
      <SubmitButton label={labels.submitLabel} disabled={mode === "json"} />
    </form>
  );
}
