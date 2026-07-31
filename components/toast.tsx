"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface ToastProps {
  /** Controls whether the toast is rendered. */
  visible: boolean;
  /** Called when the 3-second timer fires (or the component unmounts). Caller should set visible=false. */
  onDismiss: () => void;
  /** Override the displayed string. Defaults to the "comingSoon" translation. */
  message?: string;
}

/**
 * Fixed-position, auto-dismiss toast (3 s).
 *
 * Styled with Sage Ease design tokens. Requires NextIntlClientProvider in
 * scope with the "toast" namespace forwarded in clientMessages — see
 * projects/layout.tsx for the wiring and AGENTS.md for why this is critical.
 *
 * Usage pattern (with the useToast helper):
 *   const toast = useToast();
 *   <button onClick={toast.show}>Action</button>
 *   <Toast {...toast} />
 */
export function Toast({ visible, onDismiss, message }: ToastProps) {
  const t = useTranslations("toast");

  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(onDismiss, 3000);
    return () => clearTimeout(id);
  }, [visible, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 rounded-md border border-primary-soft bg-primary-softer/85 px-4 py-3 text-sm font-semibold text-primary-dark shadow-[0_8px_24px_-8px_rgba(62,102,71,0.28)] backdrop-blur-sm"
    >
      {message ?? t("comingSoon")}
    </div>
  );
}

/**
 * Convenience hook that manages toast visibility state.
 * Spread the return value directly onto <Toast> props:
 *   const toast = useToast();
 *   <Toast {...toast} />
 */
export function useToast() {
  const [visible, setVisible] = useState(false);
  const show = useCallback(() => setVisible(true), []);
  const onDismiss = useCallback(() => setVisible(false), []);
  return { visible, show, onDismiss };
}
