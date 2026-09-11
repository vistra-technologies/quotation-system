"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";

interface CatalogTypeEditorProps {
  orgSlug: string;
  typeId: string;
  code: string;
  name: string;
  fieldsSchema: FieldEntry[];
  initialFieldOptionsConfig: FieldOptionsConfig;
}

/**
 * Per-ComponentType value-list editor — Stage 20 Batch 3, the Catalog screen's editable unit.
 *
 * Flat fields (no dependsOn) get a chip-style add/remove value-list. Dependent fields (have
 * dependsOn) get one value-list row per parent value, read live from the parent field's own
 * *current, in-progress* client-side option list — not just the last-saved config — so adding a
 * new parent value immediately offers a row for it before Save. Wiring itself (which field
 * depends on which) is shown as a read-only badge; there is no control to change it here
 * (decision #3, stage-20.md — SuperAdmin-owned).
 *
 * Wireframe stage (CLAUDE.md §5) — plain functional styling, no polish.
 */
export function CatalogTypeEditor({
  orgSlug,
  typeId,
  code,
  name,
  fieldsSchema,
  initialFieldOptionsConfig,
}: CatalogTypeEditorProps) {
  const router = useRouter();

  // Local editable state: fieldKey -> current string[] (flat) or Record<parentValue,string[]> (dependent).
  const [flatOptions, setFlatOptions] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const f of fieldsSchema) {
      if (!f.dependsOn && (f.type === "dropdown" || f.type === "radio")) {
        const entry = initialFieldOptionsConfig[f.key];
        init[f.key] = entry && "options" in entry ? entry.options : [];
      }
    }
    return init;
  });
  const [valueMaps, setValueMaps] = useState<Record<string, Record<string, string[]>>>(() => {
    const init: Record<string, Record<string, string[]>> = {};
    for (const f of fieldsSchema) {
      if (f.dependsOn && (f.type === "dropdown" || f.type === "radio")) {
        const entry = initialFieldOptionsConfig[f.key];
        init[f.key] = entry && "valueMap" in entry ? { ...entry.valueMap } : {};
      }
    }
    return init;
  });

  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const byKey = new Map(fieldsSchema.map((f) => [f.key, f]));
  const choiceFields = fieldsSchema.filter(
    (f) => f.type === "dropdown" || f.type === "radio",
  );

  /**
   * The full set of values `key`'s field can currently produce, read live from in-progress
   * client state — not just the last-saved config. Handles multi-hop chains (review-B3
   * CRITICAL #1): if `key` is itself a dependent field, its own live value set is the union of
   * every branch's currently-entered values (each branch is keyed by *its* parent's value, per
   * the design doc's example, so the union across branches is the complete set this field can
   * produce for the next hop down).
   */
  function liveValuesOf(key: string): string[] {
    const f = byKey.get(key);
    if (!f) return [];
    if (!f.dependsOn) return flatOptions[key] ?? [];
    return [...new Set(Object.values(valueMaps[key] ?? {}).flat())];
  }

  function draftKey(fieldKey: string, row?: string) {
    return row !== undefined ? `${fieldKey}::${row}` : fieldKey;
  }

  function addFlatValue(fieldKey: string) {
    const dKey = draftKey(fieldKey);
    const val = (draftInputs[dKey] ?? "").trim();
    if (!val) return;
    setFlatOptions((prev) => {
      const current = prev[fieldKey] ?? [];
      if (current.includes(val)) return prev;
      return { ...prev, [fieldKey]: [...current, val] };
    });
    setDraftInputs((prev) => ({ ...prev, [dKey]: "" }));
  }

  function removeFlatValue(fieldKey: string, val: string) {
    setFlatOptions((prev) => ({
      ...prev,
      [fieldKey]: (prev[fieldKey] ?? []).filter((v) => v !== val),
    }));
  }

  function addDependentValue(fieldKey: string, parentValue: string) {
    const dKey = draftKey(fieldKey, parentValue);
    const val = (draftInputs[dKey] ?? "").trim();
    if (!val) return;
    setValueMaps((prev) => {
      const rows = prev[fieldKey] ?? {};
      const current = rows[parentValue] ?? [];
      if (current.includes(val)) return prev;
      return { ...prev, [fieldKey]: { ...rows, [parentValue]: [...current, val] } };
    });
    setDraftInputs((prev) => ({ ...prev, [dKey]: "" }));
  }

  function removeDependentValue(fieldKey: string, parentValue: string, val: string) {
    setValueMaps((prev) => {
      const rows = prev[fieldKey] ?? {};
      return {
        ...prev,
        [fieldKey]: {
          ...rows,
          [parentValue]: (rows[parentValue] ?? []).filter((v) => v !== val),
        },
      };
    });
  }

  async function handleSave() {
    setStatus("saving");
    setError(null);

    const fieldOptionsConfig: Record<
      string,
      { options: string[] } | { valueMap: Record<string, string[]> }
    > = {};

    for (const f of choiceFields) {
      if (f.dependsOn) {
        // Prune to only the parent's *currently live* option values (works for a multi-hop
        // parent too, via liveValuesOf — review-B3 CRITICAL #1) — a row for a parent value that
        // no longer exists is dropped, not carried as dead data (see item-B3-plan.md decision #3).
        const liveParentValues = liveValuesOf(f.dependsOn);
        if (liveParentValues.length === 0) {
          // Belt-and-braces (review-B3 CRITICAL #1): the parent's live values could not be
          // resolved (e.g. a rendering/state edge case this fix doesn't anticipate) — never
          // let an untouched Save silently wipe already-stored config the screen couldn't
          // display. Carry the last-saved entry forward unchanged instead of writing `{}`.
          const existing = initialFieldOptionsConfig[f.key];
          fieldOptionsConfig[f.key] =
            existing && "valueMap" in existing ? { valueMap: existing.valueMap } : { valueMap: {} };
          continue;
        }
        const rows = valueMaps[f.key] ?? {};
        const pruned: Record<string, string[]> = {};
        for (const parentVal of liveParentValues) {
          pruned[parentVal] = rows[parentVal] ?? [];
        }
        fieldOptionsConfig[f.key] = { valueMap: pruned };
      } else {
        fieldOptionsConfig[f.key] = { options: flatOptions[f.key] ?? [] };
      }
    }

    try {
      const res = await fetch(
        `/api/v1/orgs/${orgSlug}/component-types/${typeId}/field-values`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fieldOptionsConfig }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        setError(body.error ?? `Save failed (HTTP ${res.status})`);
        return;
      }
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
      setError("Save failed — network error");
    }
  }

  if (choiceFields.length === 0) return null;

  return (
    <section className="rounded-md border border-border bg-bg-card p-5">
      <h2 className="text-lg font-bold text-text-heading">
        {name} <span className="text-text-muted">({code})</span>
      </h2>

      <div className="mt-4 flex flex-col gap-5">
        {choiceFields.map((f) => {
          const parent = f.dependsOn ? byKey.get(f.dependsOn) : undefined;
          const isDependent = Boolean(f.dependsOn);

          return (
            <div key={f.key} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-heading">{f.label}</span>
                {isDependent && (
                  <span className="rounded-sm bg-primary-softer px-2 py-0.5 text-xs font-semibold text-primary-dark">
                    depends on {parent?.label ?? f.dependsOn}
                  </span>
                )}
              </div>

              {!isDependent ? (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-2">
                    {(flatOptions[f.key] ?? []).map((val) => (
                      <span
                        key={val}
                        className="flex items-center gap-1 rounded-sm border border-border bg-bg-white px-2 py-1 text-sm"
                      >
                        {val}
                        <button
                          type="button"
                          onClick={() => removeFlatValue(f.key, val)}
                          aria-label={`Remove ${val}`}
                          className="text-text-muted hover:text-red-600"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={draftInputs[draftKey(f.key)] ?? ""}
                      onChange={(e) =>
                        setDraftInputs((prev) => ({ ...prev, [draftKey(f.key)]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addFlatValue(f.key);
                        }
                      }}
                      placeholder="Add value…"
                      className="rounded-sm border border-border px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => addFlatValue(f.key)}
                      className="rounded-sm border border-border px-2 py-1 text-sm font-semibold"
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-3">
                  {liveValuesOf(f.dependsOn as string).length === 0 ? (
                    <p className="text-sm text-text-muted">
                      Configure &quot;{parent?.label ?? f.dependsOn}&quot; first — no parent values yet.
                    </p>
                  ) : (
                    liveValuesOf(f.dependsOn as string).map((parentVal) => (
                      <div key={parentVal} className="rounded-sm bg-bg-page p-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-text-muted">
                          {parent?.label ?? f.dependsOn}: {parentVal}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {(valueMaps[f.key]?.[parentVal] ?? []).map((val) => (
                            <span
                              key={val}
                              className="flex items-center gap-1 rounded-sm border border-border bg-bg-white px-2 py-1 text-sm"
                            >
                              {val}
                              <button
                                type="button"
                                onClick={() => removeDependentValue(f.key, parentVal, val)}
                                aria-label={`Remove ${val}`}
                                className="text-text-muted hover:text-red-600"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="mt-1.5 flex gap-2">
                          <input
                            type="text"
                            value={draftInputs[draftKey(f.key, parentVal)] ?? ""}
                            onChange={(e) =>
                              setDraftInputs((prev) => ({
                                ...prev,
                                [draftKey(f.key, parentVal)]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                addDependentValue(f.key, parentVal);
                              }
                            }}
                            placeholder="Add value…"
                            className="rounded-sm border border-border px-2 py-1 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => addDependentValue(f.key, parentVal)}
                            className="rounded-sm border border-border px-2 py-1 text-sm font-semibold"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={status === "saving"}
          className="rounded-sm bg-primary px-4 py-2 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <span className="text-sm text-primary-dark">Saved.</span>}
        {status === "error" && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </section>
  );
}
