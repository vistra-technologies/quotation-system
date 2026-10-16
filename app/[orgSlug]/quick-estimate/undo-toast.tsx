"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface ToastData {
  id: number;
  message: string;
  onUndo?: () => void;
}

const UNDO_MS = 6000;
const PLAIN_MS = 3200;

/** State for one `UndoToast`: `show(message, onUndo?)` replaces any toast showing. */
export function useUndoToast() {
  const [toast, setToast] = useState<ToastData | null>(null);
  const seq = useRef(0);
  const show = useCallback((message: string, onUndo?: () => void) => {
    seq.current += 1;
    setToast({ id: seq.current, message, onUndo });
  }, []);
  const hide = useCallback(() => setToast(null), []);
  return { toast, show, hide };
}

/**
 * The inquiry pages' toast (v3 mockup): a status message with an optional Undo, gone after 6 s (3.2 s without
 * Undo). `components/toast.tsx` is shared app-wide, 3 s and message-only, so it is left alone.
 */
export function UndoToast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  const t = useTranslations("quickEstimate");
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const id = toast?.id;
  const timed = toast?.onUndo ? UNDO_MS : PLAIN_MS;
  useEffect(() => {
    if (id === undefined) return;
    const handle = setTimeout(() => done.current(), timed);
    return () => clearTimeout(handle);
  }, [id, timed]);

  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="qe-toast"
      className="fixed bottom-6 left-1/2 z-[280] flex -translate-x-1/2 items-center gap-2.5 rounded-sm bg-text-heading py-2 pl-3.5 pr-2.5 text-[12.5px] font-bold text-white shadow-[0_12px_30px_-10px_rgba(0,0,0,0.4)]"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary-soft" aria-hidden="true">
        <path d="m5 12 5 5 9-10" />
      </svg>
      <span>{toast.message}</span>
      {toast.onUndo && (
        <button
          type="button"
          onClick={() => {
            const undo = toast.onUndo;
            onDone();
            undo?.();
          }}
          className="rounded-[6px] bg-white/10 px-2.5 py-1 text-xs font-extrabold text-white hover:bg-white/20"
        >
          {t("undo")}
        </button>
      )}
    </div>
  );
}
