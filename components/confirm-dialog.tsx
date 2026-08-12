"use client";

import { useEffect, useRef } from "react";

// ─── Props ───────────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  /** Label for the destructive confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
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
 * Accessibility: role="dialog", aria-modal, Escape-to-cancel, auto-focus on
 * the confirm button so keyboard users can act immediately or Tab to cancel.
 *
 * No portal — renders inline at its mount point, behind a z-50 fixed overlay.
 * Sufficient for admin pages which have no competing z-index stack.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
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

  // Close on Escape key.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    /* Fixed overlay — blocks interaction with the page behind it. */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      {/* Dialog card — stop propagation so clicking inside doesn't dismiss. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="mx-4 w-full max-w-sm rounded-md border border-border bg-bg-card p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="mb-2 text-base font-extrabold text-text-heading"
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-message"
          className="mb-6 text-sm text-text-body"
        >
          {message}
        </p>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm border border-border bg-bg-white px-4 py-2 text-sm font-bold text-text-body hover:bg-primary-softer"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-sm bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
