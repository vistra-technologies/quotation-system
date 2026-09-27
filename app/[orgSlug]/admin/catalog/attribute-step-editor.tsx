"use client";

import { useState } from "react";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  emptyGroups,
  findAttr,
  kids,
  listFor,
  parentValuesOf,
  removalImpact,
  valuesOf,
  type RemovalImpactEntry,
} from "./catalog-model";

const ALL_KEY = "__all__";
const NEW_KEY = "__new__";

interface AttributeStepEditorProps {
  fieldsSchema: FieldEntry[];
  fieldKey: string;
  draftConfig: FieldOptionsConfig;
  searchQuery: string;
  /** Replaces the whole draft config — the modal re-syncs and marks the session dirty. */
  onChange: (nextConfig: FieldOptionsConfig) => void;
}

/**
 * Renders the body for *one* currently-open field within the option editor modal: chip lists (one
 * per parent value for a dependent field, or one flat list), add/remove/rename, "add to all
 * groups," reuse/suggestion chips, the in-editor filter, and the removal-impact confirmation.
 *
 * Mounted with `key={fieldKey}` by `AttributeEditorModal` so this component's local, ephemeral UI
 * state (which chip is being renamed, the frozen "new parent values" list, the filter text,
 * per-group inline errors) naturally resets when the flow advances to the next field — the
 * direct translation of the mockup rebuilding `ed` fresh on every `openEditor()` call.
 *
 * Ported from the mockup's `renderEditor`/`doAdd`/`doRemove`/`doRename`/`removalImpact` (see
 * `design-docs/mockups/catalog-page-poc.html`).
 */
export function AttributeStepEditor({
  fieldsSchema,
  fieldKey,
  draftConfig,
  searchQuery,
  onChange,
}: AttributeStepEditorProps) {
  const field = findAttr(fieldsSchema, fieldKey) as FieldEntry;
  const parent = field.dependsOn ? findAttr(fieldsSchema, field.dependsOn) : null;
  const grandparent = parent?.dependsOn ? findAttr(fieldsSchema, parent.dependsOn) : null;
  const children = kids(fieldsSchema, field.key);

  // Frozen at mount (this component remounts on every step change via key={fieldKey}) — which
  // parent values arrived empty when this step opened, per the mockup's `ed.newKeys`.
  const [newKeysAtOpen] = useState(() => emptyGroups(fieldsSchema, draftConfig, field));
  const [showAll, setShowAll] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [editingChip, setEditingChip] = useState<{ groupKey: string | null; value: string } | null>(null);
  const [renameText, setRenameText] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRemoval, setPendingRemoval] = useState<{
    groupKey: string | null;
    value: string;
    impact: RemovalImpactEntry[];
    after: FieldOptionsConfig;
  } | null>(null);

  const q = searchQuery.trim().toLowerCase();

  function groupInputKey(groupKey: string | null) {
    return groupKey === null ? "flat" : groupKey;
  }

  function doAdd(groupKey: string | null | typeof ALL_KEY | typeof NEW_KEY, raw: string) {
    const v = raw.trim();
    if (!v) return;
    setErrors({});

    if (groupKey === ALL_KEY || groupKey === NEW_KEY) {
      if (!parent) return;
      const keys = parentValuesOf(fieldsSchema, draftConfig, field);
      const targetKeys = groupKey === NEW_KEY ? keys.filter((k) => newKeysAtOpen.includes(k)) : keys;
      const entry = draftConfig[field.key];
      const valueMap = entry && "valueMap" in entry ? { ...entry.valueMap } : {};
      let added = 0;
      for (const k of targetKeys) {
        const list = valueMap[k] ?? [];
        if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) {
          valueMap[k] = [...list, v];
          added++;
        }
      }
      if (!added) {
        setErrors({ [groupKey]: `"${v}" is already in every list.` });
        return;
      }
      onChange({ ...draftConfig, [field.key]: { valueMap } });
      setInputs((prev) => ({ ...prev, [groupKey]: "" }));
      return;
    }

    const list = listFor(draftConfig, field, groupKey);
    if (list.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setErrors({ [groupInputKey(groupKey)]: `"${v}" already exists here.` });
      return;
    }
    const newList = [...list, v];
    if (groupKey === null) {
      onChange({ ...draftConfig, [field.key]: { options: newList } });
    } else {
      const entry = draftConfig[field.key];
      const valueMap = entry && "valueMap" in entry ? { ...entry.valueMap } : {};
      valueMap[groupKey] = newList;
      onChange({ ...draftConfig, [field.key]: { valueMap } });
    }
    setInputs((prev) => ({ ...prev, [groupInputKey(groupKey)]: "" }));
  }

  function requestRemove(groupKey: string | null, value: string) {
    const { after, impact } = removalImpact(fieldsSchema, draftConfig, field.key, groupKey, value);
    if (impact.length) {
      setPendingRemoval({ groupKey, value, impact, after });
      return;
    }
    onChange(after);
  }

  function confirmRemoval() {
    if (!pendingRemoval) return;
    onChange(pendingRemoval.after);
    setPendingRemoval(null);
  }

  function doRename(groupKey: string | null, oldValue: string, raw: string) {
    const v = raw.trim();
    setEditingChip(null);
    setErrors({});
    if (!v || v === oldValue) return;

    const list = listFor(draftConfig, field, groupKey);
    if (list.some((x) => x !== oldValue && x.toLowerCase() === v.toLowerCase())) {
      setErrors({ [groupInputKey(groupKey)]: `"${v}" already exists here.` });
      return;
    }
    const renamedList = list.map((x) => (x === oldValue ? v : x));
    const next: FieldOptionsConfig = { ...draftConfig };
    if (groupKey === null) {
      next[field.key] = { options: renamedList };
    } else {
      const entry = draftConfig[field.key];
      const valueMap = entry && "valueMap" in entry ? { ...entry.valueMap } : {};
      valueMap[groupKey] = renamedList;
      next[field.key] = { valueMap };
    }
    // Carry the renamed value's downstream lists across to the new name (direct children only —
    // sync() below propagates any further-downstream consequences).
    const stillThere = valuesOf(fieldsSchema, { ...draftConfig, [field.key]: next[field.key] }, field).includes(v);
    for (const child of children) {
      const childEntry = draftConfig[child.key];
      const childMap = childEntry && "valueMap" in childEntry ? { ...childEntry.valueMap } : {};
      const from = childMap[oldValue] ?? [];
      const to = [...(childMap[v] ?? [])];
      for (const x of from) if (!to.includes(x)) to.push(x);
      childMap[v] = to;
      if (!stillThere) delete childMap[oldValue];
      next[child.key] = { valueMap: childMap };
    }
    onChange(next);
  }

  function suggestionsFor(list: string[]): string[] {
    return valuesOf(fieldsSchema, draftConfig, field)
      .filter((v) => !list.includes(v))
      .slice(0, 6);
  }

  function renderChip(groupKey: string | null, value: string) {
    const isEditing = editingChip?.groupKey === groupKey && editingChip.value === value;
    const isHit = Boolean(q) && value.toLowerCase().includes(q);

    if (isEditing) {
      return (
        <span
          key={value}
          className="inline-flex items-center gap-0.5 rounded-lg border border-primary bg-bg-white py-1 pl-2.5 pr-2.5 shadow-[0_0_0_3px_var(--color-primary-softer)]"
        >
          <input
            autoFocus
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onBlur={() => doRename(groupKey, value, renameText)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingChip(null);
            }}
            aria-label={`Rename ${value}`}
            className="min-w-[40px] border-none bg-transparent p-0 text-[13.5px] font-semibold text-text-heading outline-none"
          />
        </span>
      );
    }

    return (
      <span
        key={value}
        className={`inline-flex items-center gap-0.5 rounded-lg border bg-bg-white py-1 pl-2.5 pr-1 text-[13.5px] font-semibold text-text-body ${
          isHit ? "border-[#D9B25F] shadow-[0_0_0_3px_var(--color-status-pending-bg)]" : "border-border"
        }`}
      >
        <span
          role="button"
          tabIndex={0}
          title="Click to rename"
          onClick={() => {
            setEditingChip({ groupKey, value });
            setRenameText(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditingChip({ groupKey, value });
              setRenameText(value);
            }
          }}
          className="cursor-text rounded px-0.5 outline-none"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => requestRemove(groupKey, value)}
          aria-label={`Remove ${value}`}
          className="flex h-5 w-5 items-center justify-center rounded-full text-base text-text-muted hover:bg-status-failed-bg hover:text-status-failed-text"
        >
          ×
        </button>
      </span>
    );
  }

  function renderList(groupKey: string | null, groupInputKeyStr: string) {
    const list = listFor(draftConfig, field, groupKey);
    return (
      <>
        <div className="flex flex-wrap gap-2">
          {list.map((v) => renderChip(groupKey, v))}
          {list.length === 0 && (
            <span className="py-1 text-[12.5px] font-semibold text-status-pending-text">
              No options yet — add at least one.
            </span>
          )}
        </div>
        <div className="mt-2.5 flex gap-2">
          <input
            type="text"
            value={inputs[groupInputKeyStr] ?? ""}
            onChange={(e) => setInputs((prev) => ({ ...prev, [groupInputKeyStr]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                doAdd(groupKey, inputs[groupInputKeyStr] ?? "");
              }
            }}
            placeholder="Add value…"
            aria-label="Add value"
            className="min-w-0 flex-1 max-w-[240px] rounded-lg border border-border bg-bg-white px-2.5 py-1.5 text-[13.5px] focus:border-primary-soft focus:outline-none focus:ring-2 focus:ring-primary-softer"
          />
          <button
            type="button"
            onClick={() => doAdd(groupKey, inputs[groupInputKeyStr] ?? "")}
            className="rounded-lg border border-border bg-bg-white px-3 py-1.5 text-[13px] font-bold text-text-body hover:border-primary-soft"
          >
            Add
          </button>
        </div>
        {errors[groupInputKeyStr] && (
          <div className="mt-1.5 text-[11.5px] font-bold text-status-failed-text">{errors[groupInputKeyStr]}</div>
        )}
      </>
    );
  }

  // ─── Flat field: a single list, no groups ────────────────────────────────
  if (!field.dependsOn) {
    return (
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="m-0 text-[15px] font-extrabold text-text-heading">{field.label}</h3>
          <span className="ml-auto text-[11.5px] font-bold text-text-muted">
            {valuesOf(fieldsSchema, draftConfig, field).length} distinct option
            {valuesOf(fieldsSchema, draftConfig, field).length === 1 ? "" : "s"}
          </span>
        </div>
        {renderList(null, "flat")}
        {children.length > 0 && (
          <p className="mt-3.5 border-t border-dashed border-border pt-3 text-xs text-text-muted">
            Feeds into <b className="text-text-heading">{children.map((c) => c.label).join(", ")}</b>. New
            values here get their own list there — <b className="text-text-heading">Next</b> takes you
            straight to it.
          </p>
        )}
        <RemovalConfirm pendingRemoval={pendingRemoval} onCancel={() => setPendingRemoval(null)} onConfirm={confirmRemoval} />
      </div>
    );
  }

  // ─── Dependent field: one list per currently-live parent value ───────────
  const keys = parentValuesOf(fieldsSchema, draftConfig, field);
  const newKeys = newKeysAtOpen.filter((k) => keys.includes(k));
  const focusNew = newKeys.length > 0 && !showAll;
  const shown = focusNew ? newKeys : keys;
  const filterActive = !focusNew ? filterText.trim().toLowerCase() : "";
  const visibleKeys = shown.filter((k) => !filterActive || k.toLowerCase().includes(filterActive));

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="m-0 text-[15px] font-extrabold text-text-heading">{field.label}</h3>
        <span className="ml-auto text-[11.5px] font-bold text-text-muted">
          {valuesOf(fieldsSchema, draftConfig, field).length} distinct option
          {valuesOf(fieldsSchema, draftConfig, field).length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mb-3 text-[12.5px] leading-relaxed text-text-muted">
        {focusNew ? (
          <>
            New <b className="text-text-heading">{parent?.label}</b> {newKeys.length === 1 ? "value needs" : "values need"}{" "}
            {field.label} options — fill {newKeys.length === 1 ? "its list" : "each list"} below.
          </>
        ) : (
          <>
            Options depend on <b className="text-text-heading">{parent?.label}</b> — each {parent?.label} value has
            its own list below.
          </>
        )}
      </p>

      {shown.length > 1 && (
        <div className="mb-3 flex flex-wrap items-end gap-2.5 rounded-xl bg-bg-page p-3">
          <div className="flex-1 basis-[280px]">
            <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">
              {focusNew ? `Add to all new ${parent?.label} values` : `Add to every ${parent?.label}`}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputs[focusNew ? NEW_KEY : ALL_KEY] ?? ""}
                onChange={(e) =>
                  setInputs((prev) => ({ ...prev, [focusNew ? NEW_KEY : ALL_KEY]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    doAdd(focusNew ? NEW_KEY : ALL_KEY, inputs[focusNew ? NEW_KEY : ALL_KEY] ?? "");
                  }
                }}
                placeholder={`Value for all ${shown.length}…`}
                aria-label="Add value to every group"
                className="min-w-0 flex-1 max-w-[240px] rounded-lg border border-border bg-bg-white px-2.5 py-1.5 text-[13.5px] focus:border-primary-soft focus:outline-none focus:ring-2 focus:ring-primary-softer"
              />
              <button
                type="button"
                onClick={() => doAdd(focusNew ? NEW_KEY : ALL_KEY, inputs[focusNew ? NEW_KEY : ALL_KEY] ?? "")}
                className="rounded-lg border border-border bg-bg-white px-3 py-1.5 text-[13px] font-bold text-text-body hover:border-primary-soft"
              >
                Add to all
              </button>
            </div>
          </div>
          {!focusNew && keys.length > 4 && (
            <div className="basis-[190px]">
              <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wide text-text-muted">Filter</div>
              <input
                type="search"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={`${parent?.label}…`}
                className="w-full rounded-lg border border-border bg-bg-white px-2.5 py-1.5 text-[13px]"
              />
            </div>
          )}
        </div>
      )}
      {errors[focusNew ? NEW_KEY : ALL_KEY] && (
        <div className="-mt-1.5 mb-2.5 text-[11.5px] font-bold text-status-failed-text">
          {errors[focusNew ? NEW_KEY : ALL_KEY]}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {visibleKeys.map((k) => {
          const list = listFor(draftConfig, field, k);
          const isNew = newKeys.includes(k);
          const owners =
            grandparent && parent
              ? Object.entries(
                  (() => {
                    const pe = draftConfig[parent.key];
                    return pe && "valueMap" in pe ? pe.valueMap : {};
                  })(),
                )
                  .filter(([, vs]) => vs.includes(k))
                  .map(([gk]) => gk)
              : [];

          return (
            <div
              key={k}
              className={`rounded-xl border p-3.5 ${
                list.length === 0 ? "border-[#EBD39E] bg-[#FFFBF1]" : isNew ? "border-primary-soft bg-bg-card" : "border-border bg-bg-card"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-2 text-[12.5px] font-bold text-text-muted">
                <span>
                  {parent?.label}: <b className="text-text-heading">{k}</b>
                </span>
                {isNew && (
                  <span className="rounded-pill bg-primary-softer px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary-dark">
                    New
                  </span>
                )}
                {owners.length > 0 && (
                  <span className="text-[11px] font-bold text-text-placeholder">
                    in {grandparent?.label}: {owners.join(", ")}
                  </span>
                )}
                <span className="ml-auto text-[11px] font-bold text-text-muted">
                  {list.length} option{list.length === 1 ? "" : "s"}
                </span>
              </div>
              {renderList(k, k)}
              {(isNew || list.length === 0) && suggestionsFor(list).length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold text-text-muted">
                  Reuse:
                  {suggestionsFor(list).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => doAdd(k, v)}
                      className="rounded-md border border-dashed border-primary-soft bg-bg-white px-2 py-0.5 text-xs font-bold text-primary-dark hover:border-solid hover:bg-primary-softer"
                    >
                      + {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {focusNew && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 self-start bg-transparent p-0.5 text-[12.5px] font-bold text-primary-dark hover:underline"
        >
          Show {keys.length - newKeys.length} existing list{keys.length - newKeys.length === 1 ? "" : "s"} ›
        </button>
      )}
      {!focusNew && newKeys.length > 0 && showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="mt-2 self-start bg-transparent p-0.5 text-[12.5px] font-bold text-primary-dark hover:underline"
        >
          ‹ Only new lists
        </button>
      )}

      {children.length > 0 && (
        <p className="mt-3.5 border-t border-dashed border-border pt-3 text-xs text-text-muted">
          Feeds into <b className="text-text-heading">{children.map((c) => c.label).join(", ")}</b>. New values
          here get their own list there — <b className="text-text-heading">Next</b> takes you straight to it.
        </p>
      )}

      <RemovalConfirm pendingRemoval={pendingRemoval} onCancel={() => setPendingRemoval(null)} onConfirm={confirmRemoval} />
    </div>
  );
}

function RemovalConfirm({
  pendingRemoval,
  onCancel,
  onConfirm,
}: {
  pendingRemoval: { groupKey: string | null; value: string; impact: RemovalImpactEntry[] } | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      isOpen={Boolean(pendingRemoval)}
      title="Remove this option?"
      message={
        pendingRemoval ? (
          <>
            Removing <b>{pendingRemoval.value}</b> also removes:
            <ul className="mt-1 list-disc pl-4">
              {pendingRemoval.impact.map((x) => (
                <li key={x.label}>
                  <b>{x.label}</b> for {x.groups.join(", ")} ({x.vals} option{x.vals === 1 ? "" : "s"})
                </li>
              ))}
            </ul>
          </>
        ) : (
          ""
        )
      }
      confirmLabel="Remove"
      cancelLabel="Keep"
      confirmVariant="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
