"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { SelectField } from "@/components/select-field";
import { createSuperAdminComponentType } from "./actions";
import { validateFieldsSchema } from "@/lib/validate-fields-schema";
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

// ─── FieldRow ─────────────────────────────────────────────────────────────────

function FieldRow({
  globalIndex,
  sectionPos,
  sectionLength,
  entry,
  dependsOnOptions,
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
  /** Fields earlier than this one in the full array, filtered to dropdown/radio — the eligible `dependsOn` targets. */
  dependsOnOptions: { key: string; label: string }[];
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
    dependsOnLabel: string;
    dependsOnNone: string;
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

  const isChoiceType = entry.type === "radio" || entry.type === "dropdown";

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
              // dependsOn only makes sense on dropdown/radio (a value list to narrow) —
              // clear it when switching to a type that has none.
              if (newType !== "dropdown" && newType !== "radio") {
                delete updated.dependsOn;
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

      {/* Row 2: dependsOn wiring (radio/dropdown only) — values are authored by the
          org admin on the Catalog screen, not here (Stage 20). */}
      {isChoiceType && (
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
            {labels.dependsOnLabel}
          </label>
          <SelectField
            value={entry.dependsOn ?? ""}
            onChange={(e) =>
              onChange({ ...entry, dependsOn: e.target.value || undefined })
            }
            className={inputBase}
          >
            <option value="">{labels.dependsOnNone}</option>
            {dependsOnOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label || opt.key}
              </option>
            ))}
          </SelectField>
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
  onMoveBlocked,
  fieldRowLabels,
  addFieldLabel,
}: {
  sectionLabel: string;
  isBasic: boolean;
  fields: FieldEntry[];
  onFieldsChange: (updated: FieldEntry[]) => void;
  /** Called with a human-readable reason when a move is blocked instead of applied. */
  onMoveBlocked: (message: string) => void;
  fieldRowLabels: Parameters<typeof FieldRow>[0]["labels"];
  addFieldLabel: string;
}) {
  const sectionEntries = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.basic === isBasic);

  /**
   * Reorder guard (Stage 20 Batch 2, developer's call — see item-B2-plan.md):
   * a move is blocked, not applied, if it would put a dependent field before
   * its own `dependsOn` target or a parent before a field that depends on it.
   * `moveFieldInSection` swaps two array elements directly, so re-validating
   * the whole candidate array (not just the two moved entries) is the correct
   * check — fields with a different `basic` value sitting between the two
   * swapped positions can also have their relative order affected.
   */
  const attemptMove = (globalIndex: number, direction: "up" | "down") => {
    const candidate = moveFieldInSection(fields, globalIndex, direction);
    if (candidate === fields) return; // already at the edge — no-op
    const result = validateFieldsSchema(candidate);
    if (!result.valid) {
      onMoveBlocked(`Can't reorder — ${result.error}`);
      return;
    }
    onFieldsChange(candidate);
  };

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
              dependsOnOptions={fields
                .slice(0, i)
                .filter((other) => other.type === "dropdown" || other.type === "radio")
                .map((other) => ({ key: other.key, label: other.label }))}
              onChange={(updated) =>
                onFieldsChange(fields.map((x, xi) => (xi === i ? updated : x)))
              }
              onRemove={() => onFieldsChange(fields.filter((_, xi) => xi !== i))}
              onMoveUp={() => attemptMove(i, "up")}
              onMoveDown={() => attemptMove(i, "down")}
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
  const entries = (parsed as unknown[])
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
      if (obj.hint) {
        entry.hint = String(obj.hint);
      }
      if (obj.dependsOn !== undefined && obj.dependsOn !== null && obj.dependsOn !== "") {
        entry.dependsOn = String(obj.dependsOn);
      }
      // Stage 20: `options` is no longer accepted here at all. Carried through
      // (rather than silently dropped) purely so validateFieldsSchema below can
      // surface a clear rejection message — it is never returned past this point.
      if (obj.options !== undefined) {
        entry.options = Array.isArray(obj.options)
          ? (obj.options as unknown[]).map(String)
          : [];
      }
      return entry;
    })
    .filter((x): x is FieldEntry => x !== null);

  const result = validateFieldsSchema(entries);
  if (!result.valid) throw new Error(result.error);

  return entries;
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
    dependsOnLabel: string;
    dependsOnNone: string;
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
  const [moveWarning, setMoveWarning] = useState<string | null>(null);

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
    dependsOnLabel: labels.dependsOnLabel,
    dependsOnNone: labels.dependsOnNone,
    fieldHint: labels.fieldHint,
    requiredLabel: labels.fieldRequiredLabel,
    moveUp: labels.moveUp,
    moveDown: labels.moveDown,
    removeLabel: labels.removeFieldLabel,
  };

  // Clears any stale reorder-blocked warning whenever the field list changes
  // through any path other than a blocked move (add/remove/edit/successful move).
  const handleFieldsChange = (updated: FieldEntry[]) => {
    setMoveWarning(null);
    setFields(updated);
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
              onFieldsChange={handleFieldsChange}
              onMoveBlocked={setMoveWarning}
              fieldRowLabels={fieldRowLabels}
              addFieldLabel={labels.addFieldLabel}
            />
            <SectionEditor
              sectionLabel={labels.sectionAdvanced}
              isBasic={false}
              fields={fields}
              onFieldsChange={handleFieldsChange}
              onMoveBlocked={setMoveWarning}
              fieldRowLabels={fieldRowLabels}
              addFieldLabel={labels.addFieldLabel}
            />
            {moveWarning && (
              <p className="text-xs text-status-failed-text">{moveWarning}</p>
            )}
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
