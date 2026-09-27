"use client";

import { useEffect, useState } from "react";
import type { FieldEntry } from "@/lib/types/field-entry";
import type { FieldOptionsConfig } from "@/lib/types/field-options-config";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { descendants, emptyGroupCount, findAttr, isChain, sync } from "./catalog-model";
import { AttributeStepEditor } from "./attribute-step-editor";

interface AttributeEditorModalProps {
  orgSlug: string;
  typeId: string;
  fieldsSchema: FieldEntry[];
  /** Last server-confirmed config for this segment — cloned once, at open, into the draft. */
  savedConfig: FieldOptionsConfig;
  openFieldKey: string;
  onClose: () => void;
  /** Fires exactly once, after the single PUT that commits the whole (possibly multi-step) session. */
  onSaved: (newConfig: FieldOptionsConfig, savedLabel: string) => void;
}

interface FlowState {
  plan: string[];
  done: string[];
}

/**
 * The option-editor modal shell — header (title/breadcrumb), the flow-progress strip, the body
 * (delegated per-step to `AttributeStepEditor`), and the footer (Next/Finish/Save changes).
 *
 * Owns the session-lifetime state: `draftConfig` (cloned from `savedConfig` once, at open — never
 * re-cloned on every step-advance, because nothing is server-visible until the final commit),
 * `currentFieldKey` (advances as the cascade flow progresses), `flow` (the walked plan + which
 * steps are done), and `dirty`.
 *
 * S27-4: the primary button is always "Next"/"Finish"/"Save changes" — never "Save & Close." There
 * is no control anywhere in this component that persists a partially-filled cascade.
 * S27-5: `curEmpty` blocks Next/Finish while the *currently open* field has any empty group, for
 * any reason (already-stale or newly created this session) — matches the locked decision exactly.
 * S27-6: closing (X, Cancel, Escape, overlay) with unsaved changes discards the whole session,
 * including already-advanced steps — trivial here because nothing was ever sent to the server
 * mid-flow, so there's nothing partial to unwind server-side.
 */
export function AttributeEditorModal({
  orgSlug,
  typeId,
  fieldsSchema,
  savedConfig,
  openFieldKey,
  onClose,
  onSaved,
}: AttributeEditorModalProps) {
  const [draftConfig, setDraftConfig] = useState<FieldOptionsConfig>(() => sync(fieldsSchema, savedConfig));
  const [currentFieldKey, setCurrentFieldKey] = useState(openFieldKey);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentField = findAttr(fieldsSchema, currentFieldKey) as FieldEntry;
  const plan = flow ? flow.plan : [currentFieldKey, ...descendants(fieldsSchema, currentFieldKey)];
  const curEmpty = emptyGroupCount(fieldsSchema, draftConfig, currentField);
  const nextField = (() => {
    const i = plan.indexOf(currentFieldKey);
    for (let j = i + 1; j < plan.length; j++) {
      const x = findAttr(fieldsSchema, plan[j]);
      if (x && emptyGroupCount(fieldsSchema, draftConfig, x) > 0) return x;
    }
    return null;
  })();

  function handleMutate(nextConfig: FieldOptionsConfig) {
    setDraftConfig(sync(fieldsSchema, nextConfig));
    setDirty(true);
  }

  function requestClose() {
    if (saving) return; // a PUT is in flight — don't let Cancel promise a discard that won't happen
    if (dirty) {
      setPendingDiscard(true);
      return;
    }
    onClose();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (pendingDiscard) return; // the discard confirm owns Escape while it's open (disabled there)
      // A nested dialog (e.g. the removal-impact confirm in AttributeStepEditor) also listens for
      // Escape and owns it while open — this modal's own root card carries role="dialog" too, so
      // more than one such element means a child dialog is on top and should handle it instead.
      // (Belt-and-suspenders: ConfirmDialog itself also calls stopImmediatePropagation() on its own
      // Escape handler now, so this listener normally never even runs in that case — kept as a
      // second line of defense for any future nested overlay that doesn't.)
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      requestClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDiscard, dirty, saving]);

  async function commit(finalFlow: FlowState) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/component-types/${typeId}/field-values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldOptionsConfig: draftConfig }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveError(body.error ?? `Save failed (HTTP ${res.status})`);
        setSaving(false);
        return;
      }
      const label =
        finalFlow.done.length > 1
          ? `${finalFlow.done.length} attributes`
          : (findAttr(fieldsSchema, finalFlow.done[0])?.label ?? currentField.label);
      onSaved(draftConfig, label);
    } catch {
      setSaveError("Save failed — network error");
      setSaving(false);
    }
  }

  function handlePrimary() {
    if (curEmpty > 0) return; // defensive — the button is disabled in this state anyway
    if (nextField) {
      const carriedFlow: FlowState = flow ?? { plan, done: [] };
      const done = dirty && !carriedFlow.done.includes(currentFieldKey)
        ? [...carriedFlow.done, currentFieldKey]
        : carriedFlow.done;
      setFlow({ plan: carriedFlow.plan, done });
      setCurrentFieldKey(nextField.key);
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    const carriedFlow: FlowState = flow ?? { plan, done: [] };
    const done = carriedFlow.done.includes(currentFieldKey)
      ? carriedFlow.done
      : [...carriedFlow.done, currentFieldKey];
    void commit({ plan: carriedFlow.plan, done });
  }

  let primaryLabel: string;
  let primaryDisabled: boolean;
  let hint: string;
  if (curEmpty > 0) {
    primaryLabel = "Next ›";
    primaryDisabled = true;
    hint = `Add at least one option to every group above before continuing · ${curEmpty} group${curEmpty === 1 ? "" : "s"} left`;
  } else if (nextField) {
    const n = emptyGroupCount(fieldsSchema, draftConfig, nextField);
    primaryLabel = "Next ›";
    primaryDisabled = false;
    hint = `Next: ${nextField.label} · ${n} new list${n === 1 ? "" : "s"}`;
  } else {
    primaryLabel = flow ? "Finish" : "Save changes";
    primaryDisabled = saving || (!flow && !dirty);
    hint = flow ? "Last step in this chain" : "";
  }
  const closeLabel = flow ? "Close" : "Cancel";

  // ─── Breadcrumb path (chain ancestry, or "Independent") ──────────────────
  const pathChain: FieldEntry[] = [];
  if (isChain(fieldsSchema, currentField)) {
    let p: FieldEntry | null = currentField;
    while (p) {
      pathChain.unshift(p);
      p = p.dependsOn ? findAttr(fieldsSchema, p.dependsOn) : null;
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(27,40,30,.38)] p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ed-modal-title"
          className="flex max-h-[88vh] w-full max-w-[660px] flex-col rounded-md bg-bg-white shadow-[0_24px_60px_-16px_rgba(27,40,30,.35)]"
        >
          <div className="flex flex-shrink-0 items-start justify-between gap-3 px-5.5 pt-4.5">
            <div>
              <h2 id="ed-modal-title" className="m-0 text-[17px] font-extrabold text-text-heading">
                Edit options
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold text-text-muted">
                {pathChain.length > 0 ? (
                  pathChain.map((x, i) => (
                    <span key={x.key} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-text-placeholder">›</span>}
                      <span
                        className={
                          x.key === currentField.key
                            ? "rounded-pill bg-primary-softer px-2 py-0.5 text-primary-dark"
                            : ""
                        }
                      >
                        {x.label}
                      </span>
                    </span>
                  ))
                ) : (
                  <>
                    <span className="rounded-pill bg-primary-softer px-2 py-0.5 text-primary-dark">Independent</span>
                    <span>no dependency</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close editor"
              className="flex h-6.5 w-6.5 flex-shrink-0 items-center justify-center rounded-full border border-border bg-bg-card text-sm text-text-muted hover:bg-primary-softer hover:text-primary-dark"
            >
              ×
            </button>
          </div>

          <div className="overflow-y-auto px-5.5 pb-1 pt-3.5">
            {(flow || nextField) && (
              <div className="mb-3.5 flex flex-wrap items-center gap-1.5 rounded-xl bg-bg-page p-2.5">
                <span className="mr-1 text-[10.5px] font-extrabold uppercase tracking-wide text-text-muted">
                  Fill in order
                </span>
                {plan.map((key, i) => {
                  const x = findAttr(fieldsSchema, key);
                  if (!x) return null;
                  const n = emptyGroupCount(fieldsSchema, draftConfig, x);
                  const cur = plan.indexOf(currentFieldKey);
                  const done = flow?.done ?? [];
                  let stepClass = "border-border bg-bg-white text-text-muted";
                  let dot: React.ReactNode = i + 1;
                  if (i === cur) stepClass = "border-primary bg-primary text-text-on-primary";
                  else if (done.includes(key)) {
                    stepClass = "border-primary-soft text-primary-dark";
                    dot = "✓";
                  } else if (i < cur) stepClass = "border-border text-text-muted opacity-60 line-through";
                  else if (n) stepClass = "border-[#EBD39E] text-status-pending-text";
                  else stepClass = "border-border text-text-muted opacity-60";
                  return (
                    <span key={key} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-text-placeholder">›</span>}
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-1 text-xs font-bold ${stepClass}`}
                      >
                        <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-bg-page text-[10px]">
                          {dot}
                        </span>
                        {x.label}
                        {n > 0 && i > cur ? ` · ${n}` : ""}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}

            <AttributeStepEditor
              fieldsSchema={fieldsSchema}
              fieldKey={currentFieldKey}
              draftConfig={draftConfig}
              searchQuery=""
              inFlow={flow !== null}
              onChange={handleMutate}
              key={currentFieldKey}
            />
          </div>

          <div className="flex flex-shrink-0 items-center gap-2.5 border-t border-border px-5.5 py-4">
            <span className="min-w-0 text-xs font-bold text-text-muted">
              {saveError ? <span className="text-status-failed-text">{saveError}</span> : hint}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="rounded-sm border border-border bg-bg-white px-3.5 py-2 text-[13px] font-bold text-text-body hover:border-primary-soft disabled:cursor-not-allowed disabled:opacity-55"
            >
              {closeLabel}
            </button>
            <button
              type="button"
              onClick={handlePrimary}
              disabled={primaryDisabled}
              className="rounded-sm bg-primary px-3.5 py-2 text-[13px] font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saving ? "Saving…" : primaryLabel}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={pendingDiscard}
        title="Discard unsaved changes?"
        message="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        confirmVariant="danger"
        disableEscapeClose
        disableOverlayClose
        onConfirm={() => {
          setPendingDiscard(false);
          onClose();
        }}
        onCancel={() => setPendingDiscard(false)}
      />
    </>
  );
}
