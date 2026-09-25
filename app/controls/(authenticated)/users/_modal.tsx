"use client";

import { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Minimal popup shell for the /controls users page (hotfix 2026-09-25, H-5).
 * Same overlay/card styling as components/confirm-dialog.tsx; Escape and an
 * overlay click close it. No i18n dependency (/controls has no provider).
 */
export function Modal({ isOpen, title, onClose, children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-md border border-border bg-bg-white p-6 text-left font-normal shadow-[0_24px_48px_-16px_rgba(27,40,30,.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-base font-extrabold text-text-heading">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-lg leading-none text-text-muted hover:text-text-heading"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
