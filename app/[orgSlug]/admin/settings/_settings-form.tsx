"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SelectField } from "@/components/select-field";
import { Toast, useToast } from "@/components/toast";
import { apiErrorMessage } from "@/lib/api-error-message";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";

/**
 * Organization Settings (Stage 38a, mockup B1 layout B, Q-D24): sections, each a card that is read-only with its own
 * Edit and Cancel / Save beside its fields. One "General" section with Default Currency for now. Save is disabled
 * until the value differs from the saved one; no confirm dialog; a saved toast; a 5xx shows the Reference code.
 */

const PENCIL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[13px] w-[13px]" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const ALERT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-px h-4 w-4 shrink-0" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);
const SPIN = (
  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 animate-spin" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const BTN_P =
  "inline-flex h-[34px] min-w-[76px] items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-primary-dark bg-primary px-3.5 text-[13px] font-bold text-white hover:bg-primary-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
const BTN_S =
  "inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-border-strong bg-bg-white px-3.5 text-[13px] font-bold text-text-body hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";

/** The (i) icon of the signed-off mockup (`.qe-info` look, 24 px hit area, tooltip on hover or focus). */
function Info({ label, text }: { label: string; text: string }) {
  return (
    <span
      tabIndex={0}
      aria-label={label}
      className="group/i relative inline-flex h-6 w-6 shrink-0 cursor-help items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] border-text-placeholder text-[10.5px] font-extrabold text-text-placeholder group-hover/i:border-primary group-hover/i:text-primary"
      >
        i
      </span>
      <span
        role="tooltip"
        className="invisible absolute left-1/2 top-[calc(100%+8px)] z-10 w-max max-w-[240px] -translate-x-1/2 rounded-[6px] bg-text-heading px-2.5 py-[7px] text-[11.5px] font-semibold leading-snug text-white opacity-0 transition-opacity group-hover/i:visible group-hover/i:opacity-100 group-focus/i:visible group-focus/i:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function SettingsForm({ orgSlug, defaultCurrency }: { orgSlug: string; defaultCurrency: string }) {
  const t = useTranslations("orgSettings");
  const tc = useTranslations("externalCompanies");
  const router = useRouter();
  const toast = useToast();

  const [saved, setSaved] = useState(defaultCurrency);
  const [draft, setDraft] = useState(defaultCurrency);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (c: string) => tc(`currency${c}` as Parameters<typeof tc>[0]);
  const dirty = draft !== saved;

  function startEdit() {
    setDraft(saved);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setDraft(saved);
    setError(null);
    setEditing(false);
  }
  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultCurrency: draft }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(body, t("saveFailed")));
        return;
      }
      const next = (body as { defaultCurrency?: string } | null)?.defaultCurrency ?? draft;
      setSaved(next);
      setDraft(next);
      setEditing(false);
      toast.show(t("saved"));
      // The org layout reads the default currency for Quick Estimate once per navigation: refresh it.
      router.refresh();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-[880px]">
      <h1 className="mb-5 text-2xl font-extrabold tracking-tight text-text-heading">{t("pageTitle")}</h1>
      <div className="flex flex-col gap-5">
        <section aria-labelledby="sec-general" className="rounded-md border border-border bg-bg-white shadow-card">
          <div className="flex min-h-[58px] items-center justify-between gap-4 border-b border-border px-5 py-3">
            <h2 id="sec-general" className="text-[15px] font-extrabold text-text-heading">
              {t("sectionGeneral")}
            </h2>
            {editing ? (
              <div className="flex items-center gap-2">
                <button type="button" disabled={saving} onClick={cancel} className={BTN_S}>
                  {t("cancel")}
                </button>
                <button type="button" disabled={saving || !dirty} onClick={save} className={BTN_P}>
                  {saving ? (
                    <>
                      {SPIN}
                      {t("saving")}
                    </>
                  ) : (
                    t("save")
                  )}
                </button>
              </div>
            ) : (
              <button type="button" onClick={startEdit} className={BTN_S}>
                {PENCIL}
                {t("edit")}
              </button>
            )}
          </div>
          {error ? (
            <div className="border-b border-border px-5 py-4">
              <div role="alert" className="flex items-start gap-2 rounded-sm border border-status-failed-bg bg-status-failed-bg px-4 py-3 text-sm text-status-failed-text">
                {ALERT}
                <p>{error}</p>
              </div>
            </div>
          ) : null}
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[260px_minmax(0,1fr)]">
              <div className="flex items-center gap-1.5 rounded-bl-[13px] border-r border-border bg-bg-card px-5 py-4">
                <label id="lbl-currency" htmlFor="default-currency" className="text-sm font-bold text-text-heading">
                  {t("fieldDefaultCurrency")}
                </label>
                <Info label={t("defaultCurrencyInfoLabel")} text={t("defaultCurrencyTip")} />
              </div>
              <div className={`flex min-w-0 items-center gap-3 px-5 ${editing ? "py-3" : "py-4"}`}>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="w-full max-w-[280px]">
                      <SelectField id="default-currency" value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)}>
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {label(c)}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                  ) : (
                    <span data-testid="default-currency-value" className="text-sm font-semibold text-text-heading">
                      {label(saved)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <Toast {...toast} />
    </div>
  );
}
