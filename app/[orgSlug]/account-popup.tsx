"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export type AccountTab = "details" | "password";

interface AccountPopupProps {
  orgSlug: string;
  onClose: () => void;
  /** Display name (User.name) — fallback for the header when first/last are empty. */
  name: string;
  username: string;
  roleName: string;
  orgName: string;
  firstName: string;
  lastName: string;
  mobile: string | null;
  profileEmail: string | null;
}

type Fields = { first: string; last: string; mobile: string; email: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;

const labelCls = "mb-1 block text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted";
const inputCls =
  "w-full rounded-sm border border-border bg-bg-white px-3.5 py-[11px] text-sm text-text-body placeholder:text-text-placeholder focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary-softer";
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-sm border px-5 py-[11px] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45";
const btnOutline = `${btnBase} border-border bg-bg-white text-text-body`;
const btnPrimary = `${btnBase} border-transparent bg-primary text-text-on-primary enabled:hover:bg-primary-dark`;
const bannerCls = "mb-4 flex items-start gap-2 rounded-sm px-[13px] py-2.5 text-[12.5px] font-semibold leading-normal";

const chipCls =
  "inline-flex items-center gap-1.5 rounded-full bg-primary-softer px-[11px] py-1 text-[11.5px] font-bold text-primary-dark";
const chipIcon = "h-3 w-3 shrink-0";

/**
 * "My Account" popup (Hotfix 2026-10-10): Details (view first, Edit to change) and Password tabs.
 * Rendered through a portal because the top-bar header is `sticky z-30` and would trap an inline
 * fixed overlay in its stacking context.
 *
 * Details save -> PATCH /api/v1/orgs/[orgSlug]/me (own row, 4 fields). Password change ->
 * better-auth's own changePassword (server verifies the existing password; other sessions revoked).
 */
export function AccountPopup({
  orgSlug,
  onClose,
  name,
  username,
  roleName,
  orgName,
  firstName,
  lastName,
  mobile,
  profileEmail,
}: AccountPopupProps) {
  const t = useTranslations("account");
  const router = useRouter();

  const [tab, setTab] = useState<AccountTab>("details");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<Fields>({
    first: firstName,
    last: lastName,
    mobile: mobile ?? "",
    email: profileEmail ?? "",
  });
  const [draft, setDraft] = useState<Fields>(saved);
  const [dtError, setDtError] = useState<string | null>(null);
  const [dtSuccess, setDtSuccess] = useState(false);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pwExisting, setPwExisting] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const busy = saving || pwBusy;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open (the opener is unmounted with the menu; TopBarActions restores focus on close).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Escape closes (unless a request is in flight).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Clear the delayed close (after a password change) on unmount.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const dirty = (Object.keys(draft) as (keyof Fields)[]).some((k) => draft[k] !== saved[k]);
  const fullName = `${saved.first} ${saved.last}`.trim() || name;
  const initial = (saved.first || fullName).trim().charAt(0).toUpperCase() || "?";

  function startEdit() {
    setDraft(saved);
    setDtSuccess(false);
    setDtError(null);
    setEmailInvalid(false);
    setEditing(true);
  }

  function cancelEdit() {
    setDtError(null);
    setEmailInvalid(false);
    setEditing(false);
  }

  async function saveDetails() {
    setDtError(null);
    setDtSuccess(false);
    setEmailInvalid(false);
    const first = draft.first.trim();
    const last = draft.last.trim();
    const email = draft.email.trim();
    if (!first || !last) {
      setDtError(t("nameRequired"));
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      setEmailInvalid(true);
      setDtError(t("checkField"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/orgs/${orgSlug}/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: first,
          lastName: last,
          mobile: draft.mobile.trim(),
          profileEmail: email,
        }),
      });
      if (!res.ok) {
        setDtError(t("saveFailed"));
        return;
      }
      const data = (await res.json()) as {
        firstName: string;
        lastName: string;
        mobile: string | null;
        profileEmail: string | null;
      };
      const next: Fields = {
        first: data.firstName,
        last: data.lastName,
        mobile: data.mobile ?? "",
        email: data.profileEmail ?? "",
      };
      setSaved(next);
      setDraft(next);
      setEditing(false);
      setDtSuccess(true);
      // Re-run the server layout so the top-bar avatar initial and name refresh (no full reload).
      router.refresh();
    } catch {
      setDtError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    setPwError(null);
    setPwSuccess(false);
    if (!pwExisting || !pwNew || !pwConfirm) {
      setPwError(t("fillAll"));
      return;
    }
    if (pwNew.length < MIN_PASSWORD) {
      setPwError(t("tooShort"));
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError(t("mismatch"));
      return;
    }
    setPwBusy(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: pwExisting,
        newPassword: pwNew,
        revokeOtherSessions: true,
      });
      if (error) {
        setPwError(error.code === "INVALID_PASSWORD" ? t("wrongExisting") : t("passwordFailed"));
        return;
      }
      setPwSuccess(true);
      setPwExisting("");
      setPwNew("");
      setPwConfirm("");
      closeTimer.current = setTimeout(onClose, 1200);
    } catch {
      setPwError(t("passwordFailed"));
    } finally {
      setPwBusy(false);
    }
  }

  const tabCls = (active: boolean) =>
    `-mb-px border-b-2 bg-transparent px-3.5 py-[9px] text-[13px] font-bold ${
      active
        ? "border-primary text-primary-dark"
        : "border-transparent text-text-muted hover:text-primary-dark"
    }`;

  const viewVal = (v: string) =>
    v ? (
      <div className="break-words text-sm font-bold text-text-heading">{v}</div>
    ) : (
      <div className="break-words text-sm font-semibold text-text-muted">{t("notSet")}</div>
    );

  const detailFields: {
    key: keyof Fields;
    label: string;
    type: string;
    auto: string;
    id: string;
  }[] = [
    { key: "first", label: t("firstName"), type: "text", auto: "given-name", id: "acct-first" },
    { key: "last", label: t("lastName"), type: "text", auto: "family-name", id: "acct-last" },
    { key: "mobile", label: t("mobile"), type: "tel", auto: "tel", id: "acct-mobile" },
    { key: "email", label: t("email"), type: "email", auto: "email", id: "acct-email" },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(27,40,30,0.38)] p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="acct-title"
        className="flex max-h-[88vh] w-full max-w-[520px] flex-col rounded-md bg-bg-white outline-none shadow-[0_24px_60px_-16px_rgba(27,40,30,0.35)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-[22px] pt-[18px]">
          <h2 id="acct-title" className="m-0 text-[17px] font-extrabold text-text-heading">
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={t("close")}
            className="h-[26px] w-[26px] shrink-0 rounded-full border border-border bg-bg-card text-sm leading-none text-text-muted hover:bg-primary-softer hover:text-primary-dark disabled:opacity-45"
          >
            &times;
          </button>
        </div>

        {/* Identity header: never editable */}
        <div className="px-[22px] pt-3.5">
          <div className="flex items-center gap-3.5 pb-3.5 pt-1">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-[22px] font-extrabold text-text-on-primary">
              {initial}
            </div>
            <div className="min-w-0">
              <div className="break-words text-[17px] font-extrabold leading-tight text-text-heading">
                {fullName}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-text-muted">
                @{username}
                <span
                  tabIndex={0}
                  aria-label={t("infoLabel")}
                  className="group relative inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-border bg-bg-white text-[10px] font-extrabold italic text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  i
                  <span
                    role="tooltip"
                    className="pointer-events-none invisible absolute bottom-[calc(100%+8px)] left-1/2 z-10 w-max max-w-[220px] -translate-x-1/2 rounded-[6px] bg-text-heading px-2.5 py-[7px] text-left text-[11.5px] font-semibold not-italic leading-[1.4] text-white opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
                  >
                    {t("infoTip")}
                  </span>
                </span>
              </div>
              <div className="mt-[9px] flex flex-wrap gap-1.5">
                <span className={chipCls}>
                  <svg className={chipIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                  {roleName}
                </span>
                <span className={chipCls}>
                  <svg className={chipIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" />
                  </svg>
                  {orgName}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-[22px]">
          <button
            type="button"
            role="tab"
            id="acct-tab-details"
            aria-selected={tab === "details"}
            onClick={() => setTab("details")}
            className={tabCls(tab === "details")}
          >
            {t("tabDetails")}
          </button>
          <button
            type="button"
            role="tab"
            id="acct-tab-password"
            aria-selected={tab === "password"}
            onClick={() => setTab("password")}
            className={tabCls(tab === "password")}
          >
            {t("tabPassword")}
          </button>
        </div>

        <div className="overflow-y-auto px-[22px] pb-1 pt-[18px]">
          {tab === "details" ? (
            <div role="tabpanel" aria-labelledby="acct-tab-details">
              {dtError && (
                <div role="alert" className={`${bannerCls} bg-status-failed-bg text-status-failed-text`}>
                  {dtError}
                </div>
              )}
              {dtSuccess && (
                <div role="status" className={`${bannerCls} bg-status-paid-bg text-status-paid-text`}>
                  {t("detailsUpdated")}
                </div>
              )}

              <div className="mb-3.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
                  {t("sectionPersonal")}
                </span>
                {!editing && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-bg-white px-[11px] py-[5px] text-[12.5px] font-bold text-text-body hover:bg-primary-softer hover:text-primary-dark"
                  >
                    <svg className="h-[13px] w-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                    {t("edit")}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-x-[22px] gap-y-[18px] min-[561px]:grid-cols-2">
                {detailFields.map((f) => (
                  <div key={f.key}>
                    <label htmlFor={editing ? f.id : undefined} className={labelCls}>
                      {f.label}
                    </label>
                    {editing ? (
                      <>
                        <input
                          id={f.id}
                          type={f.type}
                          autoComplete={f.auto}
                          value={draft[f.key]}
                          disabled={saving}
                          aria-invalid={f.key === "email" && emailInvalid ? true : undefined}
                          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                          className={`${inputCls} ${f.key === "email" && emailInvalid ? "border-status-failed-text" : ""}`}
                        />
                        {f.key === "email" && emailInvalid && (
                          <div className="mt-[5px] text-[11.5px] font-semibold text-status-failed-text">
                            {t("emailInvalid")}
                          </div>
                        )}
                      </>
                    ) : (
                      viewVal(saved[f.key])
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div role="tabpanel" aria-labelledby="acct-tab-password">
              {pwError && (
                <div role="alert" className={`${bannerCls} bg-status-failed-bg text-status-failed-text`}>
                  {pwError}
                </div>
              )}
              {pwSuccess && (
                <div role="status" className={`${bannerCls} bg-status-paid-bg text-status-paid-text`}>
                  {t("passwordUpdated")}
                </div>
              )}
              <div className="mb-3.5">
                <label htmlFor="acct-pw-existing" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
                  {t("existingPassword")}
                </label>
                <input
                  id="acct-pw-existing"
                  type="password"
                  autoComplete="current-password"
                  value={pwExisting}
                  disabled={pwBusy}
                  onChange={(e) => setPwExisting(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="mb-3.5">
                <label htmlFor="acct-pw-new" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
                  {t("newPassword")}
                </label>
                <input
                  id="acct-pw-new"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t("newPasswordPlaceholder")}
                  value={pwNew}
                  disabled={pwBusy}
                  onChange={(e) => setPwNew(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="mb-3.5">
                <label htmlFor="acct-pw-confirm" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">
                  {t("confirmPassword")}
                </label>
                <input
                  id="acct-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  disabled={pwBusy}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-1 flex shrink-0 justify-end gap-2.5 border-t border-border px-[22px] pb-5 pt-3.5">
          {tab === "details" && !editing && (
            <button type="button" onClick={onClose} className={btnOutline}>
              {t("close")}
            </button>
          )}
          {tab === "details" && editing && (
            <>
              <button type="button" onClick={cancelEdit} disabled={saving} className={btnOutline}>
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={saveDetails}
                disabled={!dirty || saving}
                className={btnPrimary}
              >
                {saving ? t("saving") : t("saveChanges")}
              </button>
            </>
          )}
          {tab === "password" && (
            <>
              <button type="button" onClick={onClose} disabled={pwBusy} className={btnOutline}>
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={changePassword}
                disabled={pwBusy || pwSuccess}
                className={btnPrimary}
              >
                {pwBusy ? t("changing") : t("changePassword")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
