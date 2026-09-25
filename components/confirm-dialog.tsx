"use client";

import { useEffect, useRef } from "react";

// ─── Props ───────────────────────────────────────────────────────────────────

interface ThirdAction {
  /** Label for the optional third button (rendered between primary and cancel). */
  label: string;
  onClick: () => void;
  /** Visual variant — "danger" renders in red, "default" renders in neutral. */
  variant: "danger" | "default";
}

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Plain string, or rich content (e.g. a bullet list) — hotfix 2026-09-25. */
  message: React.ReactNode;
  /**
   * Optional inline error to render as a red alert between the message and the
   * button row — e.g. a blocked-delete "still in use" response. Keeps the
   * dialog open and shows the reason right where the user is looking, instead
   * of the caller rendering an error somewhere else on the page behind it.
   */
  errorMessage?: string | null;
  /** Label for the primary confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Optional third action button, rendered between confirm and cancel.
   * Used by the unsaved-changes modal for Save & Go Back / Discard / Cancel.
   * When omitted the dialog behaves exactly as before (backward-compatible).
   */
  thirdAction?: ThirdAction;
  /**
   * Visual variant for the primary confirm button.
   * Defaults to "danger" (red) to preserve backward compat — all existing
   * destructive-action dialogs (org delete, floor delete, etc.) stay red.
   * Pass "primary" for non-destructive confirm actions (e.g. Save & Go Back).
   */
  confirmVariant?: "primary" | "danger";
  /**
   * When true, Escape does NOT dismiss this dialog (required by the unsaved-
   * changes modal per mockup lines 1916-1955 — it must force an explicit choice).
   * Defaults to false (existing behaviour: Escape triggers onCancel).
   */
  disableEscapeClose?: boolean;
  /**
   * When true, clicking the overlay does NOT dismiss this dialog.
   * Required by the unsaved-changes modal (clicking outside = Cancel, not Discard).
   * Defaults to false (existing behaviour: overlay click triggers onCancel).
   */
  disableOverlayClose?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Sage Ease–themed confirm dialog (controlled, prop-driven).
 *
 * Renders a fixed overlay when `isOpen` is true. All text is passed as props
 * so this component has no i18n dependency and can be used under any layout
 * without worrying about clientMessages namespace forwarding.
 *
 * Accessibility: role="dialog", aria-modal, auto-focus on the confirm button
 * so keyboard users can act immediately or Tab to cancel.
 *
 * S21-0.6: added `thirdAction`, `disableEscapeClose`, `disableOverlayClose`
 * props for the unsaved-changes modal. All new props are optional and default
 * to the prior behaviour — fully backward-compatible.
 *
 * No portal — renders inline at its mount point, behind a z-50 fixed overlay.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  errorMessage,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  thirdAction,
  confirmVariant = "danger",
  disableEscapeClose = false,
  disableOverlayClose = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button when the dialog opens.
  useEffect(() => {
    if (isOpen) {
      confirmRef.current?.focus();
    }
  }, [isOpen]);

  // Close on Escape key — only if not disabled (unsaved-changes modal requires
  // an explicit choice and must not dismiss on Escape).
  useEffect(() => {
    if (!isOpen || disableEscapeClose) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, disableEscapeClose, onCancel]);

  if (!isOpen) return null;

  function handleOverlayClick() {
    if (!disableOverlayClose) onCancel();
  }

  return (
    /* Fixed overlay — blocks interaction with the page behind it. */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      {/* Dialog card — stop propagation so clicking inside doesn't dismiss. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="mx-4 w-full max-w-sm rounded-md border border-border bg-bg-white p-6 shadow-[0_24px_48px_-16px_rgba(27,40,30,.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="mb-2 text-base font-extrabold text-text-heading"
        >
          {title}
        </h2>
        <div
          id="confirm-dialog-message"
          className="mb-4 text-sm text-text-body"
        >
          {message}
        </div>

        {errorMessage && (
          <div className="mb-4 rounded-sm border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3.5 py-2.5 text-sm font-semibold text-[var(--color-status-failed-text)]">
            {errorMessage}
          </div>
        )}

        {/* Button group — column layout only when a thirdAction is present;
            otherwise row (Cancel left, Confirm right) matching the original layout. */}
        <div className={thirdAction ? "flex flex-col gap-2" : "flex flex-row justify-end gap-3"}>
          {/* Cancel action — rendered first in DOM but visually last in row layout */}
          {!thirdAction && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm border border-border bg-bg-white px-4 py-2 text-sm font-bold text-text-body hover:border-[#b9c2ae]"
            >
              {cancelLabel}
            </button>
          )}

          {/* Primary action — disabled once a blocking error is shown; retrying
              without addressing the reason (e.g. still-in-use) can't succeed. */}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={Boolean(errorMessage)}
            className={
              confirmVariant === "primary"
                ? "rounded-sm border border-primary-dark bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary"
                : "rounded-sm border border-red-700 bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-600"
            }
          >
            {confirmLabel}
          </button>

          {/* Optional third action (danger or default) — only when thirdAction present */}
          {thirdAction && (
            <button
              type="button"
              onClick={thirdAction.onClick}
              className={
                thirdAction.variant === "danger"
                  ? "rounded-sm border border-[var(--color-danger-border)] bg-bg-white px-4 py-2.5 text-sm font-bold text-[var(--color-status-failed-text)] hover:bg-[var(--color-danger-bg)]"
                  : "rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-text-body hover:border-[#b9c2ae]"
              }
            >
              {thirdAction.label}
            </button>
          )}

          {/* Cancel action — in column layout rendered after thirdAction */}
          {thirdAction && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-bold text-text-body hover:border-[#b9c2ae]"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
