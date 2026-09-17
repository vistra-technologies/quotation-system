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
  /**
   * Visual variant.
   *   "success" (default) — translucent green (Sage Ease primary palette).
   *   "error" — translucent red.
   * Bug 13: kept generic/reusable per the user's requirement so any action
   * (e.g. "Saved" confirmations) can reuse this without hardcoding a message.
   */
  variant?: "success" | "error";
}

/**
 * Fixed-position, auto-dismiss toast (3 s).
 *
 * Positioned bottom-right, near the "SAVED COMPONENTS" / "DOOR HEIGHT" area
 * of the Design page's right rail (per bugs-3.md Bug 13 annotated screenshot).
 *
 * Styled with Sage Ease design tokens — translucent background, backdrop blur.
 * Entrance: slides in from the right edge of the screen (Bug 13 requirement).
 * Exit: component unmounts on dismiss (no separate exit animation needed).
 *
 * Requires NextIntlClientProvider in scope with the "toast" namespace forwarded
 * in clientMessages — see projects/layout.tsx for the wiring and AGENTS.md for
 * why this is critical.
 *
 * Usage pattern (with the useToast helper):
 *   const toast = useToast();
 *   <button onClick={() => toast.show("Design submitted!")}>Action</button>
 *   <Toast {...toast} />
 */
export function Toast({ visible, onDismiss, message, variant = "success" }: ToastProps) {
  const t = useTranslations("toast");

  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(onDismiss, 3000);
    return () => clearTimeout(id);
  }, [visible, onDismiss]);

  if (!visible) return null;

  const colorClass =
    variant === "error"
      ? "border-red-200 bg-red-50/85 text-red-800"
      : "border-primary-soft bg-primary-softer/85 text-primary-dark";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 rounded-md border px-4 py-3 text-sm font-semibold shadow-[0_8px_24px_-8px_rgba(62,102,71,0.28)] backdrop-blur-sm ${colorClass}`}
      style={{ animation: "toast-slide-in 0.28s ease-out both" }}
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
 *
 * Bug 13: show() now accepts an optional message and variant so callers
 * can set the toast content at the time of the action rather than wiring
 * static props from the outside.
 */
export function useToast() {
  const [visible, setVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | undefined>(undefined);
  const [toastVariant, setToastVariant] = useState<"success" | "error">("success");

  const show = useCallback((msg?: string, v?: "success" | "error") => {
    setToastMessage(msg);
    setToastVariant(v ?? "success");
    setVisible(true);
  }, []);
  const onDismiss = useCallback(() => setVisible(false), []);
  return { visible, message: toastMessage, variant: toastVariant, show, onDismiss };
}
