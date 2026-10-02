"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SelectField } from "@/components/select-field";
import { LoadingOverlay } from "@/components/loading-overlay";
import {
  applyFieldChoice,
  validateSelectionConfig,
  type ConfigUpdatePreview,
  type SelectionConfig,
} from "@/lib/config-update";
import { resolveOptions } from "@/lib/configurator-gating";

interface Props {
  orgSlug: string;
  projectId: string;
  backHref: string;
  preview: ConfigUpdatePreview;
}

const STEPS = ["Review changes", "Fix selections", "Confirm and apply"];
const card = "rounded-md border border-border bg-bg-card shadow-card";
const btn =
  "rounded-sm border border-border bg-bg-white px-5 py-2.5 text-sm font-bold text-text-body hover:bg-primary-softer";
const btnPrimary =
  "rounded-sm bg-primary px-5 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50";
const bad = "font-bold text-[var(--color-status-failed-text)]";

export function UpdateConfigWizard({ orgSlug, projectId, backHref, preview }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  // Working copy of every affected selection's config; user choices land here.
  const [configs, setConfigs] = useState<Record<string, SelectionConfig>>(() =>
    Object.fromEntries(preview.selections.map((s) => [s.id, s.config])),
  );

  const blocked = preview.selections.filter((s) => s.blocking);
  // Live re-validation of the working copies (cascade-aware).
  const rows = useMemo(
    () =>
      preview.selections.map((s) => {
        const t = preview.types[s.typeId];
        const check = t
          ? validateSelectionConfig(t.fieldsSchema, t.fieldOptionsConfig, configs[s.id] ?? s.config)
          : { cleaned: s.config, dropped: [] as string[], issues: [] };
        return { s, t, check };
      }),
    [preview, configs],
  );
  const unresolved = rows.filter((r) => !r.s.blocking && r.check.issues.length > 0).length;
  const canApply = !preview.formula.problem && blocked.length === 0 && unresolved === 0 && ack;

  function choose(selId: string, typeId: string, key: string, value: string) {
    const t = preview.types[typeId];
    if (!t) return;
    setConfigs((prev) => ({ ...prev, [selId]: applyFieldChoice(t.fieldsSchema, prev[selId] ?? {}, key, value) }));
  }

  /** Same type + same old value for this field -> same choice. */
  function bulk(typeId: string, key: string, value: string, oldVal: string | null) {
    const t = preview.types[typeId];
    if (!t) return;
    setConfigs((prev) => {
      const next = { ...prev };
      for (const s of preview.selections) {
        if (s.typeId !== typeId || s.blocking) continue;
        const original = s.config[key];
        const same =
          oldVal === null ? original == null || original === "" : String(original) === oldVal;
        if (same) next[s.id] = applyFieldChoice(t.fieldsSchema, next[s.id] ?? s.config, key, value);
      }
      return next;
    });
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const fixes: Record<string, Record<string, string | boolean>> = {};
    for (const s of preview.selections) {
      const cur = configs[s.id] ?? {};
      fixes[s.id] = Object.fromEntries(
        Object.entries(cur).filter(([, v]) => typeof v === "string" || typeof v === "boolean"),
      ) as Record<string, string | boolean>;
    }
    try {
      const res = await fetch(
        `/api/v1/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(projectId)}/config-update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fixes }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Update failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      router.push(backHref);
      router.refresh();
    } catch {
      setError("Network error — please try again");
      setBusy(false);
    }
  }

  if (!preview.needsUpdate) {
    return (
      <div className={`${card} p-8 text-center`}>
        <p className="mb-4 text-sm text-text-body">Configuration is already up to date — nothing to change.</p>
        <Link href={backHref} className={btn}>
          Back to project
        </Link>
      </div>
    );
  }

  const formulaText = preview.formula.changed
    ? `${preview.formula.from ?? "none"} → ${preview.formula.to ?? "none"}`
    : `Unchanged (${preview.formula.to ?? "none"})`;

  return (
    <div className={card}>
      <LoadingOverlay visible={busy} />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-7 py-4">
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              i === step ? "bg-primary text-text-on-primary" : "bg-primary-softer text-text-body"
            }`}
          >
            {i + 1}. {label}
          </span>
        ))}
      </div>

      <div className="px-7 py-6 text-sm text-text-body">
        {step === 0 && (
          <div className="space-y-5">
            <p>
              This project keeps the component configuration it was created with. Updating brings it in line with
              your organization&apos;s current configuration. Your components, floors, rooms and partitions are kept.
            </p>
            {preview.changes.length === 0 ? (
              <p className="text-text-muted">No component type changes detected.</p>
            ) : (
              preview.changes.map((c) => (
                <div key={c.typeName}>
                  <div className="mb-1 font-extrabold text-text-heading">{c.typeName}</div>
                  <ul className="list-disc pl-5">
                    {c.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            <div>
              <div className="mb-1 font-extrabold text-text-heading">Formula set</div>
              <p>{formulaText}</p>
              {preview.formula.problem && <p className={`mt-1 ${bad}`}>{preview.formula.problem}</p>}
            </div>
            <p className="text-text-muted">
              {preview.selections.length} of {preview.totalSelections} component(s) are affected.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {preview.selections.length === 0 && <p>Nothing to fix.</p>}
            {rows.map(({ s, t, check }) => (
              <div key={s.id} className="rounded-sm border border-border bg-bg-white p-4">
                <div className="mb-2 font-extrabold text-text-heading">
                  {s.label} <span className="font-normal text-text-muted">· {s.typeName}</span>
                </div>
                {s.blocking && <p className={bad}>{s.blocking}</p>}
                {s.dropped.length > 0 && (
                  <p className="mb-2 text-text-muted">
                    Will be removed (field no longer exists): {s.dropped.join(", ")}
                  </p>
                )}
                {!s.blocking && s.issues.length === 0 && s.dropped.length === 0 && <p>No action needed.</p>}
                {!s.blocking &&
                  t &&
                  t.fieldsSchema
                    .filter((f) => s.issues.some((i) => i.key === f.key) || check.issues.some((i) => i.key === f.key))
                    .map((f) => {
                      const cur = configs[s.id] ?? s.config;
                      const orig = s.issues.find((i) => i.key === f.key);
                      const opts =
                        f.type === "field"
                          ? []
                          : resolveOptions(f, cur as Record<string, string | boolean>, t.fieldOptionsConfig);
                      const stillBad = check.issues.some((i) => i.key === f.key);
                      return (
                        <div key={f.key} className="mb-2 grid gap-1 sm:grid-cols-[200px_1fr_auto] sm:items-center">
                          <div>
                            <div className="font-bold">{f.label}</div>
                            <div className="text-xs text-text-muted">
                              {orig?.kind === "invalid" ? `Was "${orig.oldValue}" — no longer offered` : "Needs a value"}
                            </div>
                          </div>
                          {f.type === "field" ? (
                            <input
                              className="rounded-sm border border-border bg-bg-white px-3 py-2 text-sm"
                              value={String(cur[f.key] ?? "")}
                              onChange={(e) => choose(s.id, s.typeId, f.key, e.target.value)}
                            />
                          ) : (
                            <SelectField
                              value={stillBad ? "" : String(cur[f.key] ?? "")}
                              placeholder="Choose a value"
                              onChange={(e) => choose(s.id, s.typeId, f.key, e.target.value)}
                            >
                              {opts.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </SelectField>
                          )}
                          {!stillBad && cur[f.key] ? (
                            <button
                              type="button"
                              className="text-xs font-bold text-primary-dark underline"
                              onClick={() => bulk(s.typeId, f.key, String(cur[f.key]), orig?.oldValue ?? null)}
                            >
                              Use for same
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                      );
                    })}
              </div>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <ul className="list-disc pl-5">
              <li>{preview.selections.length} component(s) will be checked and updated.</li>
              <li>Formula set: {formulaText}.</li>
              <li>Floors, rooms, partitions and the design are kept.</li>
              <li>The summary will be cleared — re-submit the design afterwards.</li>
              <li>This cannot be undone.</li>
            </ul>
            {blocked.length > 0 && (
              <p className={bad}>
                {blocked.length} component(s) cannot be updated until an admin finishes configuring them.
              </p>
            )}
            {unresolved > 0 && <p className={bad}>{unresolved} component(s) still need a value (step 2).</p>}
            {preview.formula.problem && <p className={bad}>{preview.formula.problem}</p>}
            <label className="flex items-center gap-2 font-bold">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand the
              summary will need to be re-submitted.
            </label>
            {error && <p className={bad}>{error}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-7 py-5">
        {step === 0 ? (
          <Link href={backHref} className={btn}>
            Cancel
          </Link>
        ) : (
          <button type="button" className={btn} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step < 2 ? (
          <button type="button" className={btnPrimary} onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className={btnPrimary} disabled={!canApply || busy} onClick={apply}>
            Apply update
          </button>
        )}
      </div>
    </div>
  );
}
