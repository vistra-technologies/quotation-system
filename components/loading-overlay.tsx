"use client";

import { useTranslations } from "next-intl";

interface LoadingOverlayProps {
  /** When true the overlay is shown; false (or unmounting) hides it instantly. */
  visible: boolean;
}

/**
 * Full-screen loading overlay for pending server actions.
 *
 * Prop-based: the caller controls visibility via the `visible` prop, which is
 * typically driven by useFormStatus().pending or a useTransition isPending flag.
 * When the action settles (success *or* error) the caller sets visible=false and
 * the overlay disappears — so a failed action can never strand the overlay on-screen.
 *
 * Requires NextIntlClientProvider in scope (provided by the admin layout) for
 * the "common.loading" string. For use outside the admin layout, add the provider
 * at the relevant ancestor layout and pass the "common" namespace.
 */
export function LoadingOverlay({ visible }: LoadingOverlayProps) {
  const t = useTranslations("common");

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label={t("loading")}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50"
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-50"
      />
      <p className="mt-3 text-sm font-medium text-zinc-50">{t("loading")}</p>
    </div>
  );
}
